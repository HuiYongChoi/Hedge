from __future__ import annotations

"""Semiconductor rerating analyst.

This agent bridges conservative intrinsic-value models and broker target prices
for memory semiconductor manufacturers. It is intentionally deterministic:
the score is a probability-weighted expected-value view, not another LLM
interpretation layer.
"""

import json
import math
import statistics
from typing import Any

from langchain_core.messages import HumanMessage

from src.agents.valuation import calculate_pbr_band
from src.graph.state import AgentState, show_agent_reasoning
from src.tools.analyst_target_api import fetch_analyst_target
from src.tools.api import get_financial_metrics, get_pbr_history, search_line_items
from src.tools.company_name import resolve_company_name
from src.utils.api_key import get_api_key_from_state
from src.utils.forward_outlook import get_cached_forward_metrics
from src.utils.progress import progress


MEMORY_TICKER_HINTS = {
    "MU",
    "000660",
    "000660.KS",
    "005930",
    "005930.KS",
    "285A",
    "285A.T",
    "WDC",
    "SNDK",
    "SIMO",
    "NANYF",
    "NANY",
}

MEMORY_NAME_KEYWORDS = (
    "micron",
    "sk hynix",
    "sk하이닉스",
    "samsung electronics",
    "삼성전자",
    "kioxia",
    "western digital",
    "sandisk",
    "nanya",
    "winbond",
    "powerchip",
    "memory",
    "dram",
    "nand",
    "hbm",
)

RECOMMENDED_MEMORY_AGENT_MIX = [
    "semiconductor_rerating_analyst",
    "valuation_analyst",
    "growth_analyst",
    "stanley_druckenmiller",
    "fundamentals_analyst",
    "news_sentiment_analyst",
]


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _pct(value: float | None) -> str:
    return "N/A" if value is None else f"{value:+.1%}"


def _money(value: float | None, currency: str) -> str:
    if value is None:
        return "N/A"
    symbol = "₩" if currency.upper() == "KRW" else "$" if currency.upper() == "USD" else ""
    return f"{symbol}{value:,.0f}" if symbol == "₩" else f"{symbol}{value:,.2f}"


def _is_memory_semiconductor(ticker: str, company_name: str | None) -> bool:
    normalized = (ticker or "").strip().upper()
    code = normalized.split(".")[0]
    if normalized in MEMORY_TICKER_HINTS or code in MEMORY_TICKER_HINTS:
        return True
    haystack = f"{company_name or ''} {ticker or ''}".lower()
    return any(keyword in haystack for keyword in MEMORY_NAME_KEYWORDS)


def _current_price(metrics, analyst_target) -> float | None:
    target_price = _finite_float(getattr(analyst_target, "current_price", None))
    if target_price and target_price > 0:
        return target_price

    market_cap = _finite_float(getattr(metrics, "market_cap", None))
    shares = _finite_float(getattr(metrics, "outstanding_shares", None))
    if market_cap and shares and shares > 0:
        return market_cap / shares
    return None


def _line_item_number(line_items: list, field: str) -> float | None:
    for item in line_items:
        value = _finite_float(getattr(item, field, None))
        if value is not None:
            return value
    return None


def _fcf_volatility(line_items: list) -> float | None:
    values = [
        value
        for item in line_items
        if (value := _finite_float(getattr(item, "free_cash_flow", None))) is not None
    ]
    if len(values) < 2:
        return None
    mean_abs = abs(statistics.mean(values))
    if mean_abs <= 0:
        return None
    return statistics.pstdev(values) / mean_abs


