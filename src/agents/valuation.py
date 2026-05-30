from __future__ import annotations

"""Valuation Agent

Implements four complementary valuation methodologies and aggregates them with
configurable weights. 
"""

import json
import math
import statistics
from langchain_core.messages import HumanMessage
from src.graph.state import AgentState, show_agent_reasoning
from src.utils.progress import progress
from src.utils.api_key import get_api_key_from_state
from src.tools.api import (
    get_financial_metrics,
    get_market_cap,
    get_pbr_history,
    search_line_items,
)
from src.utils.forward_outlook import get_cached_forward_metrics


CONCRETE_CONCLUSION_GUIDANCE = (
    "Each conclusion sentence MUST include at least one concrete number "
    "(percentage, multiple, currency value, or growth rate)."
)

# Outlier handling for the blended valuation. A model is flagged when its
# intrinsic value diverges sharply from the leave-one-out median of the OTHER
# credible models (peer consensus, NOT the market price). Flagged models are
# excluded from the weighted blend so a single broken model cannot drag the
# headline value, but they stay visible (rendered at the bottom with a
# low-confidence badge on the frontend).
#
# Exception: a model whose value sits within OUTLIER_MARKET_GUARD of the market
# price is never flagged. Agreeing with the market is itself a credibility
# signal, and on deep cyclicals the earnings-based models (DCF/RIM/EVA) can all
# cluster at a depressed level — which would otherwise flag the one multiple
# that matches the market as the "too high" outlier and keep the depressed
# cluster instead.
OUTLIER_MIN_PEERS = 4         # need a credible consensus before calling an outlier
OUTLIER_HIGH_RATIO = 3.0      # value > 3x peer median → flagged (too high)
OUTLIER_LOW_RATIO = 1.0 / 3.0  # value < 1/3 peer median → flagged (too low)
OUTLIER_MARKET_GUARD = 0.35   # within ±35% of market cap → never an outlier (agrees with the market)


def flag_peer_outliers(valid_models: dict) -> None:
    """Flag models that diverge sharply from the leave-one-out median of the OTHER
    models, mutating each in place (is_outlier / peer_median_value /
    value_to_peer_median). A model whose ``gap`` (= (value - market_cap)/market_cap)
    is within OUTLIER_MARKET_GUARD of the market price is never flagged, so a
    market-agreeing model can't be excluded just because the other models cluster
    at a depressed (cyclical) level."""
    for v in valid_models.values():
        v["is_outlier"] = False
        v["peer_median_value"] = None
        v["value_to_peer_median"] = None
    if len(valid_models) < OUTLIER_MIN_PEERS:
        return
    for m, v in valid_models.items():
        peers = [vv["value"] for mm, vv in valid_models.items() if mm != m]
        peer_median = statistics.median(peers)
        v["peer_median_value"] = peer_median
        if peer_median > 0:
            ratio = v["value"] / peer_median
            v["value_to_peer_median"] = ratio
            diverges = ratio > OUTLIER_HIGH_RATIO or ratio < OUTLIER_LOW_RATIO
            near_market = v["gap"] is not None and abs(v["gap"]) <= OUTLIER_MARKET_GUARD
            v["is_outlier"] = diverges and not near_market


def _format_ratio(value: float | None) -> str:
    return f"{value:.2f}" if value is not None else "N/A"


def _format_percent_for_evidence(value: float | None) -> str | None:
    if value is None or not math.isfinite(value):
        return None
    return f"{value:.1%}"


def _ensure_numeric_evidence_details(
    details: str,
    *,
    gap: float | None = None,
    weight: float | None = None,
    per_share: float | None = None,
) -> str:
    """Apply CONCRETE_CONCLUSION_GUIDANCE to deterministic valuation details."""
    if any(char.isdigit() for char in details):
        return details

    supplements: list[str] = []
    gap_text = _format_percent_for_evidence(gap)
    weight_text = _format_percent_for_evidence(weight)
    if gap_text:
        supplements.append(f"gap {gap_text}")
    if weight_text:
        supplements.append(f"weight {weight_text}")
    if per_share is not None and math.isfinite(per_share):
        supplements.append(f"per-share {per_share:,.2f}")
    if not supplements:
        supplements.append("numeric data points 0")
    return f"{details} ({', '.join(supplements)})"


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


