from __future__ import annotations

"""Valuation Agent

Implements four complementary valuation methodologies and aggregates them with
configurable weights. 
"""

import json
import statistics
from langchain_core.messages import HumanMessage
from src.graph.state import AgentState, show_agent_reasoning
from src.utils.progress import progress
from src.utils.api_key import get_api_key_from_state
from src.tools.api import (
    get_financial_metrics,
    get_market_cap,
    search_line_items,
)
from src.utils.forward_outlook import get_cached_forward_metrics


def _format_ratio(value: float | None) -> str:
    return f"{value:.2f}" if value is not None else "N/A"


def _select_forward_pe(forward_metrics) -> float | None:
    canonical = getattr(forward_metrics, "canonical_forward_pe", None)
    return canonical if canonical is not None else getattr(forward_metrics, "forward_pe", None)


def _blend_trailing_forward_pe(trailing_pe: float | None, forward_metrics) -> tuple[float | None, float | None, float, float, str | None]:
    forward_pe = _select_forward_pe(forward_metrics)
    confidence = getattr(forward_metrics, "confidence", None)

    if forward_metrics is None or forward_pe is None:
        return trailing_pe, forward_pe, 1.0 if trailing_pe is not None else 0.0, 0.0, confidence

    if trailing_pe is None:
        return forward_pe, forward_pe, 0.0, 1.0, confidence

    if confidence == "low":
        trailing_weight = 0.65
        forward_weight = 0.35
        return (trailing_pe * trailing_weight) + (forward_pe * forward_weight), forward_pe, trailing_weight, forward_weight, confidence

    return (trailing_pe * 0.5) + (forward_pe * 0.5), forward_pe, 0.5, 0.5, confidence


def _forward_pe_interpretation(trailing_pe: float | None, forward_pe: float | None, confidence: str | None) -> str:
    if trailing_pe is None or forward_pe is None:
        return "Forward P/E comparison unavailable."
    direction = (
        "below TTM P/E; consensus implies earnings and operating-income expansion"
        if forward_pe < trailing_pe
        else "above TTM P/E; consensus implies earnings contraction or valuation pressure"
    )
    confidence_note = " Low confidence: use this as directional, not as a trailing-only override." if confidence == "low" else ""
    return f"Baseline forward P/E {forward_pe:.2f}x is {direction} vs TTM P/E {trailing_pe:.2f}x.{confidence_note}"