def _score_forward_inflection(metrics, forward_metrics) -> tuple[float, str, dict]:
    trailing_pe = _finite_float(getattr(metrics, "price_to_earnings_ratio", None))
    forward_pe = (
        _finite_float(getattr(forward_metrics, "canonical_forward_pe", None))
        or _finite_float(getattr(forward_metrics, "forward_pe", None))
    )
    forward_eps = (
        _finite_float(getattr(forward_metrics, "canonical_forward_eps", None))
        or _finite_float(getattr(forward_metrics, "forward_eps_ttm", None))
    )
    forward_fy0_eps = _finite_float(getattr(forward_metrics, "forward_eps_fy0", None))

    if trailing_pe is None or forward_pe is None or trailing_pe <= 0 or forward_pe <= 0:
        return 0.45, "unavailable", {
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "forward_eps": forward_eps,
            "forward_fy0_eps": forward_fy0_eps,
        }

    if forward_pe < trailing_pe:
        compression = (trailing_pe - forward_pe) / trailing_pe
        score = 0.55 + min(0.45, compression * 1.15)
        interpretation = "earnings_expansion"
    else:
        expansion = (forward_pe - trailing_pe) / trailing_pe
        score = max(0.05, 0.40 - expansion * 0.8)
        interpretation = "earnings_contraction_or_pressure"

    if forward_eps and forward_eps > 0:
        score += 0.05
    return _clamp(score), interpretation, {
        "trailing_pe": trailing_pe,
        "forward_pe": forward_pe,
        "forward_eps": forward_eps,
        "forward_fy0_eps": forward_fy0_eps,
    }


def _score_cycle_quality(metrics) -> tuple[float, dict]:
    revenue_growth = _finite_float(getattr(metrics, "revenue_growth", None))
    earnings_growth = (
        _finite_float(getattr(metrics, "earnings_per_share_growth", None))
        or _finite_float(getattr(metrics, "earnings_growth", None))
    )
    fcf_growth = _finite_float(getattr(metrics, "free_cash_flow_growth", None))
    operating_margin = _finite_float(getattr(metrics, "operating_margin", None))
    roic = _finite_float(getattr(metrics, "return_on_invested_capital", None))

    score = 0.0
    score += 0.25 if revenue_growth is not None and revenue_growth >= 0.20 else 0.12 if revenue_growth and revenue_growth > 0 else 0.0
    score += 0.20 if earnings_growth is not None and earnings_growth >= 0.25 else 0.10 if earnings_growth and earnings_growth > 0 else 0.0
    score += 0.15 if fcf_growth is not None and fcf_growth >= 0.15 else 0.08 if fcf_growth and fcf_growth > 0 else 0.0
    score += 0.20 if operating_margin is not None and operating_margin >= 0.20 else 0.10 if operating_margin and operating_margin > 0.10 else 0.0
    score += 0.20 if roic is not None and roic >= 0.15 else 0.10 if roic and roic > 0.08 else 0.0
    return _clamp(score), {
        "revenue_growth": revenue_growth,
        "earnings_growth": earnings_growth,
        "free_cash_flow_growth": fcf_growth,
        "operating_margin": operating_margin,
        "roic": roic,
    }


def _score_manufacturing_discipline(metrics, line_items: list) -> tuple[float, dict]:
    revenue = _line_item_number(line_items, "revenue") or _finite_float(getattr(metrics, "revenue", None))
    capex = _line_item_number(line_items, "capital_expenditure") or _finite_float(getattr(metrics, "capital_expenditure", None))
    fcf = _line_item_number(line_items, "free_cash_flow") or _finite_float(getattr(metrics, "free_cash_flow", None))
    debt_to_equity = _finite_float(getattr(metrics, "debt_to_equity", None))
    interest_coverage = _finite_float(getattr(metrics, "interest_coverage", None))
    fcf_volatility = _fcf_volatility(line_items)

    capex_ratio = abs(capex) / revenue if revenue and capex is not None else None
    score = 0.30 if capex_ratio is not None and 0.10 <= capex_ratio <= 0.35 else 0.15 if capex_ratio is not None and capex_ratio <= 0.50 else 0.0
    score += 0.25 if fcf is not None and fcf > 0 else 0.0
    score += 0.20 if debt_to_equity is not None and debt_to_equity <= 0.7 else 0.10 if debt_to_equity is not None and debt_to_equity <= 1.2 else 0.0
    score += 0.15 if interest_coverage is not None and interest_coverage >= 5 else 0.05 if interest_coverage is not None and interest_coverage >= 2 else 0.0
    score += 0.10 if fcf_volatility is None or fcf_volatility <= 0.65 else 0.0
    return _clamp(score), {
        "capex_to_revenue": capex_ratio,
        "free_cash_flow": fcf,
        "debt_to_equity": debt_to_equity,
        "interest_coverage": interest_coverage,
        "fcf_volatility": fcf_volatility,
    }


