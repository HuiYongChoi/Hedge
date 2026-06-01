from __future__ import annotations

import json
from typing_extensions import Literal
from pydantic import BaseModel

from src.graph.state import AgentState, show_agent_reasoning
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage

from src.tools.api import (
    get_financial_metrics,
    get_market_cap,
    search_line_items,
)
from src.utils.api_key import get_api_key_from_state
from src.utils.forward_outlook import (
    FORWARD_OUTLOOK_SYSTEM_INSTRUCTION,
    build_forward_outlook_block,
    get_cached_forward_metrics,
)
from src.utils.llm import (
    call_llm,
    COMPANY_IDENTITY_REQUIREMENT,
    SENTIMENT_MARKER_REQUIREMENT,
    VALUATION_CONFIDENCE_REQUIREMENT,
)
from src.tools.company_name import resolve_company_name
from src.utils.progress import progress
from src.utils.agent_data_quality import (
    insufficient, ok, partial,
    aggregate_scores, sanitize_for_llm, coverage_caps_signal,
    valuation_confidence_flag, low_confidence_caps_signal,
)


class AswathDamodaranSignal(BaseModel):
    signal: Literal["bullish", "bearish", "neutral"]
    confidence: float          # 0‒100
    reasoning: str


def aswath_damodaran_agent(state: AgentState, agent_id: str = "aswath_damodaran_agent"):
    """
    Analyze US equities through Aswath Damodaran's intrinsic-value lens:
      • Cost of Equity via CAPM (risk-free + β·ERP)
      • 5-yr revenue / FCFF growth trends & reinvestment efficiency
      • FCFF-to-Firm DCF → equity value → per-share intrinsic value
      • Cross-check with relative valuation (PE vs. Fwd PE sector median proxy)
    Produces a trading signal and explanation in Damodaran's analytical voice.
    """
    data      = state["data"]
    end_date  = data["end_date"]
    tickers   = data["tickers"]
    api_key  = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")

    analysis_data: dict[str, dict] = {}
    damodaran_signals: dict[str, dict] = {}

    for ticker in tickers:
        # ─── Fetch core data ────────────────────────────────────────────────────
        progress.update_status(agent_id, ticker, "Fetching financial metrics")
        metrics = get_financial_metrics(ticker, end_date, period="ttm", limit=5, api_key=api_key)

        _li_fields = [
            "revenue", "free_cash_flow", "ebit", "interest_expense",
            "operating_income", "capital_expenditure",
            "depreciation_and_amortization", "outstanding_shares",
            "net_income", "total_debt", "shareholders_equity",
            "cash_and_equivalents",
        ]
        progress.update_status(agent_id, ticker, "Fetching financial line items (annual)")
        line_items_annual = search_line_items(
            ticker, _li_fields, end_date,
            period="annual", limit=8, api_key=api_key,
        )
        progress.update_status(agent_id, ticker, "Fetching financial line items (ttm)")
        line_items_ttm = search_line_items(
            ticker, _li_fields, end_date,
            period="ttm", limit=1, api_key=api_key,
        )
        line_items = (line_items_ttm or []) + (line_items_annual or [])

        progress.update_status(agent_id, ticker, "Getting market cap")
        market_cap = get_market_cap(ticker, end_date, api_key=api_key)

        # ─── Analyses ───────────────────────────────────────────────────────────
        progress.update_status(agent_id, ticker, "Analyzing growth and reinvestment")
        growth_analysis = analyze_growth_and_reinvestment(metrics, line_items)

        progress.update_status(agent_id, ticker, "Analyzing risk profile")
        risk_analysis = analyze_risk_profile(metrics, line_items)

        progress.update_status(agent_id, ticker, "Calculating intrinsic value (DCF)")
        intrinsic_val_analysis = calculate_intrinsic_value_dcf(metrics, line_items, risk_analysis)

        progress.update_status(agent_id, ticker, "Assessing relative valuation")
        relative_val_analysis = analyze_relative_valuation(metrics)

        progress.update_status(agent_id, ticker, "Preparing forward outlook")
        forward_metrics = get_cached_forward_metrics(state, ticker, end_date, api_key)
        trailing_pe = getattr(metrics[0], "price_to_earnings_ratio", None) if metrics else None
        forward_outlook = build_forward_outlook_block(forward_metrics, trailing_pe=trailing_pe)

        # ─── Score & margin of safety ──────────────────────────────────────────
        _components = [growth_analysis, risk_analysis, relative_val_analysis]
        _agg = aggregate_scores(_components)
        total_score = _agg["total_score"]
        max_score = _agg["effective_max"]
        _coverage = _agg["coverage"]
        _raw_max = _agg["raw_max"]

        intrinsic_value = intrinsic_val_analysis["intrinsic_value"]
        margin_of_safety = (
            (intrinsic_value - market_cap) / market_cap if intrinsic_value and market_cap else None
        )

        # Low-confidence flag for the single-scenario FCFF DCF. Unlike the
        # multi-model valuation agent, Damodaran has only one intrinsic estimate,
        # so its sanity reference is the market price (see valuation_confidence_flag).
        valuation_confidence, valuation_confidence_note = valuation_confidence_flag(margin_of_safety)

        # Decision rules (Damodaran tends to act with ~20-25 % MOS)
        if margin_of_safety is not None and margin_of_safety >= 0.25:
            signal = "bullish"
        elif margin_of_safety is not None and margin_of_safety <= -0.25:
            signal = "bearish"
        else:
            signal = "neutral"

        analysis_data[ticker] = {
            "signal": signal,
            "score": total_score,
            "max_score": max_score,
            "data_coverage": _coverage,
            "raw_max_score": _raw_max,
            "margin_of_safety": margin_of_safety,
            "growth_analysis": growth_analysis,
            "risk_analysis": risk_analysis,
            "relative_val_analysis": relative_val_analysis,
            "intrinsic_val_analysis": intrinsic_val_analysis,
            "market_cap": market_cap,
            "forward_outlook": forward_outlook,
            "valuation_confidence": valuation_confidence,
        }
        if valuation_confidence_note:
            analysis_data[ticker]["valuation_confidence_note"] = valuation_confidence_note
        company_name = resolve_company_name(ticker)
        analysis_data[ticker]["company_name"] = company_name

        # ─── LLM: craft Damodaran-style narrative ──────────────────────────────
        progress.update_status(agent_id, ticker, "Generating Damodaran analysis")
        damodaran_output = generate_damodaran_output(
            ticker=ticker,
            analysis_data=analysis_data,
            state=state,
            agent_id=agent_id,
        )

        # Apply data-coverage signal cap, then the low-valuation-confidence cap.
        raw_sig = damodaran_output.signal
        raw_conf = damodaran_output.confidence
        capped_sig, capped_conf = coverage_caps_signal(_coverage, raw_sig, raw_conf)
        capped_sig, capped_conf = low_confidence_caps_signal(valuation_confidence, capped_sig, capped_conf)
        if capped_sig != raw_sig or capped_conf != raw_conf:
            damodaran_output.signal = capped_sig
            damodaran_output.confidence = capped_conf
            if _coverage < 0.4 and "데이터 커버리지" not in damodaran_output.reasoning:
                damodaran_output.reasoning = (
                    f"[데이터 커버리지 {_coverage:.0%}] 핵심 축이 결측되어 정량 결론을 보류하고 중립으로 조정함.\n\n"
                    + damodaran_output.reasoning
                )

        signal_payload = damodaran_output.model_dump()
        # Surface the structured FCFF-DCF per-share value so the report headline
        # anchors to the actual model output instead of regex-scraping it from
        # the narrative (which drifts with LLM phrasing).
        per_share_iv = intrinsic_val_analysis.get("intrinsic_per_share")
        if per_share_iv is not None:
            signal_payload["intrinsic_value_per_share"] = per_share_iv
        signal_payload["valuation_confidence"] = valuation_confidence
        damodaran_signals[ticker] = signal_payload

        progress.update_status(agent_id, ticker, "Done", analysis=damodaran_output.reasoning)

    # ─── Push message back to graph state ──────────────────────────────────────
    message = HumanMessage(content=json.dumps(damodaran_signals), name=agent_id)

    if state["metadata"]["show_reasoning"]:
        show_agent_reasoning(damodaran_signals, "Aswath Damodaran Agent")

    state["data"]["analyst_signals"][agent_id] = damodaran_signals
    progress.update_status(agent_id, None, "Done")

    return {"messages": [message], "data": state["data"]}