def valuation_analyst_agent(state: AgentState, agent_id: str = "valuation_analyst_agent"):
    """Run valuation across tickers and write signals back to `state`."""

    data = state["data"]
    end_date = data["end_date"]
    tickers = data["tickers"]
    api_key = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")
    valuation_analysis: dict[str, dict] = {}

    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Fetching financial data")

        # --- Historical financial metrics ---
        financial_metrics = get_financial_metrics(
            ticker=ticker,
            end_date=end_date,
            period="ttm",
            limit=8,
            api_key=api_key,
        )
        if not financial_metrics:
            progress.update_status(agent_id, ticker, "Failed: No financial metrics found")
            continue
        most_recent_metrics = financial_metrics[0]

        progress.update_status(agent_id, ticker, "Fetching forward metrics")
        forward_metrics = get_cached_forward_metrics(state, ticker, end_date, api_key)

        # --- Enhanced line‑items ---
        progress.update_status(agent_id, ticker, "Gathering comprehensive line items")
        line_items = search_line_items(
            ticker=ticker,
            line_items=[
                "free_cash_flow",
                "net_income",
                "depreciation_and_amortization",
                "capital_expenditure",
                "working_capital",
                "total_debt",
                "cash_and_equivalents", 
                "interest_expense",
                "revenue",
                "operating_income",
                "ebit",
                "ebitda",
                "outstanding_shares",
            ],
            end_date=end_date,
            period="ttm",
            limit=8,
            api_key=api_key,
        )
        if not line_items:
            progress.update_status(agent_id, ticker, "Failed: Insufficient financial line items")
            continue
        li_curr = line_items[0]
        li_prev = line_items[1] if len(line_items) > 1 else li_curr
        if len(line_items) == 1:
            progress.update_status(agent_id, ticker, "Using current line item snapshot only")

        # ------------------------------------------------------------------
        # Valuation models
        # ------------------------------------------------------------------
        # Handle potential None values for working capital
        if li_curr.working_capital is not None and li_prev.working_capital is not None:
            wc_change = li_curr.working_capital - li_prev.working_capital
        else:
            wc_change = 0  # Default to 0 if working capital data is unavailable

        # Owner Earnings
        owner_val = calculate_owner_earnings_value(
            net_income=li_curr.net_income,
            depreciation=li_curr.depreciation_and_amortization,
            capex=li_curr.capital_expenditure,
            working_capital_change=wc_change,
            growth_rate=most_recent_metrics.earnings_growth or 0.05,
        )

        # Enhanced Discounted Cash Flow with WACC and scenarios
        progress.update_status(agent_id, ticker, "Calculating WACC and enhanced DCF")
        
        # Calculate WACC
        wacc = calculate_wacc(
            market_cap=most_recent_metrics.market_cap or 0,
            total_debt=getattr(li_curr, 'total_debt', None),
            cash=getattr(li_curr, 'cash_and_equivalents', None),
            interest_coverage=most_recent_metrics.interest_coverage,
            debt_to_equity=most_recent_metrics.debt_to_equity,
        )
        
        # Prepare FCF history for enhanced DCF
        fcf_history = []
        for li in line_items:
            if hasattr(li, 'free_cash_flow') and li.free_cash_flow is not None:
                fcf_history.append(li.free_cash_flow)
        
        # Enhanced DCF with scenarios
        dcf_results = calculate_dcf_scenarios(
            fcf_history=fcf_history,
            growth_metrics={
                'revenue_growth': most_recent_metrics.revenue_growth,
                'fcf_growth': most_recent_metrics.free_cash_flow_growth,
                'earnings_growth': most_recent_metrics.earnings_growth
            },
            wacc=wacc,
            market_cap=most_recent_metrics.market_cap or 0,
            revenue_growth=most_recent_metrics.revenue_growth
        )
        
        dcf_val = dcf_results['expected_value']

        # Implied Equity Value
        ev_ebitda_val = calculate_ev_ebitda_value(financial_metrics)

        shares_outstanding: float | None = (
            most_recent_metrics.outstanding_shares
            or getattr(li_curr, "outstanding_shares", None)
        )
        if shares_outstanding is not None and shares_outstanding <= 0:
            shares_outstanding = None

        # Residual Income Model — book-value anchored view for cyclical semiconductors.
        rim_breakdown = calculate_residual_income_breakdown(
            market_cap=most_recent_metrics.market_cap,
            net_income=li_curr.net_income,
            price_to_book_ratio=most_recent_metrics.price_to_book_ratio,
            shares_outstanding=shares_outstanding,
            book_value_growth=most_recent_metrics.book_value_growth or 0.03,
        )
        rim_val = rim_breakdown["intrinsic_with_mos"] if rim_breakdown else calculate_residual_income_value(
            market_cap=most_recent_metrics.market_cap,
            net_income=li_curr.net_income,
            price_to_book_ratio=most_recent_metrics.price_to_book_ratio,
            book_value_growth=most_recent_metrics.book_value_growth or 0.03,
        )

        pbr_band_result = calculate_pbr_band(
            financial_metrics=financial_metrics,
            current_price=(
                most_recent_metrics.market_cap / shares_outstanding
                if most_recent_metrics.market_cap and shares_outstanding
                else None
            ),
            shares_outstanding=shares_outstanding,
            revenue_growth=most_recent_metrics.revenue_growth,
            ticker=ticker,
        )

        regime = detect_capex_regime(
            capex=li_curr.capital_expenditure,
            revenue=li_curr.revenue,
            fcf_history=fcf_history,
        )

        # ------------------------------------------------------------------
        # Aggregate & signal
        # ------------------------------------------------------------------
        market_cap = get_market_cap(ticker, end_date, api_key=api_key)
        if not market_cap:
            progress.update_status(agent_id, ticker, "Failed: Market cap unavailable")
            continue

        if regime == "capex_heavy":
            base_weights = {
                "dcf": 0.20,
                "owner_earnings": 0.25,
                "ev_ebitda": 0.20,
                "residual_income": 0.20,
                "pbr_band": 0.15,
            }
        else:
            base_weights = {
                "dcf": 0.30,
                "owner_earnings": 0.30,
                "ev_ebitda": 0.15,
                "residual_income": 0.10,
                "pbr_band": 0.15,
            }

        pbr_equity_val = 0.0
        if pbr_band_result and pbr_band_result.get("fair_price_p50") and shares_outstanding:
            pbr_equity_val = pbr_band_result["fair_price_p50"] * shares_outstanding

        if pbr_equity_val <= 0 and "pbr_band" in base_weights:
            dropped_weight = base_weights.pop("pbr_band")
            total_remaining = sum(base_weights.values())
            base_weights = {
                key: weight + weight / total_remaining * dropped_weight
                for key, weight in base_weights.items()
            }

        method_values = {
            "dcf": {"value": dcf_val, "weight": base_weights["dcf"]},
            "owner_earnings": {"value": owner_val, "weight": base_weights["owner_earnings"]},
            "ev_ebitda": {"value": ev_ebitda_val, "weight": base_weights["ev_ebitda"]},
            "residual_income": {"value": rim_val, "weight": base_weights["residual_income"]},
        }
        if pbr_equity_val > 0:
            method_values["pbr_band"] = {"value": pbr_equity_val, "weight": base_weights["pbr_band"]}

        total_weight = sum(v["weight"] for v in method_values.values() if v["value"] > 0)
        if total_weight == 0:
            progress.update_status(agent_id, ticker, "Failed: All valuation methods zero")
            continue

        for v in method_values.values():
            v["gap"] = (v["value"] - market_cap) / market_cap if v["value"] > 0 else None

        weighted_gap = sum(
            v["weight"] * v["gap"] for v in method_values.values() if v["gap"] is not None
        ) / total_weight

        signal = "bullish" if weighted_gap > 0.15 else "bearish" if weighted_gap < -0.15 else "neutral"
        confidence = round(min(abs(weighted_gap) / 0.30 * 100, 100))

        capex_ratio = abs(li_curr.capital_expenditure or 0) / li_curr.revenue if li_curr.revenue else 0
        fcf_vol = calculate_fcf_volatility(fcf_history) if fcf_history else 0
        regime_note = (
            f"CapEx/매출 {capex_ratio:.0%}, FCF 변동성 {fcf_vol:.2f} → "
            f"RIM/PBR 가중 상향 (DCF {base_weights['dcf']:.0%} / RIM {base_weights['residual_income']:.0%})"
            if regime == "capex_heavy"
            else None
        )

        # Enhanced reasoning with DCF scenario details
        reasoning = {
            "regime": regime,
            "regime_note": regime_note,
        }
        for m, vals in method_values.items():
            if vals["value"] > 0:
                intrinsic_per_share = (
                    vals["value"] / shares_outstanding
                    if shares_outstanding else None
                )
                base_details = (
                    f"Value: ${vals['value']:,.2f}, Market Cap: ${market_cap:,.2f}, "
                    f"Gap: {vals['gap']:.1%}, Weight: {vals['weight']*100:.0f}%"
                    + (f", Per-share: {intrinsic_per_share:,.2f}" if intrinsic_per_share else "")
                )

                # Add enhanced DCF details
                if m == "dcf" and 'dcf_results' in locals():
                    enhanced_details = (
                        f"{base_details}\n"
                        f"  WACC: {wacc:.1%}, Bear: ${dcf_results['downside']:,.2f}, "
                        f"Bull: ${dcf_results['upside']:,.2f}, Range: ${dcf_results['range']:,.2f}"
                    )
                else:
                    enhanced_details = base_details

                reasoning[f"{m}_analysis"] = {
                    "signal": (
                        "bullish" if vals["gap"] and vals["gap"] > 0.15 else
                        "bearish" if vals["gap"] and vals["gap"] < -0.15 else "neutral"
                    ),
                    "details": enhanced_details,
                    "intrinsic_total": vals["value"],
                    "intrinsic_per_share": intrinsic_per_share,
                    "weight_used": vals["weight"],
                    "gap_to_market": vals["gap"],
                }
        
        # Add overall DCF scenario summary if available
        if 'dcf_results' in locals():
            reasoning["dcf_scenario_analysis"] = {
                "bear_case": f"${dcf_results['downside']:,.2f}",
                "base_case": f"${dcf_results['scenarios']['base']:,.2f}",
                "bull_case": f"${dcf_results['upside']:,.2f}",
                "wacc_used": f"{wacc:.1%}",
                "fcf_periods_analyzed": len(fcf_history)
            }

        if rim_breakdown:
            rim_gap = rim_breakdown.get("gap_to_market_cap")
            rim_signal = (
                "bullish" if rim_gap and rim_gap > 0.15 else
                "bearish" if rim_gap and rim_gap < -0.15 else "neutral"
            )
            rim_per_share = rim_breakdown.get("intrinsic_per_share")
            reasoning["rim_analysis"] = {
                "signal": rim_signal,
                "details": (
                    f"Equity intrinsic: {rim_breakdown['intrinsic_total']:,.0f}, "
                    f"Per-share: {rim_per_share:,.0f}" if rim_per_share else
                    f"Equity intrinsic: {rim_breakdown['intrinsic_total']:,.0f}"
                ) + (f", Gap: {rim_gap:.1%}" if rim_gap is not None else "") + f", Weight: {base_weights['residual_income']:.0%}",
                "book_value": rim_breakdown["book_value"],
                "book_value_per_share": rim_breakdown.get("book_value_per_share"),
                "roe_implied": rim_breakdown["roe_implied"],
                "cost_of_equity": rim_breakdown["cost_of_equity"],
                "spread_roe_ke": rim_breakdown["spread_roe_ke"],
                "book_value_growth": rim_breakdown["book_value_growth"],
                "ri_year_1": rim_breakdown["ri_year_1"],
                "present_value_ri": rim_breakdown["present_value_ri"],
                "terminal_pv_ri": rim_breakdown["terminal_pv_ri"],
                "intrinsic_total": rim_breakdown["intrinsic_total"],
                "intrinsic_per_share": rim_per_share,
                "weight_used": base_weights["residual_income"],
                "gap_to_market": rim_gap,
            }
        else:
            reasoning["rim_analysis"] = {"signal": "neutral", "details": "데이터 부족"}

        if pbr_band_result:
            reasoning["pbr_band_analysis"] = {
                **pbr_band_result,
                "weight_used": base_weights.get("pbr_band", 0),
            }

        trailing_pe = most_recent_metrics.price_to_earnings_ratio
        blended_pe, forward_pe, trailing_weight, forward_weight, forward_confidence = _blend_trailing_forward_pe(
            trailing_pe,
            forward_metrics,
        )
        forward_interpretation = _forward_pe_interpretation(trailing_pe, forward_pe, forward_confidence)
        if blended_pe is None:
            pe_signal = "neutral"
        elif blended_pe < 15:
            pe_signal = "bullish"
        elif blended_pe > 30:
            pe_signal = "bearish"
        else:
            pe_signal = "neutral"

        forward_pe_fy0 = getattr(forward_metrics, "forward_pe_fy0", None) if forward_metrics else None
        forward_pe_fy1 = getattr(forward_metrics, "forward_pe_fy1", None) if forward_metrics else None
        fy0_est = getattr(forward_metrics, "fy0_estimate", None) if forward_metrics else None
        fy1_est = getattr(forward_metrics, "fy1_estimate", None) if forward_metrics else None
        raw_spliced_forward_pe = getattr(forward_metrics, "forward_pe", None) if forward_metrics else None

        reasoning["forward_per_analysis"] = {
            "signal": pe_signal,
            "details": (
                f"{forward_interpretation} "
                f"Trailing P/E: {_format_ratio(trailing_pe)}, "
                f"Baseline forward P/E: {_format_ratio(forward_pe)}, "
                f"Blended P/E: {_format_ratio(blended_pe)}, "
                f"Forward P/E (FY0 annual): {_format_ratio(forward_pe_fy0)}, "
                f"Forward P/E (FY+1 annual): {_format_ratio(forward_pe_fy1)}, "
                f"Forward confidence: {forward_confidence or 'N/A'}, "
                f"Weights: trailing {trailing_weight:.0%} / forward {forward_weight:.0%}"
            ),
            "forward_interpretation": forward_interpretation,
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "raw_spliced_forward_pe": raw_spliced_forward_pe,
            "blended_pe": blended_pe,
            "trailing_weight": trailing_weight,
            "forward_weight": forward_weight,
            "forward_confidence": forward_confidence,
            "forward_pe_fy0": forward_pe_fy0,
            "forward_pe_fy1": forward_pe_fy1,
            "fy0_fiscal_year": fy0_est.fiscal_year if fy0_est else None,
            "fy1_fiscal_year": fy1_est.fiscal_year if fy1_est else None,
        }

        base_growth = most_recent_metrics.revenue_growth
        sensitivity_matrix = _build_sensitivity_matrix(
            lambda wacc, growth: calculate_enhanced_dcf_value(
                fcf_history=fcf_history,
                growth_metrics={
                    'revenue_growth': most_recent_metrics.revenue_growth,
                    'fcf_growth': most_recent_metrics.free_cash_flow_growth,
                    'earnings_growth': most_recent_metrics.earnings_growth,
                },
                wacc=wacc,
                market_cap=market_cap,
                revenue_growth=growth,
            ),
            base_wacc=wacc,
            base_growth=base_growth,
            current_price=market_cap,
        )
        if sensitivity_matrix:
            reasoning["sensitivity_matrix"] = sensitivity_matrix

        valuation_analysis[ticker] = {
            "signal": signal,
            "confidence": confidence,
            "reasoning": reasoning,
        }
        progress.update_status(agent_id, ticker, "Done", analysis=json.dumps(reasoning, indent=4))

    # ---- Emit message (for LLM tool chain) ----
    msg = HumanMessage(content=json.dumps(valuation_analysis), name=agent_id)
    if state["metadata"].get("show_reasoning"):
        show_agent_reasoning(valuation_analysis, "Valuation Analysis Agent")

    # Add the signal to the analyst_signals list
    state["data"]["analyst_signals"][agent_id] = valuation_analysis

    progress.update_status(agent_id, None, "Done")
    
    return {"messages": [msg], "data": data}