def _score_broker_validation(analyst_target, current_price: float | None) -> tuple[float, dict]:
    consensus = _finite_float(getattr(analyst_target, "consensus", None))
    high = _finite_float(getattr(analyst_target, "high", None))
    low = _finite_float(getattr(analyst_target, "low", None))
    count = _finite_float(getattr(analyst_target, "analyst_count", None))

    consensus_upside = (consensus - current_price) / current_price if consensus and current_price else None
    high_upside = (high - current_price) / current_price if high and current_price else None
    dispersion = ((high - low) / consensus) if high and low and consensus else None

    score = 0.0
    score += 0.45 if consensus_upside is not None and consensus_upside >= 0.20 else 0.30 if consensus_upside and consensus_upside > 0.05 else 0.10 if consensus_upside is not None and consensus_upside > -0.05 else 0.0
    score += 0.25 if high_upside is not None and high_upside >= 0.50 else 0.12 if high_upside and high_upside > 0.15 else 0.0
    score += 0.20 if count is not None and count >= 10 else 0.10 if count is not None and count >= 5 else 0.0
    score += 0.10 if dispersion is not None and dispersion <= 0.90 else 0.04 if dispersion is not None and dispersion <= 1.40 else 0.0
    return _clamp(score), {
        "broker_consensus_price": consensus,
        "broker_high_price": high,
        "broker_low_price": low,
        "analyst_count": count,
        "consensus_upside": consensus_upside,
        "high_upside": high_upside,
        "target_dispersion": dispersion,
    }


def _score_valuation_bridge(pbr_band: dict | None, current_price: float | None, cycle_score: float) -> tuple[float, dict]:
    if not pbr_band or not current_price:
        return 0.40, {
            "pbr_p50_price": None,
            "pbr_p75_price": None,
            "pbr_p90_price": None,
            "pbr_upside_to_p90": None,
        }

    p50 = _finite_float(pbr_band.get("fair_price_p50"))
    p75 = _finite_float(pbr_band.get("fair_price_p75"))
    p90 = _finite_float(pbr_band.get("fair_price_p90"))
    current_pbr = _finite_float(pbr_band.get("current_pbr"))
    percentiles = pbr_band.get("percentiles") if isinstance(pbr_band.get("percentiles"), dict) else {}
    p90_mult = _finite_float(percentiles.get("p90")) if percentiles else None

    p90_upside = (p90 - current_price) / current_price if p90 else None
    p75_upside = (p75 - current_price) / current_price if p75 else None

    score = 0.35
    if p90_upside is not None:
        score += 0.30 if p90_upside > 0.15 else 0.18 if p90_upside > 0 else -0.10
    if p75_upside is not None:
        score += 0.15 if p75_upside > 0 else 0.0
    if current_pbr and p90_mult and current_pbr > p90_mult and cycle_score < 0.70:
        score -= 0.20
    if pbr_band.get("rerating_note"):
        score += 0.10

    return _clamp(score), {
        "pbr_p50_price": p50,
        "pbr_p75_price": p75,
        "pbr_p90_price": p90,
        "current_pbr": current_pbr,
        "pbr_upside_to_p90": p90_upside,
        "pbr_upside_to_p75": p75_upside,
        "pbr_position_label": pbr_band.get("position_label"),
        "pbr_rerating_note": pbr_band.get("rerating_note"),
    }