# ────────────────────────────────────────────────────────────────────────────────
# Helper analyses
# ────────────────────────────────────────────────────────────────────────────────
def analyze_growth_and_reinvestment(metrics: list, line_items: list) -> dict[str, any]:
    """
    Growth score (0-4):
      +2  5-yr CAGR of revenue > 8 %
      +1  5-yr CAGR of revenue > 3 %
      +1  Positive FCFF growth over 5 yr
    Reinvestment efficiency (ROIC > WACC) adds +1
    """
    max_score = 4
    if len(metrics) < 2 and len(line_items) < 2:
        return insufficient(max_score, "성장 분석 보류 — 기간별 매출/현금흐름 데이터가 2개 미만이라 CAGR 계산 불가")

    # Revenue CAGR (oldest to latest)
    revs = [li.revenue for li in reversed(line_items) if getattr(li, "revenue", None)]
    if len(revs) < 2:
        revs = [m.revenue for m in reversed(metrics) if hasattr(m, "revenue") and m.revenue]
    if len(revs) >= 2 and revs[0] > 0:
        cagr = (revs[-1] / revs[0]) ** (1 / (len(revs) - 1)) - 1
    else:
        cagr = None

    score, details = 0, []

    if cagr is not None:
        if cagr > 0.08:
            score += 2
            details.append(f"Revenue CAGR {cagr:.1%} (> 8 %)")
        elif cagr > 0.03:
            score += 1
            details.append(f"Revenue CAGR {cagr:.1%} (> 3 %)")
        else:
            details.append(f"Sluggish revenue CAGR {cagr:.1%}")
    else:
        details.append("매출 CAGR은 N/A라서 FCFF와 ROIC 대체 지표를 더 중시")

    # FCFF growth (proxy: free_cash_flow trend)
    fcfs = [li.free_cash_flow for li in reversed(line_items) if li.free_cash_flow]
    if len(fcfs) >= 2 and fcfs[-1] > fcfs[0]:
        score += 1
        details.append("Positive FCFF growth")
    else:
        details.append("FCFF 성장성은 정체 또는 N/A")

    # Reinvestment efficiency (ROIC vs. 10 % hurdle)
    latest = metrics[0] if metrics else None
    latest_li = line_items[0] if line_items else None
    roic = getattr(latest, "return_on_invested_capital", None) if latest else None
    if roic is None and latest_li:
        roic = getattr(latest_li, "return_on_invested_capital", None)
    if roic and roic > 0.10:
        score += 1
        details.append(f"ROIC {roic:.1%} (> 10 %)")

    return {
        "score": score,
        "max_score": max_score,
        "details": "; ".join(details),
        "metrics": latest.model_dump() if latest else {},
    }