#############################
# Helper Valuation Functions
#############################

def calculate_owner_earnings_value(
    net_income: float | None,
    depreciation: float | None,
    capex: float | None,
    working_capital_change: float | None,
    growth_rate: float = 0.05,
    required_return: float = 0.15,
    margin_of_safety: float = 0.25,
    num_years: int = 5,
) -> float:
    """Buffett owner‑earnings valuation with margin‑of‑safety."""
    if not all(isinstance(x, (int, float)) for x in [net_income, depreciation, capex, working_capital_change]):
        return 0

    owner_earnings = net_income + depreciation - capex - working_capital_change
    if owner_earnings <= 0:
        return 0

    pv = 0.0
    for yr in range(1, num_years + 1):
        future = owner_earnings * (1 + growth_rate) ** yr
        pv += future / (1 + required_return) ** yr

    terminal_growth = min(growth_rate, 0.03)
    term_val = (owner_earnings * (1 + growth_rate) ** num_years * (1 + terminal_growth)) / (
        required_return - terminal_growth
    )
    pv_term = term_val / (1 + required_return) ** num_years

    intrinsic = pv + pv_term
    return intrinsic * (1 - margin_of_safety)


def calculate_intrinsic_value(
    free_cash_flow: float | None,
    growth_rate: float = 0.05,
    discount_rate: float = 0.10,
    terminal_growth_rate: float = 0.02,
    num_years: int = 5,
) -> float:
    """Classic DCF on FCF with constant growth and terminal value."""
    if free_cash_flow is None or free_cash_flow <= 0:
        return 0

    pv = 0.0
    for yr in range(1, num_years + 1):
        fcft = free_cash_flow * (1 + growth_rate) ** yr
        pv += fcft / (1 + discount_rate) ** yr

    term_val = (
        free_cash_flow * (1 + growth_rate) ** num_years * (1 + terminal_growth_rate)
    ) / (discount_rate - terminal_growth_rate)
    pv_term = term_val / (1 + discount_rate) ** num_years

    return pv + pv_term