def build_semiconductor_rerating_thesis(
    *,
    ticker: str,
    company_name: str,
    metrics,
    line_items: list,
    forward_metrics,
    analyst_target,
    pbr_band: dict | None,
) -> dict:
    """Build a probability-weighted memory semiconductor rerating thesis."""
    currency = getattr(metrics, "currency", "USD") or getattr(analyst_target, "currency", "USD")
    current_price = _current_price(metrics, analyst_target)
    applicable = _is_memory_semiconductor(ticker, company_name)

    forward_score, forward_interpretation, forward_details = _score_forward_inflection(metrics, forward_metrics)
    cycle_score, cycle_details = _score_cycle_quality(metrics)
    manufacturing_score, manufacturing_details = _score_manufacturing_discipline(metrics, line_items)
    broker_score, broker_details = _score_broker_validation(analyst_target, current_price)
    valuation_score, valuation_details = _score_valuation_bridge(pbr_band, current_price, cycle_score)

    axis_scores = {
        "forward_earnings_inflection": round(forward_score, 3),
        "cycle_quality": round(cycle_score, 3),
        "valuation_bridge": round(valuation_score, 3),
        "broker_validation": round(broker_score, 3),
        "manufacturing_discipline": round(manufacturing_score, 3),
    }
    weights = {
        "forward_earnings_inflection": 0.28,
        "cycle_quality": 0.20,
        "valuation_bridge": 0.20,
        "broker_validation": 0.17,
        "manufacturing_discipline": 0.15,
    }

    rerating_probability = sum(axis_scores[key] * weights[key] for key in weights)
    if not applicable:
        rerating_probability *= 0.55

    consensus = broker_details["broker_consensus_price"]
    high = broker_details["broker_high_price"]
    p90 = valuation_details["pbr_p90_price"]
    p75 = valuation_details["pbr_p75_price"]
    p50 = valuation_details["pbr_p50_price"]

    target_candidates = [value for value in (consensus, p90, p75) if value and value > 0]
    if not target_candidates and current_price:
        target_candidates = [current_price]
    rerating_target = sum(target_candidates) / len(target_candidates) if target_candidates else None
    if high and rerating_target:
        rerating_target = rerating_target * 0.85 + high * 0.15

    downside_anchor = p50 if p50 and p50 > 0 else current_price * 0.85 if current_price else None
    if rerating_target and downside_anchor:
        expected_price = rerating_probability * rerating_target + (1 - rerating_probability) * downside_anchor
    else:
        expected_price = None
    expected_return = (expected_price - current_price) / current_price if expected_price and current_price else None

    if expected_return is not None and expected_return >= 0.10 and rerating_probability >= 0.55:
        signal = "bullish"
    elif expected_return is not None and (expected_return <= -0.10 or rerating_probability <= 0.35):
        signal = "bearish"
    else:
        signal = "neutral"

    confidence = int(
        _clamp(
            42
            + abs((expected_return or 0.0)) * 115
            + abs(rerating_probability - 0.50) * 45
            + (8 if broker_details["analyst_count"] and broker_details["analyst_count"] >= 10 else 0),
            0,
            95,
        )
    )

    forward_pe = forward_details["forward_pe"]
    trailing_pe = forward_details["trailing_pe"]
    direction_text = (
        "선행 PER이 TTM PER보다 낮아 컨센서스는 이익 확장을 시사합니다"
        if forward_interpretation == "earnings_expansion"
        else "선행 PER이 TTM PER보다 높아 이익 둔화 또는 밸류에이션 부담을 시사합니다"
        if forward_interpretation == "earnings_contraction_or_pressure"
        else "선행 PER 비교 데이터가 제한적입니다"
    )
    summary = (
        f"{company_name} 리레이팅 확률 {rerating_probability:.0%}, 기대수익률 {_pct(expected_return)}. "
        f"{direction_text}"
    )
    if forward_pe and trailing_pe:
        summary += f" (선행 PER {forward_pe:.1f}, TTM PER {trailing_pe:.1f})."
    if consensus:
        summary += f" 증권사 평균 목표가는 {_money(consensus, currency)}입니다."

    scenario_analysis = {
        "current_price": current_price,
        "downside_anchor_price": downside_anchor,
        "rerating_target_price": rerating_target,
        "expected_price": expected_price,
        "expected_return": expected_return,
        "broker_consensus_price": consensus,
        "broker_high_price": high,
        "pbr_p50_price": p50,
        "pbr_p75_price": p75,
        "pbr_p90_price": p90,
        "probabilities": {
            "rerating": rerating_probability,
            "downside_or_delay": 1 - rerating_probability,
        },
    }

    return {
        "applicable": applicable,
        "signal": signal,
        "confidence": confidence,
        "current_price": current_price,
        "rerating_probability": rerating_probability,
        "expected_price": expected_price,
        "expected_return": expected_return,
        "axis_scores": axis_scores,
        "weights": weights,
        "forward_interpretation": forward_interpretation,
        "forward_details": forward_details,
        "cycle_quality": cycle_details,
        "manufacturing_discipline": manufacturing_details,
        "broker_validation": broker_details,
        "valuation_bridge": valuation_details,
        "scenario_analysis": scenario_analysis,
        "recommended_agent_mix": RECOMMENDED_MEMORY_AGENT_MIX,
        "summary": summary,
    }


