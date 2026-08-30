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
from src.tools.earnings_release import fetch_latest_earnings_release
from src.tools.filings import fetch_filing_sections
from src.tools.life_cycle import diagnose as diagnose_life_cycle
from src.tools.money_ko import describe_valuation_gap
from src.utils.capm import (
    DAMODARAN_ERP,
    DAMODARAN_RISK_FREE,
    cost_of_equity as capm_cost_of_equity,
    macro_from_state,
    resolve_risk_free_rate,
)
from src.tools.management_scorecard import assess as assess_management
from src.tools.narrative_check import check as check_narrative
from src.tools.proxy_statement import fetch_latest_proxy
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
        risk_analysis = analyze_risk_profile(metrics, line_items, macro_from_state(state))

        progress.update_status(agent_id, ticker, "Calculating intrinsic value (DCF)")
        intrinsic_val_analysis = calculate_intrinsic_value_dcf(metrics, line_items, risk_analysis)

        progress.update_status(agent_id, ticker, "Assessing relative valuation")
        relative_val_analysis = analyze_relative_valuation(metrics)

        progress.update_status(agent_id, ticker, "Preparing forward outlook")
        forward_metrics = get_cached_forward_metrics(state, ticker, end_date, api_key)
        trailing_pe = getattr(metrics[0], "price_to_earnings_ratio", None) if metrics else None
        forward_outlook = build_forward_outlook_block(forward_metrics, trailing_pe=trailing_pe)

        progress.update_status(agent_id, ticker, "Calculating forward intrinsic value")
        forward_val_analysis = calculate_forward_intrinsic_value_dcf(
            metrics, line_items, risk_analysis, forward_metrics
        )

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

        # 선행 DCF 의 안전마진. 기존 안전마진과 같은 식이되 출발 실적만 다르다.
        forward_intrinsic = forward_val_analysis.get("intrinsic_value")
        forward_margin_of_safety = (
            (forward_intrinsic - market_cap) / market_cap
            if forward_intrinsic and market_cap else None
        )

        # 내재가치만 던지면 독자가 시가총액을 찾아 직접 나눠 봐야 한다.
        # '얼마 vs 얼마 → 그래서 싼가 비싼가'를 여기서 문장으로 만들어 둔다.
        gap_text = describe_valuation_gap(intrinsic_value, market_cap, margin_of_safety)
        if gap_text:
            intrinsic_val_analysis = {**intrinsic_val_analysis, "meaning_ko": gap_text}
            details = list(intrinsic_val_analysis.get("details") or [])
            intrinsic_val_analysis["details"] = [
                d.replace("FCFF DCF completed", "FCFF DCF 산출 완료") for d in details
            ] + [gap_text]

        analysis_data[ticker] = {
            "signal": signal,
            "score": total_score,
            "max_score": max_score,
            "data_coverage": _coverage,
            "raw_max_score": _raw_max,
            "margin_of_safety": margin_of_safety,
            # 안전마진 숫자만 보면 어디서 나온 값인지 알 수 없다. 화면이 숫자 뒤에
            # 근거를 붙일 수 있도록 분자·분모를 그대로 실어 보낸다.
            "margin_of_safety_basis": {
                "intrinsic_value": intrinsic_value,
                "market_cap": market_cap,
            } if intrinsic_value and market_cap else None,
            "forward_margin_of_safety": forward_margin_of_safety,
            "forward_val_analysis": forward_val_analysis,
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

        # ─── 생애주기 진단 + 경영진 자본배분 평가 ──────────────────────────────
        # Damodaran, *The Corporate Life Cycle* — 단계마다 맞는 가치평가법과 전략이
        # 다르고, 가치 파괴는 대개 '단계에 맞지 않는 행동'에서 온다.
        # LLM 추측이 아니라 위에서 이미 받아온 재무 시계열로 결정론적으로 계산한다.
        progress.update_status(agent_id, ticker, "Diagnosing corporate life cycle")
        life_cycle = diagnose_life_cycle(line_items_annual or line_items, metrics)
        analysis_data[ticker]["life_cycle"] = life_cycle.to_dict()

        progress.update_status(agent_id, ticker, "Assessing management capital allocation")
        wacc_estimate = risk_analysis.get("cost_of_equity") if isinstance(risk_analysis, dict) else None
        management = assess_management(
            line_items_annual or line_items,
            metrics,
            wacc=wacc_estimate,
            stage=life_cycle.stage,
        )
        analysis_data[ticker]["management_assessment"] = management.to_dict()

        # ─── 경영진이 직접 한 말 + 서사 일관성 ────────────────────────────────
        # Damodaran 의 "Story → Numbers → Value" 중 Story 축. 다만 서사를 창작하지 않고
        # 회사가 공시·실적 보도자료에 **직접 쓴 문장**만 근거로 삼는다.
        progress.update_status(agent_id, ticker, "Collecting management's own words")
        company_text_parts: list[str] = []
        try:
            filing = fetch_filing_sections(ticker, period="annual", budget_per_section=8000)
            company_text_parts += [s.text for s in filing.sections if s.item == "7"]
        except Exception:
            filing = None
        try:
            release = fetch_latest_earnings_release(ticker, budget=8000)
            if release.text:
                company_text_parts.append(release.text)
            if release.quotes or release.outlook_text:
                analysis_data[ticker]["management_said"] = {
                    "source_url": release.source_url,
                    "filing_date": release.filing_date,
                    "quotes": [
                        {"speaker": q.speaker, "text": q.text} for q in release.quotes
                    ],
                    "outlook_text": release.outlook_text,
                }
        except Exception:
            pass

        narrative = check_narrative(life_cycle.stage, "\n".join(company_text_parts))
        analysis_data[ticker]["narrative_check"] = narrative.to_dict()

        # ─── 경영진 보상 구조(위임장) ─────────────────────────────────────────
        # 자본배분 실적은 '결과'다. 그 결과를 만든 '인센티브'가 빠지면 절반이다.
        # 한국은 별도 위임장 공시가 없다. 사업보고서의 '이사·감사 보수현황'이 대응된다.
        progress.update_status(agent_id, ticker, "Reading executive compensation")
        try:
            from src.tools.filings import detect_market

            if detect_market(ticker) == "KR":
                from src.tools.dart_filings import fetch_latest_filing_sections

                filing = fetch_latest_filing_sections(
                    ticker, form="annual", items=("COMP",), budget_per_section=4000,
                )
                if filing.sections:
                    analysis_data[ticker]["compensation"] = {
                        "source_url": filing.source_url,
                        "filing_date": filing.filing_date,
                        "say_on_pay_support": None,   # 한국에는 보상안 주주투표 제도가 없다
                        "sections": [
                            {"key": s.item, "title": s.title, "text": s.text}
                            for s in filing.sections
                        ],
                    }
            else:
                proxy = fetch_latest_proxy(ticker)
                if proxy.sections or proxy.say_on_pay_support is not None:
                    analysis_data[ticker]["compensation"] = {
                        "source_url": proxy.source_url,
                        "filing_date": proxy.filing_date,
                        "say_on_pay_support": proxy.say_on_pay_support,
                        "sections": [
                            {"key": s.key, "title": s.title, "text": s.text}
                            for s in proxy.sections
                        ],
                    }
        except Exception:
            pass

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

        # 선행 DCF 도 같은 이유로 구조화해서 내보낸다 — 서술에서 긁어오면 문구가
        # 바뀔 때마다 값이 사라진다. 미산출이면 사유를 함께 실어, 화면이
        # "왜 비어 있는지"를 말할 수 있게 한다.
        fwd_per_share = forward_val_analysis.get("intrinsic_per_share")
        if fwd_per_share is not None:
            signal_payload["forward_intrinsic_value_per_share"] = fwd_per_share
            signal_payload["forward_margin_of_safety"] = forward_margin_of_safety
            signal_payload["forward_dcf_assumptions"] = forward_val_analysis.get("assumptions")
            _fwd_assumptions = forward_val_analysis.get("assumptions") or {}
            signal_payload["forward_dcf_eps_used"] = _fwd_assumptions.get("forward_eps_used")
            signal_payload["forward_dcf_eps_source"] = _fwd_assumptions.get("forward_eps_source")
            signal_payload["forward_dcf_base_growth"] = _fwd_assumptions.get("base_growth")
        elif forward_val_analysis.get("reason"):
            signal_payload["forward_intrinsic_value_note"] = forward_val_analysis["reason"]

        # 안전마진은 화면에서 숫자 하나로만 보인다. 어떤 두 수를 나눈 결과인지
        # 함께 보내, 독자가 -178% 같은 값을 만났을 때 근거를 되짚을 수 있게 한다.
        if margin_of_safety is not None:
            signal_payload["margin_of_safety"] = margin_of_safety
        basis = analysis_data[ticker].get("margin_of_safety_basis")
        if basis:
            signal_payload["margin_of_safety_basis"] = basis

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


def analyze_risk_profile(metrics: list, line_items: list, macro: dict | None = None) -> dict[str, any]:
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
    risk_free, risk_free_source = resolve_risk_free_rate(macro, DAMODARAN_RISK_FREE)
    cost_of_equity = estimate_cost_of_equity(beta, risk_free)

    result = {
        "score": score,
        "max_score": max_score,
        "details": "; ".join(details),
        "beta": beta,
        "cost_of_equity": cost_of_equity,
    }
    # 실시간 금리를 실제로 쓴 경우에만 남긴다. 상수를 쓴 날에는 기록할 것이 없고,
    # 이 dict 는 그대로 LLM 프롬프트에 들어가므로 빈 필드를 넣으면
    # 본문에 'risk_free_source: null' 같은 찌꺼기가 새어 나온다.
    if risk_free_source:
        result["risk_free_rate"] = risk_free
        result["risk_free_source"] = risk_free_source
    return result


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
def _resolve_share_count(metrics: list, line_items: list) -> float | None:
    """시가총액과 같은 주식 수 기준을 쓴다.

    TTM 라인아이템의 outstanding_shares 는 분기 합(약 4배)으로 들어오는 경우가 있어
    주당 가치를 그만큼 눌러 버린다(MU: 4.54B 합계 vs 실제 1.13B → $18.87 vs $75.88).
    metrics[0] 쪽이 시점 스냅샷이라 시가총액과 정합적이다.
    """
    shares = getattr(metrics[0], "outstanding_shares", None) if metrics else None
    if shares and shares > 0:
        return shares
    latest = line_items[0] if line_items else None
    shares = getattr(latest, "outstanding_shares", None) if latest else None
    return shares if shares and shares > 0 else None


def _discount_fcff_path(
    fcff0: float,
    base_growth: float,
    discount: float,
    years: int,
    terminal_growth: float,
) -> tuple[float, float] | None:
    """FCFF 를 years 년 투영·할인하고 고든 터미널을 붙인다. (현재가치합, 터미널현재가치).

    기존 DCF 와 선행 DCF 가 '출발점'만 다르고 나머지는 같아야 하므로,
    투영·감쇠·터미널 계산은 여기 한 벌만 둔다. 두 벌로 나뉘면 한쪽만 고쳐져
    같은 리포트에 서로 다른 규칙으로 계산된 두 적정가가 나란히 뜬다.
    """
    if discount <= terminal_growth:
        return None  # 고든 분모가 0 이하 → 적정가가 무한대로 발산한다

    pv_sum = 0.0
    fcff_t = fcff0
    g = base_growth
    g_step = (terminal_growth - base_growth) / (years - 1)
    for yr in range(1, years + 1):
        fcff_t *= (1 + g)
        pv_sum += fcff_t / (1 + discount) ** yr
        g += g_step

    tv = (
        fcff_t
        * (1 + terminal_growth)
        / (discount - terminal_growth)
        / (1 + discount) ** years
    )
    return pv_sum, tv


def _historical_fcff_conversion(line_items: list) -> tuple[float | None, int]:
    """과거 'FCFF ÷ 순이익' 중앙값과 표본 수.

    선행 컨센서스는 EPS(이익)로만 온다. DCF 는 현금흐름을 받는다.
    그 사이를 잇는 유일한 가정이 이 전환율이므로, 상수로 박지 않고
    그 기업의 실제 이력에서 뽑아 쓰고 assumptions 에 그대로 노출한다.
    """
    ratios = []
    for li in line_items:
        fcf = getattr(li, "free_cash_flow", None)
        ni = getattr(li, "net_income", None)
        if not fcf or not ni or ni <= 0:
            continue
        r = fcf / ni
        # 일회성 항목이 낀 해는 전환율이 튄다. 극단값은 중앙값 계산에서 뺀다.
        if 0.0 < r < 3.0:
            ratios.append(r)
    if not ratios:
        return None, 0
    ratios.sort()
    mid = len(ratios) // 2
    median = ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    # 전환율이 1을 크게 넘으면 감가상각이 큰 해를 영구화하는 셈이 된다. 상한을 둔다.
    return max(0.3, min(median, 1.5)), len(ratios)


#: 선행 DCF 출발점 후보. 앞에 있을수록 '진짜 선행'이다.
#:
#: forward_eps_ttm 은 이름과 달리 직전 실제 3분기 + 컨센서스 1분기라, 12개월 창의
#: 3/4 가 이미 지나간 실적이다. 선행성은 한 분기뿐이다. 그것을 출발점으로 쓰면
#: '사이클 저점 실적이 영구 성장의 기점이 된다'는 문제가 거의 그대로 남는다.
#: 그래서 증권사 12개월 선행 컨센서스 → 다음 회계연도 컨센서스 → 스플라이스 순으로 본다.
FORWARD_START_EPS_CANDIDATES = (
    ("canonical_forward_eps", "consensus12m"),
    ("forward_eps_fy1", "consensusFy1"),
    ("forward_eps_ttm", "spliceTtm"),
)


def _resolve_forward_start_eps(forward_metrics) -> tuple[float | None, str | None]:
    """(출발 EPS, 출처 코드). 가장 앞선 전망부터 찾는다."""
    for field, source in FORWARD_START_EPS_CANDIDATES:
        value = getattr(forward_metrics, field, None)
        try:
            value = float(value) if value is not None else None
        except (TypeError, ValueError):
            value = None
        if value and value > 0:
            return value, source
    return None, None


def calculate_forward_intrinsic_value_dcf(
    metrics: list,
    line_items: list,
    risk_analysis: dict,
    forward_metrics,
) -> dict[str, any]:
    """선행 컨센서스 이익을 출발점으로 삼는 FCFF DCF.

    왜 따로 두는가
        기존 DCF 의 base FCFF 는 '지나간 실적'이다. 사이클 업종에서는 저점 현금흐름이
        영구 성장의 출발점이 되어 내재가치가 구조적으로 눌린다(반대로 정점 실적이
        출발점이면 부풀려진다). 같은 화면에 선행 PER 4.2 와 후행 PER 29.3 이 함께
        떠 있는데 DCF 만 후행을 보고 있으면, 독자는 두 숫자가 왜 다른지 알 수 없다.

    무엇을 바꾸고 무엇을 그대로 두는가
        · 출발점만 선행 컨센서스로 교체한다.
        · 할인율·감쇠·터미널·투영기간은 기존 DCF 와 완전히 동일하게 쓴다.
          둘의 차이가 오직 '어느 실적을 출발점으로 봤는가'가 되도록 하기 위함이다.

    기존 DCF 를 대체하지 않는다. 컨센서스는 상향 편향이 있고 컨센서스가 틀리면
    이 값도 함께 틀린다. 두 값을 나란히 놓고 폭을 보는 것이 이 함수의 목적이다.
    """
    if forward_metrics is None:
        return {"intrinsic_value": None, "reason": "선행 컨센서스가 없어 선행 DCF 미산출"}

    fwd_eps, eps_source = _resolve_forward_start_eps(forward_metrics)
    if not fwd_eps or fwd_eps <= 0:
        return {"intrinsic_value": None, "reason": "선행 EPS 가 없거나 적자 전망이라 선행 DCF 미산출"}

    shares = _resolve_share_count(metrics, line_items)
    if not shares:
        return {"intrinsic_value": None, "reason": "주식 수를 확인하지 못해 선행 DCF 미산출"}

    conversion, sample_n = _historical_fcff_conversion(line_items)
    if conversion is None:
        return {"intrinsic_value": None, "reason": "과거 현금전환율 표본이 없어 이익→현금흐름 환산 불가"}

    forward_net_income = fwd_eps * shares
    fcff_fwd = forward_net_income * conversion

    # 성장률: 컨센서스가 FY0→FY1 을 함께 주면 그 증가율을, 아니면 기존 DCF 와 같은
    # 과거 매출 CAGR 을 쓴다. 상한은 두지 않는다(사용자 요청) — 관측된 증가율을
    # 그대로 쓴다. 대신 그 값을 assumptions 에 실어 화면에서 보이게 한다.
    growth_source = "과거 매출 CAGR"
    base_growth = None
    fy0 = getattr(forward_metrics, "forward_eps_fy0", None)
    fy1 = getattr(forward_metrics, "forward_eps_fy1", None)
    if fy0 and fy1 and fy0 > 0:
        base_growth = fy1 / fy0 - 1
        growth_source = "컨센서스 FY0→FY1 이익 증가율"
    if base_growth is None:
        revs = [li.revenue for li in reversed(line_items) if getattr(li, "revenue", None)]
        if len(revs) >= 2 and revs[0] > 0:
            base_growth = (revs[-1] / revs[0]) ** (1 / (len(revs) - 1)) - 1
        else:
            base_growth = 0.04

    terminal_growth = 0.025
    years = 10
    discount = risk_analysis.get("cost_of_equity") or 0.09

    # 컨센서스 증가율이 영구성장률보다 낮게 나오면 감쇠 방향이 뒤집힌다.
    # 그 경우 감쇠 없이 영구성장률로 평탄하게 간다.
    base_growth = max(base_growth, terminal_growth)

    projected = _discount_fcff_path(fcff_fwd, base_growth, discount, years, terminal_growth)
    if projected is None:
        return {"intrinsic_value": None, "reason": "할인율이 영구성장률 이하라 선행 DCF 미산출"}

    pv_sum, tv = projected
    equity_value = pv_sum + tv

    return {
        "intrinsic_value": equity_value,
        "intrinsic_per_share": equity_value / shares,
        "assumptions": {
            "forward_eps_ttm": fwd_eps,
            # 어떤 선행 EPS 를 출발점으로 삼았는지. 화면에 같은 값이 두 개 뜨는데
            # (증권사 12M 컨센 vs 3분기 실적+1분기 컨센 스플라이스) 어느 쪽을 썼는지
            # 안 밝히면 독자가 두 숫자를 대조할 방법이 없다.
            "forward_eps_used": fwd_eps,
            "forward_eps_source": eps_source,
            "forward_net_income": forward_net_income,
            "fcff_conversion": conversion,
            "fcff_conversion_samples": sample_n,
            "base_fcff": fcff_fwd,
            "base_growth": base_growth,
            "growth_source": growth_source,
            "terminal_growth": terminal_growth,
            "discount_rate": discount,
            "projection_years": years,
            "confidence": getattr(forward_metrics, "confidence", None),
        },
        "details": [
            f"선행 FCFF DCF 산출 완료 — 출발 현금흐름은 선행 EPS×주식수×현금전환율 "
            f"{conversion:.2f}(과거 {sample_n}개 표본 중앙값), 성장률 출처는 {growth_source}"
        ],
    }


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
        # 12% 상한 제거(사용자 요청) — 관측된 과거 매출 CAGR 을 그대로 쓴다.
        base_growth = (revs[-1] / revs[0]) ** (1 / (len(revs) - 1)) - 1
    else:
        base_growth = 0.04  # fallback

    terminal_growth = 0.025
    years = 10

    # Discount rate
    discount = risk_analysis.get("cost_of_equity") or 0.09

    # 투영·감쇠·터미널은 선행 DCF 와 같은 함수를 쓴다. 두 벌로 두면 한쪽만 고쳐진다.
    projected = _discount_fcff_path(fcff0, base_growth, discount, years, terminal_growth)
    if projected is None:
        return {"intrinsic_value": None, "details": ["N/A: 할인율이 영구성장률 이하라 DCF 발산"]}
    pv_sum, tv = projected

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


def estimate_cost_of_equity(beta: float | None, risk_free: float | None = None) -> float:
    """CAPM: r_e = r_f + β × ERP.

    risk_free 를 주면 그 값을, 없으면 장기평균(4%)을 쓴다. 다모다란 본인은
    장기평균이 아니라 '현재 국채 금리'를 쓰라고 한다 — 주석이 그의 이름을 빌려
    반대로 하고 있었다.

    ERP 는 고정한다. 실시간으로 구할 수 있는 '이익수익률 갭'은 ERP 가 아니며,
    그 자리에 넣으면 할인율이 영구성장률 아래로 내려가 적정가가 폭증한다.
    상세는 tests/test_macro_regime.py 의 회귀 테스트를 보라.
    """
    rate = risk_free if risk_free is not None else DAMODARAN_RISK_FREE
    return capm_cost_of_equity(beta, rate, DAMODARAN_ERP)


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

                CORPORATE LIFE CYCLE REQUIREMENT (your own framework — *The Corporate Life Cycle*):
                입력 데이터의 `life_cycle` 과 `management_assessment` 는 재무 시계열에서
                결정론적으로 계산된 값이다. 추측하지 말고 그 값을 근거로 서술하라.
                - `life_cycle.stage_label_ko` 로 이 기업이 어느 단계인지 먼저 못 박아라.
                  근거는 `life_cycle.evidence_ko` 의 수치를 그대로 인용하라.
                - `life_cycle.playbook.valuation_ko` 에 적힌 '이 단계에 맞는 가치평가법'을
                  제시하고, 지금 쓰고 있는 DCF/상대가치가 그 처방과 맞는지 짚어라.
                  (성숙기 기업에 성장주 배수를 쓰는 식의 불일치가 있으면 명시)
                - `life_cycle.alignment_notes_ko` 에 무엇을 점검했고 무엇을 못 봤는지 이름으로 적혀 있다.
                  점검 항목의 "개수"("2 / 3")를 그대로 옮기지 마라 — 어느 항목이 빠졌는지
                  알 수 없어 독자가 쓸 수 없다. 항목 이름으로 쓰라.
                - `life_cycle.alignment_score` 는 단계가 요구하는 전략 대비 실제 행동의
                  이행도다. 낮으면 `alignment_notes_ko` 를 인용해 무엇이 어긋났는지 써라.
                  단, `alignment_checked` 가 `alignment_total_checks` 보다 작으면 일부 항목만
                  점검된 것이니 만점이라도 '문제 없음'으로 단정하지 말고 그 사실을 밝혀라.
                  당신의 핵심 주장 — 가치 파괴는 대개 '나이에 맞지 않는 행동'에서 온다.
                - `management_assessment` 는 자본배분 실적 기반 경영진 평가다.
                  `grade_ko` 와 `axes` 의 구체 수치를 인용하되, `insufficient` 가 true 이거나
                  `score` 가 null 인 축은 단정하지 말고 판단 보류로 남겨라.
                  경영진의 인품·비전 같은 검증 불가 항목은 절대 지어내지 마라.

                STORY 축 (당신의 "Story → Numbers → Value" 중 Story):
                - `management_said` 는 회사가 SEC 에 직접 제출한 실적 보도자료에서 뽑은
                  **경영진 원문 인용**과 전망이다. 경영진 발언을 쓸 때는 반드시 이 안의
                  문장만 인용하고, 화자(`speaker`)를 함께 밝혀라. 없으면 인용하지 마라.
                - `narrative_check` 는 회사가 스스로 쓴 서술의 어조를 재무로 판정한
                  생애주기 단계와 대조한 결과다. `aligned` 가 false 면 그 괴리를
                  분석의 핵심 리스크로 다뤄라 — 성숙한 기업이 성장 서사를 유지하면
                  그 이야기를 실현하려 과잉 투자로 가치를 파괴한다는 것이 당신의 논지다.
                  `evidence_ko` 에 담긴 회사 문장을 근거로 인용하라.
                - `narrative_check.insufficient` 가 true 면 서사 판정을 하지 마라.
                - 서사를 새로 지어내지 마라. 회사가 쓴 문장을 인용·대조만 하라.
                - `compensation` 은 위임장(DEF 14A)의 보상 원문이다. 자본배분 '결과'와
                  그것을 유도한 '인센티브'를 함께 봐라 — 보상이 성과에 연동돼 있는지,
                  단기 주가에만 걸려 있는지가 앞으로의 자본배분 행동을 좌우한다.
                  수치는 원문에 있는 것만 쓰고, 없으면 `제공된 자료에서 확인 불가`.
                {FORWARD_OUTLOOK_SYSTEM_INSTRUCTION}

                {COMPANY_IDENTITY_REQUIREMENT}

                {SENTIMENT_MARKER_REQUIREMENT}

                - `score` 값이 `"DATA_INSUFFICIENT"` 인 항목은 점수를 인용하지 말고 "데이터 부족으로 평가 보류"라고 명시한다. 그 축을 근거로 단정적 매수/매도 판단을 하지 않는다.

                - **숫자와 단계는 그 자체로 결론이 아니다.** 점수·배수·단계를 적었으면
                  반드시 같은 문장 안에서 "그래서 무슨 뜻인지"를 이어 써라.
                  · 나쁨: "재투자 수익성 점수 41.5 — 세후 ROIC 7.3% vs 자본비용 9.0%"
                  · 좋음: "재투자 수익성 41.5점. 번 수익률(7.3%)이 조달 비용(9.0%)보다
                    1.7%p 낮아, 재투자를 늘릴수록 주주 가치가 깎이는 구간이다."
                  `management_assessment.axes[].meaning_ko` 와
                  `life_cycle.stage_meaning_ko` 에 그 해석이 이미 들어 있으니 활용하라.
                - 단계 이름만 적고 끝내지 마라("5단계 · 성숙 안정." 만 쓰는 식). 그 단계이므로
                  어떤 잣대로 값을 매겨야 하고 무엇을 조심해야 하는지까지 한 문장으로 붙여라.
                - `signal` 의 영문 값(bearish/bullish/neutral)을 그대로 쓰지 말고
                  한국어(약세/강세/중립)로 쓰고, 왜 그 방향인지 한 줄을 덧붙여라.
                - **내재가치를 말할 때는 반드시 시가총액과 견주어라.** 계산값만 적으면
                  싼지 비싼지 알 수 없다. `intrinsic_val_analysis.meaning_ko` 에
                  '얼마 vs 얼마 → 그래서 싼가 비싼가'가 문장으로 들어 있으니 그대로 쓰라.
                  금액은 '973조 원'처럼 한국어 단위로 적고, 자릿수를 늘어놓지 마라.
                - **틀(프레임워크) 제목만 적고 끝내지 마라.** "Story → Numbers",
                  "가치(Value): FCFF DCF + 안전마진 + 상대가치 체크" 같은 목차성 문구는
                  독자에게 아무 정보가 아니다. 그 틀로 이 기업을 실제로 판정한 결과를 쓰거나,
                  쓸 내용이 없으면 그 항목을 아예 만들지 마라.
                - **영어 발언을 인용하면 한국어 번역을 함께 적어라.** 어닝콜·보도자료
                  원문은 영어인데 그대로만 실으면 읽는 사람이 뜻을 모른다. 원문을 적고
                  바로 다음 줄에 괄호로 번역을 붙여라. 예:
                    Lisa Su: "We expect revenue to grow substantially above our prior target."
                    (번역: 매출이 기존 목표를 크게 웃돌 것으로 봅니다.)
                  원문을 고치지는 마라 — 원문이 근거이고 번역은 읽기를 돕는 것이다.
                - **점수를 적을 때는 눈금을 함께 밝혀라.** "41.5점"만 쓰면 좋은지 나쁜지
                  알 수 없다. `management_assessment.axes[].scale_ko` 에 축마다 몇 점이
                  본전인지 적혀 있으니 그것을 근거로 "50점이 본전인데 41.5점" 처럼 써라.
                - 신뢰도(confidence)도 마찬가지다. 숫자만 적지 말고 그 숫자가 무엇을 뜻하는지
                  (판정 근거가 서로 얼마나 일치하는지, 그래서 이 결론을 얼마나 믿을지)를
                  한 줄로 밝혀라. 50%대면 "근거가 절반쯤만 같은 방향이라 확신도가 낮다"는 식으로.
                - 각 근거 카드는 '숫자 → 눈금 → 그래서 무엇을 해야 하는가' 순서로 맺어라.
                  마지막 문장이 투자자가 취할 행동이나 지켜볼 지점이어야 한다.

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