def calculate_ev_ebitda_value(financial_metrics: list):
    """Implied equity value via median EV/EBITDA multiple."""
    if not financial_metrics:
        return 0
    m0 = financial_metrics[0]
    if not (m0.enterprise_value and m0.enterprise_value_to_ebitda_ratio):
        return 0
    if m0.enterprise_value_to_ebitda_ratio == 0:
        return 0

    ebitda_now = m0.enterprise_value / m0.enterprise_value_to_ebitda_ratio
    med_mult = statistics.median([
        m.enterprise_value_to_ebitda_ratio for m in financial_metrics if m.enterprise_value_to_ebitda_ratio
    ])
    ev_implied = med_mult * ebitda_now
    net_debt = (m0.enterprise_value or 0) - (m0.market_cap or 0)
    return max(ev_implied - net_debt, 0)


def calculate_residual_income_value(
    market_cap: float | None,
    net_income: float | None,
    price_to_book_ratio: float | None,
    book_value_growth: float = 0.03,
    cost_of_equity: float = 0.10,
    terminal_growth_rate: float = 0.03,
    num_years: int = 5,
):
    """Residual Income Model (Edwards‑Bell‑Ohlson)."""
    if not (market_cap and net_income and price_to_book_ratio and price_to_book_ratio > 0):
        return 0

    book_val = market_cap / price_to_book_ratio
    ri0 = net_income - cost_of_equity * book_val
    if ri0 <= 0:
        return 0

    pv_ri = 0.0
    for yr in range(1, num_years + 1):
        ri_t = ri0 * (1 + book_value_growth) ** yr
        pv_ri += ri_t / (1 + cost_of_equity) ** yr

    term_ri = ri0 * (1 + book_value_growth) ** (num_years + 1) / (
        cost_of_equity - terminal_growth_rate
    )
    pv_term = term_ri / (1 + cost_of_equity) ** num_years

    intrinsic = book_val + pv_ri + pv_term
    return intrinsic * 0.8  # 20% margin of safety