def _to_finite_float(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _backfill_valuation_inputs(
    financial_metrics: list,
    line_items: list,
    *,
    ticker: str,
    end_date: str,
    api_key: str | None,
) -> None:
    """Backfill the gating inputs for the EV/EBITDA, EBITDA, and ROIC−WACC cards.

    Fallback feeds (notably Korean tickers when DART is unreachable and yfinance
    404s) hand back metrics with ``enterprise_value`` / ``enterprise_value_to_ebitda_ratio``
    / ``return_on_invested_capital`` left null. The three per-method breakdowns
    return ``None`` on those nulls, so the agent never emits their ``*_analysis``
    keys and the cards silently vanish from the sidebar. Derive the missing inputs
    in place from line-item primitives plus an authoritative market cap, mirroring
    ``src.utils.data_standardizer.derive_financial_fields`` so values stay consistent.
    """
    if not financial_metrics:
        return
    m0 = financial_metrics[0]
    li_curr = line_items[0] if line_items else None

    def li_get(key):
        return getattr(li_curr, key, None) if li_curr is not None else None

    total_debt = _to_finite_float(li_get("total_debt"))
    if total_debt is None:
        total_debt = _to_finite_float(getattr(m0, "total_debt", None))
    cash = _to_finite_float(li_get("cash_and_equivalents"))
    if cash is None:
        cash = _to_finite_float(getattr(m0, "cash_and_equivalents", None))
    operating_income = _to_finite_float(li_get("operating_income"))
    if operating_income is None:
        operating_income = _to_finite_float(getattr(m0, "operating_income", None))
    depreciation = _to_finite_float(li_get("depreciation_and_amortization"))
    if depreciation is None:
        depreciation = _to_finite_float(getattr(m0, "depreciation_and_amortization", None))
    shareholders_equity = _to_finite_float(li_get("shareholders_equity"))
    shares = _to_finite_float(getattr(m0, "outstanding_shares", None))
    if shares is None:
        shares = _to_finite_float(li_get("outstanding_shares"))
    bvps = _to_finite_float(getattr(m0, "book_value_per_share", None))

    net_debt = (total_debt or 0) - (cash or 0)

    # Authoritative market cap — required to derive enterprise value.
    market_cap = _to_finite_float(getattr(m0, "market_cap", None))
    if market_cap is None or market_cap <= 0:
        try:
            market_cap = _to_finite_float(get_market_cap(ticker, end_date, api_key))
        except Exception:
            market_cap = None
        if market_cap and market_cap > 0:
            m0.market_cap = market_cap

    # EBITDA: metric → line item → operating income + D&A.
    ebitda = _to_finite_float(getattr(m0, "ebitda", None))
    if ebitda is None:
        ebitda = _to_finite_float(li_get("ebitda"))
    if ebitda is None and operating_income is not None and depreciation is not None:
        ebitda = operating_income + depreciation
    if ebitda is not None and _to_finite_float(getattr(m0, "ebitda", None)) is None:
        m0.ebitda = ebitda

    # Enterprise value = market cap + net debt.
    ev = _to_finite_float(getattr(m0, "enterprise_value", None))
    if ev is None and market_cap is not None and market_cap > 0:
        ev = market_cap + net_debt
        m0.enterprise_value = ev

    # EV/EBITDA ratio — needed by both EBITDA-based cards. Backfill the whole
    # window where each metric already carries an EV and an EBITDA so the
    # cycle-aware multiple selector has more than one historical sample.
    for idx, m in enumerate(financial_metrics):
        if _to_finite_float(getattr(m, "enterprise_value_to_ebitda_ratio", None)) is not None:
            continue
        m_ev = _to_finite_float(getattr(m, "enterprise_value", None))
        m_ebitda = _to_finite_float(getattr(m, "ebitda", None))
        if m_ebitda is None and idx < len(line_items):
            m_ebitda = _to_finite_float(getattr(line_items[idx], "ebitda", None))
        if m_ev is not None and m_ebitda is not None and m_ebitda > 0:
            m.enterprise_value_to_ebitda_ratio = m_ev / m_ebitda

    # ROIC = operating income / invested capital (book equity, else market proxy).
    if _to_finite_float(getattr(m0, "return_on_invested_capital", None)) is None and operating_income is not None:
        book_equity = shareholders_equity
        if book_equity is None and bvps and shares and bvps > 0 and shares > 0:
            book_equity = bvps * shares
        invested_capital = None
        if book_equity is not None:
            invested_capital = book_equity + net_debt
        elif market_cap is not None and market_cap > 0:
            invested_capital = market_cap + net_debt
        if invested_capital and invested_capital > 0:
            m0.return_on_invested_capital = operating_income / invested_capital


def _resolve_point_in_time_shares(
    financial_metrics: list,
    *,
    ticker: str,
    end_date: str,
    api_key: str | None,
) -> float | None:
    """Return a point-in-time (snapshot) share count for per-share valuation.

    The ``period="ttm"`` line item sums ``outstanding_shares`` across quarters
    (~4x the real float on MU: 4.54B vs 1.12B), so dividing equity by it deflates
    every per-share card by the same factor. Prefer the metrics snapshot, then a
    point-in-time annual/quarterly line item — both carry the real float — and let
    the caller fall back to the summed TTM count only when neither exists.
    """
    snapshot = (
        _to_finite_float(getattr(financial_metrics[0], "outstanding_shares", None))
        if financial_metrics
        else None
    )
    if snapshot and snapshot > 0:
        return snapshot
    for period in ("annual", "quarterly"):
        try:
            pit_items = search_line_items(
                ticker=ticker,
                line_items=["outstanding_shares"],
                end_date=end_date,
                period=period,
                limit=1,
                api_key=api_key,
            )
        except Exception:
            pit_items = None
        if pit_items:
            shares = _to_finite_float(getattr(pit_items[0], "outstanding_shares", None))
            if shares and shares > 0:
                return shares
    return None


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

        # Backfill EV / EV-EBITDA / ROIC inputs that fallback feeds leave null,
        # so the EV/EBITDA, EBITDA, and ROIC−WACC cards render instead of vanishing.
        _backfill_valuation_inputs(
            financial_metrics,
            line_items,
            ticker=ticker,
            end_date=end_date,
            api_key=api_key,
        )
        most_recent_metrics = financial_metrics[0]

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

        regime = detect_capex_regime(
            capex=li_curr.capital_expenditure,
            revenue=li_curr.revenue,
            fcf_history=fcf_history,
        )
        
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
        ev_breakdown = calculate_ev_ebitda_breakdown(
            financial_metrics,
            capex_heavy=regime == "capex_heavy",
        )
        ev_ebitda_val = ev_breakdown["equity_value"] if ev_breakdown else 0

        # Normalized/forward EBITDA earnings-power view (distinct from trailing EV/EBITDA).
        ebitda_breakdown = calculate_ebitda_valuation_breakdown(
            financial_metrics,
            line_items,
            capex_heavy=regime == "capex_heavy",
        )
        ebitda_val = ebitda_breakdown["equity_value"] if ebitda_breakdown else 0

        # Point-in-time share count for every per-share card. The TTM line item
        # sums outstanding_shares across quarters (~4x the real float on MU), so
        # using it would deflate each per-share value by the same factor. Prefer
        # the metrics snapshot, then a point-in-time annual/quarterly line item.
        shares_outstanding: float | None = _resolve_point_in_time_shares(
            financial_metrics,
            ticker=ticker,
            end_date=end_date,
            api_key=api_key,
        )
        if shares_outstanding is not None and shares_outstanding <= 0:
            shares_outstanding = None
        if shares_outstanding is None:
            # Korean DART feeds sometimes omit a share count while still
            # providing equity + BVPS. Recover shares = equity / BVPS so the
            # per-share-gated valuation cards (EV/EBITDA, EBITDA, ROIC-WACC)
            # still render instead of silently disappearing.
            bvps = most_recent_metrics.book_value_per_share
            equity = getattr(li_curr, "shareholders_equity", None)
            if bvps and bvps > 0 and equity and equity > 0:
                shares_outstanding = equity / bvps
        if shares_outstanding is None:
            # Last resort: the TTM line item's share count (may be quarter-summed,
            # but better than dropping the per-share cards entirely).
            ttm_shares = getattr(li_curr, "outstanding_shares", None)
            if ttm_shares and ttm_shares > 0:
                shares_outstanding = ttm_shares

        # ROIC−WACC excess-return (EVA) valuation.
        eva_growth = (
            most_recent_metrics.operating_income_growth
            or most_recent_metrics.earnings_growth
            or most_recent_metrics.revenue_growth
        )
        roic_wacc_breakdown = calculate_roic_wacc_breakdown(
            roic=most_recent_metrics.return_on_invested_capital,
            wacc=wacc,
            book_value_per_share=most_recent_metrics.book_value_per_share,
            shares_outstanding=shares_outstanding,
            total_debt=getattr(li_curr, "total_debt", None),
            cash=getattr(li_curr, "cash_and_equivalents", None),
            market_cap=most_recent_metrics.market_cap,
            eva_growth=eva_growth,
        )
        roic_wacc_val = roic_wacc_breakdown["equity_value"] if roic_wacc_breakdown else 0

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
            pbr_history=get_pbr_history(
                ticker=ticker,
                end_date=end_date,
                limit=8,
                api_key=api_key,
            ),
            current_price=(
                most_recent_metrics.market_cap / shares_outstanding
                if most_recent_metrics.market_cap and shares_outstanding
                else None
            ),
            shares_outstanding=shares_outstanding,
            revenue_growth=most_recent_metrics.revenue_growth,
        )

        ke_for_justified = compute_cost_of_equity(
            beta_proxy=most_recent_metrics.beta if most_recent_metrics.beta else 1.0,
        )
        justified_pbr_breakdown = calculate_justified_pbr_breakdown(
            financial_metrics=financial_metrics,
            forward_metrics=forward_metrics,
            cost_of_equity=ke_for_justified,
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
                "dcf": 0.16,
                "owner_earnings": 0.20,
                "ev_ebitda": 0.16,
                "residual_income": 0.16,
                "pbr_band": 0.12,
                "ebitda_valuation": 0.10,
                "roic_wacc_valuation": 0.10,
            }
        else:
            base_weights = {
                "dcf": 0.24,
                "owner_earnings": 0.24,
                "ev_ebitda": 0.12,
                "residual_income": 0.08,
                "pbr_band": 0.12,
                "ebitda_valuation": 0.10,
                "roic_wacc_valuation": 0.10,
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
            "ebitda_valuation": {"value": ebitda_val, "weight": base_weights["ebitda_valuation"]},
            "roic_wacc_valuation": {"value": roic_wacc_val, "weight": base_weights["roic_wacc_valuation"]},
        }
        if pbr_equity_val > 0:
            method_values["pbr_band"] = {"value": pbr_equity_val, "weight": base_weights["pbr_band"]}

        total_weight = sum(v["weight"] for v in method_values.values() if v["value"] > 0)
        if total_weight == 0:
            progress.update_status(agent_id, ticker, "Failed: All valuation methods zero")
            continue

        for v in method_values.values():
            v["gap"] = (v["value"] - market_cap) / market_cap if v["value"] > 0 else None

        # Flag models that diverge sharply from the peer consensus and drop them
        # from the blend (see OUTLIER_* constants). The reference is the median of
        # the OTHER valid models, so a single broken model can't endorse itself.
        valid_models = {m: v for m, v in method_values.items() if v["value"] and v["value"] > 0}
        flag_peer_outliers(valid_models)

        blend_weight = sum(v["weight"] for v in valid_models.values() if not v["is_outlier"])
        if blend_weight <= 0:
            # Degenerate case (every model flagged) — keep the full blend rather
            # than emit nothing.
            for v in valid_models.values():
                v["is_outlier"] = False
            blend_weight = total_weight

        weighted_gap = sum(
            v["weight"] * v["gap"]
            for v in valid_models.values()
            if v["gap"] is not None and not v["is_outlier"]
        ) / blend_weight

        # Headline 1주당 내재가치: normally the DCF per-share, but when DCF is
        # flagged as a peer outlier (low confidence) it must NOT anchor the
        # headline. Fall back to the blended (non-outlier weighted-average)
        # per-share so the headline and margin-of-safety match the consensus the
        # signal is already based on. DCF stays in the model summary with its
        # low-confidence badge for transparency.
        blended_intrinsic_total = sum(
            v["weight"] * v["value"]
            for v in valid_models.values()
            if not v["is_outlier"]
        ) / blend_weight
        blended_intrinsic_per_share = (
            blended_intrinsic_total / shares_outstanding
            if shares_outstanding else None
        )
        dcf_vals = valid_models.get("dcf")
        dcf_is_outlier = bool(dcf_vals and dcf_vals.get("is_outlier"))
        dcf_per_share = (
            dcf_vals["value"] / shares_outstanding
            if (dcf_vals and shares_outstanding and dcf_vals["value"] > 0) else None
        )
        if dcf_per_share and not dcf_is_outlier:
            headline_intrinsic_per_share = dcf_per_share
            headline_source = "dcf"
        else:
            headline_intrinsic_per_share = blended_intrinsic_per_share
            headline_source = "blended"

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
            "headline_intrinsic_per_share": headline_intrinsic_per_share,
            "headline_source": headline_source,
            "blended_intrinsic_per_share": blended_intrinsic_per_share,
            "dcf_is_outlier": dcf_is_outlier,
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

                is_outlier = bool(vals.get("is_outlier"))
                peer_median_value = vals.get("peer_median_value")
                peer_median_per_share = (
                    peer_median_value / shares_outstanding
                    if (peer_median_value and shares_outstanding) else None
                )
                outlier_note = None
                if is_outlier and vals.get("value_to_peer_median"):
                    outlier_note = (
                        f"또래 가치평가 중앙값 대비 {vals['value_to_peer_median']:.1f}배로 크게 벗어나 "
                        "블렌드(종합 내재가치)에서 제외됨 — 신뢰도 낮음."
                    )

                reasoning[f"{m}_analysis"] = {
                    "signal": (
                        "bullish" if vals["gap"] and vals["gap"] > 0.15 else
                        "bearish" if vals["gap"] and vals["gap"] < -0.15 else "neutral"
                    ),
                    "details": _ensure_numeric_evidence_details(
                        enhanced_details,
                        gap=vals["gap"],
                        weight=vals["weight"],
                        per_share=intrinsic_per_share,
                    ),
                    "intrinsic_total": vals["value"],
                    "intrinsic_per_share": intrinsic_per_share,
                    "weight_used": vals["weight"],
                    "gap_to_market": vals["gap"],
                    "is_outlier": is_outlier,
                    "blend_excluded": is_outlier,
                    "peer_median_per_share": peer_median_per_share,
                    "value_to_peer_median": vals.get("value_to_peer_median"),
                    "outlier_note": outlier_note,
                }

        if ev_breakdown and "ev_ebitda_analysis" in reasoning:
            reasoning["ev_ebitda_analysis"].update({
                "median_multiple": ev_breakdown["median_multiple"],
                "current_multiple": ev_breakdown["current_multiple"],
                "ebitda_now": ev_breakdown["ebitda_now"],
                "net_debt": ev_breakdown["net_debt"],
                "sample_size": ev_breakdown["sample_size"],
                "clipped_sample_size": ev_breakdown["clipped_sample_size"],
                "multiple_basis": ev_breakdown["multiple_basis"],
            })

        if ebitda_breakdown and "ebitda_valuation_analysis" in reasoning:
            reasoning["ebitda_valuation_analysis"].update({
                "normalized_ebitda": ebitda_breakdown["normalized_ebitda"],
                "current_ebitda": ebitda_breakdown["current_ebitda"],
                "target_multiple": ebitda_breakdown["target_multiple"],
                "multiple_basis": ebitda_breakdown["multiple_basis"],
                "ebitda_growth_applied": ebitda_breakdown["ebitda_growth_applied"],
                "net_debt": ebitda_breakdown["net_debt"],
                "ebitda_sample_size": ebitda_breakdown["ebitda_sample_size"],
            })

        if roic_wacc_breakdown and "roic_wacc_valuation_analysis" in reasoning:
            reasoning["roic_wacc_valuation_analysis"].update({
                "invested_capital": roic_wacc_breakdown["invested_capital"],
                "ic_basis": roic_wacc_breakdown["ic_basis"],
                "roic": roic_wacc_breakdown["roic"],
                "wacc": roic_wacc_breakdown["wacc"],
                "spread": roic_wacc_breakdown["spread"],
                "eva_0": roic_wacc_breakdown["eva_0"],
                "mva": roic_wacc_breakdown["mva"],
                "enterprise_value": roic_wacc_breakdown["enterprise_value"],
                "fade_growth": roic_wacc_breakdown["fade_growth"],
                "terminal_growth": roic_wacc_breakdown["terminal_growth"],
            })
        
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
            reasoning["rim_analysis"] = {
                "signal": "neutral",
                "details": _ensure_numeric_evidence_details(
                    "데이터 부족",
                    weight=base_weights["residual_income"],
                ),
            }

        if pbr_band_result:
            reasoning["pbr_band_analysis"] = {
                **pbr_band_result,
                "weight_used": base_weights.get("pbr_band", 0),
            }

        if justified_pbr_breakdown:
            jp_target = justified_pbr_breakdown["target_price"]
            current_pp = (
                market_cap / shares_outstanding
                if (market_cap and shares_outstanding)
                else pbr_band_result.get("current_price") if pbr_band_result else None
            )
            jp_gap = (jp_target - current_pp) / current_pp if current_pp and current_pp > 0 else None
            if jp_gap is not None and jp_gap > 0.15:
                jp_signal = "bullish"
            elif jp_gap is not None and jp_gap < -0.15:
                jp_signal = "bearish"
            else:
                jp_signal = "neutral"

            reasoning["justified_pbr_analysis"] = {
                "signal": jp_signal,
                "gap_to_market": jp_gap,
                "target_price": jp_target,
                "justified_pbr": justified_pbr_breakdown["justified_pbr"],
                "roe_used": justified_pbr_breakdown["roe_used"],
                "roe_source": justified_pbr_breakdown["roe_source"],
                "roe_window": justified_pbr_breakdown["roe_window"],
                "cost_of_equity": justified_pbr_breakdown["cost_of_equity"],
                "growth_g": justified_pbr_breakdown["growth_g"],
                "bvps_now": justified_pbr_breakdown["bvps_now"],
                "bvps_forward": justified_pbr_breakdown["bvps_forward"],
                "eps_growth_1y": justified_pbr_breakdown["eps_growth_1y"],
                "weight_used": 0,
                "details": (
                    f"Justified PBR {justified_pbr_breakdown['justified_pbr']:.2f}x × "
                    f"BVPS forward {justified_pbr_breakdown['bvps_forward']:,.0f} = "
                    f"{jp_target:,.0f}"
                ),
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

        # Forward P/E stays a RATIO cross-check only — no per-share intrinsic.
        # The previous trailing_pe × forward_eps implied price multiplied a
        # trough/elevated trailing multiple by recovered forward EPS, which
        # overshoots wildly on exactly the cyclical names this tool targets
        # (e.g. MU trailing 45x → +175%, memory 22x → +179%). It is excluded
        # from the per-share valuation summary; the forward/trailing/blended
        # P/E figures below still feed the 선행 PER narrative.
        reasoning["forward_per_analysis"] = {
            "signal": pe_signal,
            "intrinsic_per_share": None,
            "gap_to_market": None,
            "weight_used": 0,
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

    # Cyclical recovery earnings_growth (e.g. memory trough→peak) can be many
    # hundred percent; compounding it over 5 years explodes the value to
    # millions/share. Clamp to the DCF high-growth band so the projection stays
    # sane (EBITDA model uses ±30%, ROIC−WACC ±10%, DCF caps at 25%).
    growth_rate = max(min(growth_rate, 0.25), -0.10)

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


def _clip_ev_ebitda_multiples(multiples: list[float]) -> tuple[list[float], bool]:
    """Trim the most distorted cycle trough/peak multiple when enough history exists."""
    sorted_multiples = sorted(multiples)
    if len(sorted_multiples) >= 5:
        return sorted_multiples[1:-1], True
    return sorted_multiples, False


def _select_ev_ebitda_multiple(multiples: list[float], capex_heavy: bool) -> tuple[float, str, int]:
    clipped_multiples, was_clipped = _clip_ev_ebitda_multiples(multiples)
    if capex_heavy:
        selected = _percentile_manual(clipped_multiples, 75)
        basis = "capex_heavy_p75_clipped" if was_clipped else "capex_heavy_p75"
    else:
        selected = statistics.median(clipped_multiples)
        basis = "median_clipped" if was_clipped else "median"
    return selected, basis, len(clipped_multiples)


def calculate_ev_ebitda_breakdown(financial_metrics: list, capex_heavy: bool = False) -> dict | None:
    """Implied equity value plus cycle-aware EV/EBITDA multiple details."""
    if not financial_metrics:
        return None
    m0 = financial_metrics[0]
    if not (m0.enterprise_value and m0.enterprise_value_to_ebitda_ratio):
        return None
    if m0.enterprise_value_to_ebitda_ratio == 0:
        return None

    current_mult = m0.enterprise_value_to_ebitda_ratio
    ebitda_now = m0.enterprise_value / current_mult
    multiples = [
        m.enterprise_value_to_ebitda_ratio for m in financial_metrics if m.enterprise_value_to_ebitda_ratio
    ]
    if not multiples:
        return None
    med_mult, multiple_basis, clipped_sample_size = _select_ev_ebitda_multiple(multiples, capex_heavy)
    ev_implied = med_mult * ebitda_now
    net_debt = (m0.enterprise_value or 0) - (m0.market_cap or 0)
    equity_implied = max(ev_implied - net_debt, 0.0)
    return {
        "equity_value": equity_implied,
        "median_multiple": med_mult,
        "current_multiple": current_mult,
        "ebitda_now": ebitda_now,
        "net_debt": net_debt,
        "sample_size": len(multiples),
        "clipped_sample_size": clipped_sample_size,
        "multiple_basis": multiple_basis,
    }


def calculate_ev_ebitda_value(financial_metrics: list):
    """Backward-compatible EV/EBITDA equity value helper."""
    breakdown = calculate_ev_ebitda_breakdown(financial_metrics)
    return breakdown["equity_value"] if breakdown else 0


def calculate_ebitda_valuation_breakdown(
    financial_metrics: list,
    line_items: list,
    *,
    capex_heavy: bool = False,
) -> dict | None:
    """Normalized/forward EBITDA × cycle-aware target multiple → equity value.

    Distinct from ``calculate_ev_ebitda_breakdown`` (trailing EBITDA × historical
    median): this view smooths EBITDA across the available history (earnings-power
    lens) and overlays a single year of growth, while reusing the same cycle-aware
    multiple selector so the two lines cross-check peak/trough distortion.
    """
    if not financial_metrics:
        return None
    m0 = financial_metrics[0]
    if not getattr(m0, "enterprise_value", None):
        return None

    # Current EBITDA implied by EV / current multiple (fallback sample).
    current_mult = getattr(m0, "enterprise_value_to_ebitda_ratio", None)
    current_ebitda = m0.enterprise_value / current_mult if current_mult else None

    # EBITDA time series from line items (cycle smoothing).
    ebitda_samples = [
        li.ebitda for li in (line_items or []) if getattr(li, "ebitda", None)
    ]
    if not ebitda_samples and current_ebitda:
        ebitda_samples = [current_ebitda]
    if not ebitda_samples:
        return None

    normalized_ebitda = statistics.mean(ebitda_samples)

    # One-year growth overlay (clamped to keep cyclical swings sane).
    ebitda_growth = getattr(m0, "ebitda_growth", None)
    growth_applied = None
    if ebitda_growth is not None and math.isfinite(ebitda_growth):
        growth_applied = max(min(ebitda_growth, 0.30), -0.30)
        normalized_ebitda *= 1 + growth_applied

    if normalized_ebitda <= 0:
        return None

    # Target multiple — reuse the cycle-aware EV/EBITDA selector.
    multiples = [
        m.enterprise_value_to_ebitda_ratio
        for m in financial_metrics
        if getattr(m, "enterprise_value_to_ebitda_ratio", None)
    ]
    if multiples:
        target_multiple, multiple_basis, _ = _select_ev_ebitda_multiple(multiples, capex_heavy)
    elif current_mult:
        target_multiple, multiple_basis = current_mult, "current_only"
    else:
        return None

    ev_implied = target_multiple * normalized_ebitda
    net_debt = (m0.enterprise_value or 0) - (getattr(m0, "market_cap", 0) or 0)
    equity_value = max(ev_implied - net_debt, 0.0)
    return {
        "equity_value": equity_value,
        "normalized_ebitda": normalized_ebitda,
        "current_ebitda": current_ebitda,
        "target_multiple": target_multiple,
        "multiple_basis": multiple_basis,
        "ebitda_growth_applied": growth_applied,
        "net_debt": net_debt,
        "ebitda_sample_size": len(ebitda_samples),
    }


def calculate_roic_wacc_breakdown(
    *,
    roic: float | None,
    wacc: float,
    book_value_per_share: float | None,
    shares_outstanding: float | None,
    total_debt: float | None,
    cash: float | None,
    market_cap: float | None,
    eva_growth: float | None,
    margin_of_safety: float = 0.20,
    fade_years: int = 5,
    terminal_growth: float = 0.02,
) -> dict | None:
    """Economic Value Added (EVA) equity value from the ROIC−WACC spread.

    EnterpriseValue = InvestedCapital + Σ PV[(ROIC−WACC)·IC growing at g] (+terminal),
    EquityValue = (EnterpriseValue − NetDebt) · (1 − MOS).
    """
    if roic is None or not math.isfinite(roic):
        return None

    net_debt = max((total_debt or 0) - (cash or 0), 0)
    book_equity = (
        book_value_per_share * shares_outstanding
        if (
            book_value_per_share
            and shares_outstanding
            and book_value_per_share > 0
            and shares_outstanding > 0
        )
        else None
    )
    if book_equity is not None:
        invested_capital = book_equity + net_debt
        ic_basis = "book"
    elif market_cap and market_cap > 0:
        invested_capital = market_cap + net_debt
        ic_basis = "market_proxy"
    else:
        return None
    if invested_capital <= 0:
        return None

    spread = roic - wacc
    eva_0 = spread * invested_capital

    g = max(min(eva_growth or 0.0, 0.10), -0.10)
    term_g = min(terminal_growth, wacc - 0.01)

    pv_eva = 0.0
    eva_t = eva_0
    for t in range(1, fade_years + 1):
        eva_t = eva_0 * (1 + g) ** t
        pv_eva += eva_t / (1 + wacc) ** t

    # Terminal value only for value creators (spread > 0); destroyers stay finite.
    pv_terminal = 0.0
    if spread > 0 and wacc > term_g:
        terminal_eva = eva_t * (1 + term_g) / (wacc - term_g)
        pv_terminal = terminal_eva / (1 + wacc) ** fade_years

    mva = pv_eva + pv_terminal
    enterprise_value = invested_capital + mva
    equity_value = max(enterprise_value - net_debt, 0.0) * (1 - margin_of_safety)
    return {
        "equity_value": equity_value,
        "invested_capital": invested_capital,
        "ic_basis": ic_basis,
        "roic": roic,
        "wacc": wacc,
        "spread": spread,
        "eva_0": eva_0,
        "mva": mva,
        "enterprise_value": enterprise_value,
        "net_debt": net_debt,
        "fade_growth": g,
        "terminal_growth": term_g,
        "margin_of_safety": margin_of_safety,
    }


def calculate_justified_pbr_breakdown(
    financial_metrics: list,
    forward_metrics,
    cost_of_equity: float,
    fallback_terminal_growth: float = 0.03,
    lookback_years: int = 5,
) -> dict | None:
    """Justified PBR via Gordon Growth: PBR* = (ROE - g) / (Ke - g)."""
    if not financial_metrics:
        return None

    def finite_float(value) -> float | None:
        if value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None

    m0 = financial_metrics[0]
    bvps_now = finite_float(getattr(m0, "book_value_per_share", None))
    if bvps_now is None or bvps_now <= 0:
        return None

    forward_eps_samples: list[float] = []
    fy0 = None
    fy1 = None
    if forward_metrics is not None:
        fy0 = finite_float(getattr(forward_metrics, "forward_eps_fy0", None))
        fy1 = finite_float(getattr(forward_metrics, "forward_eps_fy1", None))
        for value in (fy0, fy1):
            if value is not None and value > 0:
                forward_eps_samples.append(value)

    if forward_eps_samples:
        roe_used = (sum(forward_eps_samples) / len(forward_eps_samples)) / bvps_now
        roe_source = "forward_eps_implied"
        roe_window = "FY0-FY1" if len(forward_eps_samples) == 2 else "FY0"
    else:
        trailing_roes = [
            finite_float(getattr(metric, "return_on_equity", None))
            for metric in financial_metrics[:lookback_years]
        ]
        trailing_roes = [value for value in trailing_roes if value is not None]
        if not trailing_roes:
            return None
        roe_used = sum(trailing_roes) / len(trailing_roes)
        roe_source = "trailing_avg"
        roe_window = f"trailing {len(trailing_roes)}y"

    g_raw = finite_float(getattr(m0, "book_value_growth", None))
    g = g_raw if g_raw is not None else fallback_terminal_growth
    g = max(0.0, min(g, cost_of_equity - 0.005))

    denom = cost_of_equity - g
    if denom <= 0:
        return None

    justified_pbr = max((roe_used - g) / denom, 0.0)
    bvps_forward = bvps_now * (1.0 + g)
    target_price = justified_pbr * bvps_forward

    eps_growth_1y: float | None = None
    if fy0 is not None and fy1 is not None and fy0 > 0:
        eps_growth_1y = (fy1 - fy0) / fy0

    return {
        "roe_used": roe_used,
        "roe_source": roe_source,
        "roe_window": roe_window,
        "cost_of_equity": cost_of_equity,
        "growth_g": g,
        "justified_pbr": justified_pbr,
        "bvps_now": bvps_now,
        "bvps_forward": bvps_forward,
        "target_price": target_price,
        "eps_growth_1y": eps_growth_1y,
    }


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
    pbr_history: list | None = None,
) -> dict | None:
    """PBR band using trailing price-to-book history."""
    import math

    if not financial_metrics:
        return None

    history_pairs: list[tuple[str, float]] = []
    bvps: float | None = None
    history_source = "financial_metrics"

    if pbr_history:
        for point in pbr_history:
            pbr = getattr(point, "price_to_book_ratio", None)
            if pbr is not None and math.isfinite(pbr) and pbr > 0:
                period = getattr(point, "period", "") or ""
                history_pairs.append((period, pbr))
                if bvps is None:
                    point_bvps = getattr(point, "book_value_per_share", None)
                    if point_bvps is not None and point_bvps > 0:
                        bvps = point_bvps
                source = getattr(point, "source", None)
                if source:
                    history_source = source

    if len(history_pairs) < 4:
        history_pairs = []
        history_source = "financial_metrics"
        for metric in financial_metrics:
            pbr = getattr(metric, "price_to_book_ratio", None)
            if pbr is not None and math.isfinite(pbr) and pbr > 0:
                period = getattr(metric, "report_period", "") or ""
                history_pairs.append((period, pbr))
                if bvps is None:
                    metric_bvps = getattr(metric, "book_value_per_share", None)
                    if metric_bvps is not None and metric_bvps > 0:
                        bvps = metric_bvps

    if len(history_pairs) < 4:
        return None

    current_pbr = history_pairs[0][1]
    bvps_source = "reported_book_value_per_share"
    if (
        current_price is not None
        and math.isfinite(current_price)
        and current_price > 0
        and current_pbr > 0
    ):
        bvps = current_price / current_pbr
        bvps_source = "current_price_div_current_pbr"
    elif bvps is None:
        bvps = getattr(financial_metrics[0], "book_value_per_share", None)

    if bvps is None or bvps <= 0:
        return None

    values = sorted(value for _, value in history_pairs)
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
        "history": [{"period": period, "pbr": pbr} for period, pbr in history_pairs],
        "history_source": history_source,
        "bvps": bvps,
        "bvps_source": bvps_source,
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


def compute_cost_of_equity(
    beta_proxy: float = 1.0,
    risk_free_rate: float = 0.045,
    market_risk_premium: float = 0.06,
) -> float:
    """CAPM cost of equity shared by WACC and Justified PBR."""
    ke = risk_free_rate + beta_proxy * market_risk_premium
    return max(ke, risk_free_rate + 0.02)


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
    cost_of_equity = compute_cost_of_equity(beta_proxy, risk_free_rate, market_risk_premium)
    
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