def analyze_risk_profile(metrics: list, line_items: list) -> dict[str, any]:
    """
    Risk score (0-3):
      +1  Beta < 1.3
      +1  Debt/Equity < 1
      +1  Interest Coverage > 3
    """
    max_score = 3
    if not metrics and not line_items:
        return insufficient(max_score, "위험 지표 보류 — Beta, D/E, Interest Coverage 모두 부재")

    latest = metrics[0] if metrics else None
    latest_li = line_items[0] if line_items else None
    score, details = 0, []

    # Beta
    beta = getattr(latest, "beta", None) if latest else None
    if beta is not None:
        if beta < 1.3:
            score += 1
            details.append(f"Beta {beta:.2f}")
        else:
            details.append(f"High beta {beta:.2f}")
    else:
        details.append("Beta N/A")

    # Debt / Equity
    dte = getattr(latest, "debt_to_equity", None) if latest else None
    if dte is None and latest_li:
        total_debt = getattr(latest_li, "total_debt", None)
        equity = getattr(latest_li, "shareholders_equity", None)
        dte = total_debt / equity if total_debt is not None and equity else None
    if dte is not None:
        if dte < 1:
            score += 1
            details.append(f"D/E {dte:.2f}")
        else:
            details.append(f"High D/E {dte:.2f}")
    else:
        details.append("D/E N/A")

    # Interest coverage
    ebit = getattr(latest_li, "ebit", None) if latest_li else None
    if ebit is None and latest:
        ebit = getattr(latest, "ebit", None) or getattr(latest, "operating_income", None)
    interest = getattr(latest_li, "interest_expense", None) if latest_li else None
    if interest is None and latest:
        interest = getattr(latest, "interest_expense", None)
    if ebit and interest and interest != 0:
        coverage = ebit / abs(interest)
        if coverage > 3:
            score += 1
            details.append(f"Interest coverage {coverage:.1f}")
        else:
            details.append(f"Weak coverage {coverage:.1f}")
    else:
        details.append("Interest coverage N/A")

    # Compute cost of equity for later use
    cost_of_equity = estimate_cost_of_equity(beta)

    return {
        "score": score,
        "max_score": max_score,
        "details": "; ".join(details),
        "beta": beta,
        "cost_of_equity": cost_of_equity,
    }