def calculate_residual_income_breakdown(
    market_cap: float | None,
    net_income: float | None,
    price_to_book_ratio: float | None,
    shares_outstanding: float | None,
    book_value_growth: float = 0.03,
    cost_of_equity: float = 0.10,
    terminal_growth_rate: float = 0.03,
    num_years: int = 5,
) -> dict | None:
    """Residual Income Model with a frontend-friendly breakdown."""
    if not (market_cap and market_cap > 0 and net_income is not None and price_to_book_ratio and price_to_book_ratio > 0):
        return None

    book_val = market_cap / price_to_book_ratio
    if book_val <= 0:
        return None

    roe_implied = net_income / book_val
    ri0 = net_income - cost_of_equity * book_val
    effective_terminal_growth = terminal_growth_rate
    if cost_of_equity <= effective_terminal_growth:
        effective_terminal_growth = max(cost_of_equity - 0.005, 0.005)

    if ri0 <= 0:
        intrinsic_total = book_val
        intrinsic_with_mos = book_val * 0.8
        present_value_ri = 0.0
        terminal_pv_ri = 0.0
        ri_year_1 = 0.0
    else:
        present_value_ri = sum(
            ri0 * (1 + book_value_growth) ** year / (1 + cost_of_equity) ** year
            for year in range(1, num_years + 1)
        )
        terminal_pv_ri = (
            ri0 * (1 + book_value_growth) ** (num_years + 1)
            / ((cost_of_equity - effective_terminal_growth) * (1 + cost_of_equity) ** num_years)
        )
        intrinsic_total = book_val + present_value_ri + terminal_pv_ri
        intrinsic_with_mos = intrinsic_total * 0.8
        ri_year_1 = ri0 * (1 + book_value_growth)

    book_value_per_share = (
        book_val / shares_outstanding
        if shares_outstanding and shares_outstanding > 0 else None
    )
    intrinsic_per_share = (
        intrinsic_with_mos / shares_outstanding
        if shares_outstanding and shares_outstanding > 0 else None
    )
    gap = (intrinsic_with_mos - market_cap) / market_cap if market_cap else None

    return {
        "book_value": book_val,
        "book_value_per_share": book_value_per_share,
        "roe_implied": roe_implied,
        "cost_of_equity": cost_of_equity,
        "spread_roe_ke": roe_implied - cost_of_equity,
        "book_value_growth": book_value_growth,
        "ri_year_1": ri_year_1,
        "present_value_ri": present_value_ri,
        "terminal_pv_ri": terminal_pv_ri,
        "intrinsic_total": intrinsic_total,
        "intrinsic_with_mos": intrinsic_with_mos,
        "intrinsic_per_share": intrinsic_per_share,
        "gap_to_market_cap": gap,
    }