def semiconductor_rerating_analyst_agent(
    state: AgentState,
    agent_id: str = "semiconductor_rerating_analyst_agent",
):
    data = state["data"]
    end_date = data["end_date"]
    tickers = data["tickers"]
    api_key = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")
    analysis: dict[str, dict] = {}

    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Fetching memory rerating inputs")
        metrics_list = get_financial_metrics(
            ticker=ticker,
            end_date=end_date,
            period="ttm",
            limit=8,
            api_key=api_key,
        )
        if not metrics_list:
            progress.update_status(agent_id, ticker, "Failed: No financial metrics")
            continue
        metrics = metrics_list[0]
        company_name = resolve_company_name(ticker)

        line_items = search_line_items(
            ticker=ticker,
            line_items=[
                "revenue",
                "capital_expenditure",
                "free_cash_flow",
                "operating_income",
                "outstanding_shares",
            ],
            end_date=end_date,
            period="ttm",
            limit=8,
            api_key=api_key,
        )

        forward_metrics = get_cached_forward_metrics(state, ticker, end_date, api_key)
        try:
            analyst_target = fetch_analyst_target(ticker)
        except Exception:
            analyst_target = None

        current_price = _current_price(metrics, analyst_target) if analyst_target else _current_price(metrics, None)
        shares_outstanding = _finite_float(getattr(metrics, "outstanding_shares", None))
        if not shares_outstanding:
            shares_outstanding = _line_item_number(line_items, "outstanding_shares")

        pbr_band = calculate_pbr_band(
            financial_metrics=metrics_list,
            pbr_history=get_pbr_history(ticker=ticker, end_date=end_date, limit=8, api_key=api_key),
            current_price=current_price,
            shares_outstanding=shares_outstanding,
            revenue_growth=getattr(metrics, "revenue_growth", None),
        )

        if analyst_target is None:
            analyst_target = type(
                "EmptyAnalystTarget",
                (),
                {
                    "consensus": None,
                    "high": None,
                    "low": None,
                    "median": None,
                    "analyst_count": None,
                    "current_price": current_price,
                    "currency": getattr(metrics, "currency", "USD"),
                },
            )()

        thesis = build_semiconductor_rerating_thesis(
            ticker=ticker,
            company_name=company_name,
            metrics=metrics,
            line_items=line_items,
            forward_metrics=forward_metrics,
            analyst_target=analyst_target,
            pbr_band=pbr_band,
        )

        result = {
            "signal": thesis["signal"],
            "confidence": thesis["confidence"],
            "company_name": company_name,
            "reasoning": thesis,
            "rerating_analysis": {
                "applicable": thesis["applicable"],
                "rerating_probability": thesis["rerating_probability"],
                "expected_price": thesis["expected_price"],
                "expected_return": thesis["expected_return"],
                "axis_scores": thesis["axis_scores"],
                "weights": thesis["weights"],
                "forward_interpretation": thesis["forward_interpretation"],
                "summary": thesis["summary"],
            },
            "scenario_analysis": thesis["scenario_analysis"],
            "recommended_agent_mix": thesis["recommended_agent_mix"],
        }
        analysis[ticker] = result
        progress.update_status(agent_id, ticker, "Done", analysis=json.dumps(result, ensure_ascii=False, indent=2, default=str))

    message = HumanMessage(content=json.dumps(analysis, ensure_ascii=False, default=str), name=agent_id)
    if state["metadata"].get("show_reasoning"):
        show_agent_reasoning(analysis, "Semiconductor Rerating Analyst")

    state["data"]["analyst_signals"][agent_id] = analysis
    progress.update_status(agent_id, None, "Done")
    return {"messages": [message], "data": data}