def analyze_relative_valuation(metrics: list) -> dict[str, any]:
    """
    Simple PE check vs. historical median (proxy since sector comps unavailable):
      +1 if TTM P/E < 70 % of 5-yr median
      +0 if between 70 %-130 %
      ‑1 if >130 %
    """
    max_score = 1
    if not metrics or len(metrics) < 5:
        return insufficient(max_score, "상대 P/E 비교 보류 — 5년치 P/E 이력 부족")

    pes = [m.price_to_earnings_ratio for m in metrics if m.price_to_earnings_ratio]
    if len(pes) < 5:
        return insufficient(max_score, "상대 P/E 비교 보류 — P/E 유효값이 5개 미만")

    ttm_pe = pes[0]
    median_pe = sorted(pes)[len(pes) // 2]

    if ttm_pe < 0.7 * median_pe:
        score, desc = 1, f"P/E {ttm_pe:.1f} vs. median {median_pe:.1f} (cheap)"
    elif ttm_pe > 1.3 * median_pe:
        score, desc = -1, f"P/E {ttm_pe:.1f} vs. median {median_pe:.1f} (expensive)"
    else:
        score, desc = 0, f"P/E inline with history"

    return {"score": score, "max_score": max_score, "details": desc}


# ────────────────────────────────────────────────────────────────────────────────
# Intrinsic value via FCFF DCF (Damodaran style)
# ────────────────────────────────────────────────────────────────────────────────
def calculate_intrinsic_value_dcf(metrics: list, line_items: list, risk_analysis: dict) -> dict[str, any]:
    """
    FCFF DCF with:
      • Base FCFF = latest free cash flow
      • Growth = 5-yr revenue CAGR (capped 12 %)
      • Fade linearly to terminal growth 2.5 % by year 10
      • Discount @ cost of equity (no debt split given data limitations)
    """
    if len(line_items) < 1:
        return {"intrinsic_value": None, "details": ["N/A: FCFF DCF에 필요한 현금흐름 원천이 없어 상대가치와 질적 리스크를 우선 해석"]}

    latest_li = line_items[0]
    fcff0 = getattr(latest_li, "free_cash_flow", None)
    if fcff0 is None and metrics:
        fcff0 = getattr(metrics[0], "free_cash_flow", None)
    # Prefer the point-in-time TTM share count from financial metrics. The TTM
    # line item can report outstanding_shares summed across quarters (~4x the
    # real float), which deflates intrinsic value per share by the same factor
    # (e.g. MU: 4.54B summed vs 1.13B real → $18.87 instead of $75.88).
    # metrics[0].outstanding_shares is a snapshot consistent with the share base
    # behind market cap / current price.
    shares = getattr(metrics[0], "outstanding_shares", None) if metrics else None
    if not shares or shares <= 0:
        shares = getattr(latest_li, "outstanding_shares", None)
    if not fcff0 or not shares:
        return {"intrinsic_value": None, "details": ["N/A: FCFF 또는 주식 수가 없어 DCF는 보조 지표로만 취급"]}

    # Growth assumptions
    revs = [li.revenue for li in reversed(line_items) if getattr(li, "revenue", None)]
    if len(revs) < 2:
        revs = [m.revenue for m in reversed(metrics) if hasattr(m, "revenue") and m.revenue]
    if len(revs) >= 2 and revs[0] > 0:
        base_growth = min((revs[-1] / revs[0]) ** (1 / (len(revs) - 1)) - 1, 0.12)
    else:
        base_growth = 0.04  # fallback

    terminal_growth = 0.025
    years = 10

    # Discount rate
    discount = risk_analysis.get("cost_of_equity") or 0.09

    # Project FCFF and discount. FCFF compounds year over year while the growth
    # rate fades linearly from base_growth to terminal_growth, so the final year
    # reflects the full cumulative growth rather than a flat multiple of fcff0.
    pv_sum = 0.0
    fcff_t = fcff0
    g = base_growth
    g_step = (terminal_growth - base_growth) / (years - 1)
    for yr in range(1, years + 1):
        fcff_t *= (1 + g)
        pv_sum += fcff_t / (1 + discount) ** yr
        g += g_step

    # Terminal value (Gordon growth) anchored to the final projected year's FCFF,
    # grown one more period at the terminal rate, then discounted back.
    tv = (
        fcff_t
        * (1 + terminal_growth)
        / (discount - terminal_growth)
        / (1 + discount) ** years
    )

    equity_value = pv_sum + tv
    intrinsic_per_share = equity_value / shares

    return {
        "intrinsic_value": equity_value,
        "intrinsic_per_share": intrinsic_per_share,
        "assumptions": {
            "base_fcff": fcff0,
            "base_growth": base_growth,
            "terminal_growth": terminal_growth,
            "discount_rate": discount,
            "projection_years": years,
        },
        "details": ["FCFF DCF completed"],
    }


def estimate_cost_of_equity(beta: float | None) -> float:
    """CAPM: r_e = r_f + β × ERP (use Damodaran's long-term averages)."""
    risk_free = 0.04          # 10-yr US Treasury proxy
    erp = 0.05                # long-run US equity risk premium
    beta = beta if beta is not None else 1.0
    return risk_free + beta * erp


# ────────────────────────────────────────────────────────────────────────────────
# LLM generation
# ────────────────────────────────────────────────────────────────────────────────
def generate_damodaran_output(
    ticker: str,
    analysis_data: dict[str, any],
    state: AgentState,
    agent_id: str,
) -> AswathDamodaranSignal:
    """
    Ask the LLM to channel Prof. Damodaran's analytical style:
      • Story → Numbers → Value narrative
      • Emphasize risk, growth, and cash-flow assumptions
      • Cite cost of capital, implied MOS, and valuation cross-checks
    """
    template = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                f"""You are Aswath Damodaran, Professor of Finance at NYU Stern.
                Use your valuation framework to issue trading signals on US equities.

                Speak with your usual clear, data-driven tone:
                  ◦ Start with the company "story" (qualitatively)
                  ◦ Connect that story to key numerical drivers: revenue growth, margins, reinvestment, risk
                  ◦ Conclude with value: your FCFF DCF estimate, margin of safety, and relative valuation sanity checks
                  ◦ Highlight major uncertainties and how they affect value
                {FORWARD_OUTLOOK_SYSTEM_INSTRUCTION}

                {COMPANY_IDENTITY_REQUIREMENT}

                {SENTIMENT_MARKER_REQUIREMENT}

                - `score` 값이 `"DATA_INSUFFICIENT"` 인 항목은 점수를 인용하지 말고 "데이터 부족으로 평가 보류"라고 명시한다. 그 축을 근거로 단정적 매수/매도 판단을 하지 않는다.

                {VALUATION_CONFIDENCE_REQUIREMENT}

                Return ONLY the JSON specified below.""",
            ),
            (
                "human",
                """Ticker: {ticker}
                Company name: {company_name}

                Analysis data:
                {analysis_data}

                Respond EXACTLY in this JSON schema:
                {{
                  "signal": "bullish" | "bearish" | "neutral",
                  "confidence": float (0-100),
                  "reasoning": "string"
                }}""",
            ),
        ]
    )

    prompt = template.invoke({
        "analysis_data": json.dumps(sanitize_for_llm(analysis_data), indent=2, ensure_ascii=False),
        "ticker": ticker,
        "company_name": analysis_data.get(ticker, {}).get("company_name", ticker),
    })

    def default_signal():
        return AswathDamodaranSignal(
            signal="neutral",
            confidence=0.0,
            reasoning="Parsing error; defaulting to neutral",
        )

    return call_llm(
        prompt=prompt,
        pydantic_model=AswathDamodaranSignal,
        agent_name=agent_id,
        state=state,
        default_factory=default_signal,
    )