def _percentile_manual(sorted_vals: list[float], pct: float) -> float:
    """Linear-interpolation percentile without numpy."""
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    idx = pct / 100 * (n - 1)
    lo = int(idx)
    hi = min(lo + 1, n - 1)
    frac = idx - lo
    return sorted_vals[lo] + frac * (sorted_vals[hi] - sorted_vals[lo])


def calculate_pbr_band(
    financial_metrics: list,
    current_price: float | None,
    shares_outstanding: float | None,
    revenue_growth: float | None = None,
    ticker: str | None = None,
) -> dict | None:
    """PBR band using trailing price-to-book history.

    When the primary source returns fewer than 4 historical PBR points (typical
    for US tickers whose data falls through to a single-snapshot fallback), this
    function pulls a quarterly PBR series from yfinance and uses it as the
    history basis so the band can still compute proper percentiles.
    """
    import math

    pbr_history: list[tuple[str, float]] = []
    for metric in financial_metrics:
        pbr = getattr(metric, "price_to_book_ratio", None)
        if pbr is not None and math.isfinite(pbr) and pbr > 0:
            period = getattr(metric, "report_period", "") or ""
            pbr_history.append((period, pbr))

    bvps: float | None = getattr(financial_metrics[0], "book_value_per_share", None)

    # Fallback: enrich sparse history (and missing BVPS) from yfinance-derived
    # quarterly PBR series. Uses internally-consistent BVPS so absolute
    # fair_price computation stays valid.
    yfinance_basis = False
    if (len(pbr_history) < 4) and ticker:
        try:
            from src.tools.api import _fetch_yfinance_pbr_history
            yf_series = _fetch_yfinance_pbr_history(ticker, limit=8)
        except Exception:
            yf_series = []

        if len(yf_series) >= 4:
            pbr_history = [
                (entry["report_period"], entry["price_to_book_ratio"])
                for entry in yf_series
            ]
            # Use yfinance-derived BVPS for consistency with the series.
            bvps = yf_series[0].get("book_value_per_share") or bvps
            yfinance_basis = True

    if bvps is None or bvps <= 0:
        return None

    if not pbr_history:
        return None

    current_pbr = pbr_history[0][1]
    if len(pbr_history) < 4:
        anchor_price = current_price or bvps * current_pbr
        return {
            "current_pbr": current_pbr,
            "percentiles": {"p10": current_pbr, "p25": current_pbr, "p50": current_pbr, "p75": current_pbr, "p90": current_pbr},
            "history": [{"period": period, "pbr": pbr} for period, pbr in pbr_history],
            "bvps": bvps,
            "fair_price_p10": anchor_price,
            "fair_price_p25": anchor_price,
            "fair_price_p50": anchor_price,
            "fair_price_p75": anchor_price,
            "fair_price_p90": anchor_price,
            "current_price": anchor_price,
            "position_label": "single_snapshot",
            "rerating_note": "PBR 히스토리 부족 — 현재 PBR 스냅샷 기준",
            "signal": "neutral",
            "details": f"현재 PBR {current_pbr:.2f}x · 히스토리 부족으로 현재 스냅샷을 기준점으로 표시",
            "history_source": "snapshot",
        }

    values = sorted(value for _, value in pbr_history)
    p10 = _percentile_manual(values, 10)
    p25 = _percentile_manual(values, 25)
    p50 = _percentile_manual(values, 50)
    p75 = _percentile_manual(values, 75)
    p90 = _percentile_manual(values, 90)

    if current_pbr < p25:
        position_label = "below_p25"
        signal = "bullish"
    elif current_pbr <= p50:
        position_label = "p25_p50"
        signal = "neutral"
    elif current_pbr <= p75:
        position_label = "p50_p75"
        signal = "neutral"
    else:
        position_label = "above_p75"
        signal = "bearish"

    rerating_note: str | None = None
    if revenue_growth and revenue_growth > 0.20 and current_pbr >= p50:
        rerating_note = "HBM/구조적 성장 — 상단 밴드 +25% 확장 고려"

    def implied_price(pbr_value: float) -> float:
        return bvps * pbr_value

    return {
        "current_pbr": current_pbr,
        "percentiles": {"p10": p10, "p25": p25, "p50": p50, "p75": p75, "p90": p90},
        "history": [{"period": period, "pbr": pbr} for period, pbr in pbr_history],
        "bvps": bvps,
        "fair_price_p10": implied_price(p10),
        "fair_price_p25": implied_price(p25),
        "fair_price_p50": implied_price(p50),
        "fair_price_p75": implied_price(p75),
        "fair_price_p90": implied_price(p90),
        "current_price": current_price,
        "position_label": position_label,
        "rerating_note": rerating_note,
        "signal": signal,
        "details": f"현재 PBR {current_pbr:.2f}x · P50 {p50:.2f}x · 역사적 {position_label} 구간",
        "history_source": "yfinance" if yfinance_basis else "primary",
    }


def detect_capex_regime(
    capex: float | None,
    revenue: float | None,
    fcf_history: list[float],
) -> str:
    """Returns 'capex_heavy' or 'default' for weighting DCF vs RIM/PBR."""
    capex_ratio = abs(capex or 0) / revenue if revenue and revenue > 0 else 0
    volatility = calculate_fcf_volatility(fcf_history) if fcf_history else 0
    if capex_ratio >= 0.25 or volatility >= 0.5:
        return "capex_heavy"
    return "default"


####################################
# Enhanced DCF Helper Functions
####################################

def calculate_wacc(
    market_cap: float,
    total_debt: float | None,
    cash: float | None,
    interest_coverage: float | None,
    debt_to_equity: float | None,
    beta_proxy: float = 1.0,
    risk_free_rate: float = 0.045,
    market_risk_premium: float = 0.06
) -> float:
    """Calculate WACC using available financial data."""
    
    # Cost of Equity (CAPM)
    cost_of_equity = risk_free_rate + beta_proxy * market_risk_premium
    
    # Cost of Debt - estimate from interest coverage
    if interest_coverage and interest_coverage > 0:
        # Higher coverage = lower cost of debt
        cost_of_debt = max(risk_free_rate + 0.01, risk_free_rate + (10 / interest_coverage))
    else:
        cost_of_debt = risk_free_rate + 0.05  # Default spread
    
    # Weights
    net_debt = max((total_debt or 0) - (cash or 0), 0)
    total_value = market_cap + net_debt
    
    if total_value > 0:
        weight_equity = market_cap / total_value
        weight_debt = net_debt / total_value
        
        # Tax shield (assume 25% corporate tax rate)
        wacc = (weight_equity * cost_of_equity) + (weight_debt * cost_of_debt * 0.75)
    else:
        wacc = cost_of_equity
    
    return min(max(wacc, 0.06), 0.20)  # Floor 6%, cap 20%


def calculate_fcf_volatility(fcf_history: list[float]) -> float:
    """Calculate FCF volatility as coefficient of variation."""
    if len(fcf_history) < 3:
        return 0.5  # Default moderate volatility
    
    # Filter out zeros and negatives for volatility calc
    positive_fcf = [fcf for fcf in fcf_history if fcf > 0]
    if len(positive_fcf) < 2:
        return 0.8  # High volatility if mostly negative FCF
    
    try:
        mean_fcf = statistics.mean(positive_fcf)
        std_fcf = statistics.stdev(positive_fcf)
        return min(std_fcf / mean_fcf, 1.0) if mean_fcf > 0 else 0.8
    except:
        return 0.5


def calculate_enhanced_dcf_value(
    fcf_history: list[float],
    growth_metrics: dict,
    wacc: float,
    market_cap: float,
    revenue_growth: float | None = None
) -> float:
    """Enhanced DCF with multi-stage growth."""
    
    if not fcf_history or fcf_history[0] <= 0:
        return 0
    
    # Analyze FCF trend and quality
    fcf_current = fcf_history[0]
    fcf_avg_3yr = sum(fcf_history[:3]) / min(3, len(fcf_history))
    fcf_volatility = calculate_fcf_volatility(fcf_history)
    
    # Stage 1: High Growth (Years 1-3)
    # Use revenue growth but cap based on business maturity
    high_growth = min(revenue_growth or 0.05, 0.25) if revenue_growth else 0.05
    if market_cap > 50_000_000_000:  # Large cap
        high_growth = min(high_growth, 0.10)
    
    # Stage 2: Transition (Years 4-7)
    transition_growth = (high_growth + 0.03) / 2
    
    # Stage 3: Terminal (steady state)
    terminal_growth = min(0.03, high_growth * 0.6)
    
    # Project FCF with stages
    pv = 0
    base_fcf = max(fcf_current, fcf_avg_3yr * 0.85)  # Conservative base
    
    # High growth stage
    for year in range(1, 4):
        fcf_projected = base_fcf * (1 + high_growth) ** year
        pv += fcf_projected / (1 + wacc) ** year
    
    # Transition stage
    for year in range(4, 8):
        transition_rate = transition_growth * (8 - year) / 4  # Declining
        fcf_projected = base_fcf * (1 + high_growth) ** 3 * (1 + transition_rate) ** (year - 3)
        pv += fcf_projected / (1 + wacc) ** year
    
    # Terminal value
    final_fcf = base_fcf * (1 + high_growth) ** 3 * (1 + transition_growth) ** 4
    if wacc <= terminal_growth:
        terminal_growth = wacc * 0.8  # Adjust if invalid
    terminal_value = (final_fcf * (1 + terminal_growth)) / (wacc - terminal_growth)
    pv_terminal = terminal_value / (1 + wacc) ** 7
    
    # Quality adjustment based on FCF volatility
    quality_factor = max(0.7, 1 - (fcf_volatility * 0.5))
    
    return (pv + pv_terminal) * quality_factor


def _build_sensitivity_matrix(
    intrinsic_value_fn,
    base_wacc: float | None,
    base_growth: float | None,
    current_price: float | None,
) -> list[list[dict]] | None:
    """Build a 5x5 WACC x growth sensitivity matrix for frontend rendering."""
    if base_wacc is None or base_growth is None or not current_price or current_price <= 0:
        return None

    wacc_grid = [
        base_wacc - 0.025,
        base_wacc - 0.015,
        base_wacc,
        base_wacc + 0.01,
        base_wacc + 0.02,
    ]
    growth_grid = [
        base_growth - 0.01,
        base_growth - 0.005,
        base_growth,
        base_growth + 0.005,
        base_growth + 0.01,
    ]

    matrix: list[list[dict]] = []
    try:
        for wacc in wacc_grid:
            row = []
            for growth in growth_grid:
                intrinsic = intrinsic_value_fn(wacc=wacc, growth=growth)
                if intrinsic is None:
                    return None
                row.append({
                    "wacc": float(wacc),
                    "growth": float(growth),
                    "intrinsic_value": float(intrinsic),
                    "safety_margin": (float(intrinsic) - float(current_price)) / float(current_price),
                })
            matrix.append(row)
    except Exception:
        return None

    return matrix


def calculate_dcf_scenarios(
    fcf_history: list[float],
    growth_metrics: dict,
    wacc: float,
    market_cap: float,
    revenue_growth: float | None = None
) -> dict:
    """Calculate DCF under multiple scenarios."""
    
    scenarios = {
        'bear': {'growth_adj': 0.5, 'wacc_adj': 1.2, 'terminal_adj': 0.8},
        'base': {'growth_adj': 1.0, 'wacc_adj': 1.0, 'terminal_adj': 1.0},
        'bull': {'growth_adj': 1.5, 'wacc_adj': 0.9, 'terminal_adj': 1.2}
    }
    
    results = {}
    base_revenue_growth = revenue_growth or 0.05
    
    for scenario, adjustments in scenarios.items():
        adjusted_revenue_growth = base_revenue_growth * adjustments['growth_adj']
        adjusted_wacc = wacc * adjustments['wacc_adj']
        
        results[scenario] = calculate_enhanced_dcf_value(
            fcf_history=fcf_history,
            growth_metrics=growth_metrics,
            wacc=adjusted_wacc,
            market_cap=market_cap,
            revenue_growth=adjusted_revenue_growth
        )
    
    # Probability-weighted average
    expected_value = (
        results['bear'] * 0.2 + 
        results['base'] * 0.6 + 
        results['bull'] * 0.2
    )
    
    return {
        'scenarios': results,
        'expected_value': expected_value,
        'range': results['bull'] - results['bear'],
        'upside': results['bull'],
        'downside': results['bear']
    }
