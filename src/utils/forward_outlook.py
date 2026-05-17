"""Forward outlook helpers for analyst LLM payloads."""

from __future__ import annotations

import logging
from typing import Any

from src.data.models_forward import ForwardMetrics
from src.tools.forward_metrics import get_forward_metrics

logger = logging.getLogger(__name__)

CACHE_KEY = "forward_metrics_cache"

FORWARD_OUTLOOK_SYSTEM_INSTRUCTION = (
    "FORWARD OUTLOOK REQUIREMENT: If `forward_outlook` is provided in the analysis "
    "data and `available` is true, you MUST weigh forward consensus when discussing "
    "valuation. Use `forward_outlook.canonical_multiples.price_compass_fwd_per` as the "
    "only canonical FwdPER shown in Price Compass. Compare that FwdPER to trailing P/E "
    "and explain whether the consensus implies earnings expansion or contraction. "
    "Quote the next-quarter consensus EPS "
    "value explicitly. Never ignore forward_outlook even if it conflicts with your "
    "trailing-based narrative; explicitly reconcile the two views. If "
    "`forward_outlook.available` is false, use trailing metrics only. If "
    "`confidence` is 'low', acknowledge the limitation in one sentence, but treat "
    "the canonical FwdPER as directional and must not revert to a trailing-only conclusion. "
    "When Price Compass FwdPER is below TTM PER, state that the consensus implies "
    "earnings/operating-income expansion, not valuation pressure. "
    "When `forward_pe_fy0` or `forward_pe_fy1` is present, treat them as the **annual** "
    "anchor and quote them alongside the TTM splice; do not average silently. Never "
    "label FY0 annual P/E, FY+1 annual P/E, or a manually computed EPS multiple as "
    "Price Compass FwdPER."
)


def _cache_ticker(ticker: str) -> str:
    return ticker.strip().upper()


def get_cached_forward_metrics(
    state: dict,
    ticker: str,
    end_date: str,
    api_key: str | None,
) -> ForwardMetrics | None:
    """Return cached ForwardMetrics for ticker; fetch and cache on miss."""
    data = state.setdefault("data", {})
    cache: dict[str, ForwardMetrics | None] = data.setdefault(CACHE_KEY, {})
    cache_key = _cache_ticker(ticker)

    if cache_key in cache:
        return cache[cache_key]

    try:
        result = get_forward_metrics(cache_key, as_of_date=end_date, api_key=api_key)
    except Exception as exc:
        logger.warning("forward_metrics fetch failed for %s: %s", cache_key, exc)
        result = None

    cache[cache_key] = result
    return result


def build_forward_outlook_block(
    forward_metrics: ForwardMetrics | None,
    trailing_pe: float | None = None,
) -> dict[str, Any]:
    """Serialize ForwardMetrics into the standard LLM-facing block."""
    if forward_metrics is None:
        return {
            "available": False,
            "reason": "forward_metrics could not be computed for this ticker",
            "fallback_guidance": "Use trailing metrics only; do not speculate about next quarter.",
        }

    raw_spliced_forward_pe = getattr(forward_metrics, "forward_pe", None)
    forward_pe = getattr(forward_metrics, "canonical_forward_pe", None) or raw_spliced_forward_pe
    canonical_forward_eps = getattr(forward_metrics, "canonical_forward_eps", None)
    canonical_current_price = getattr(forward_metrics, "canonical_current_price", None)
    display_forward_eps = canonical_forward_eps or forward_metrics.forward_eps_ttm
    display_current_price = canonical_current_price or forward_metrics.current_price
    pe_change_pct: float | None = None
    if trailing_pe is not None and forward_pe is not None and trailing_pe > 0:
        pe_change_pct = round((forward_pe - trailing_pe) / trailing_pe * 100, 2)

    composition = [
        {
            "period": quarter.period,
            "fiscal_period_end": quarter.fiscal_period_end.isoformat(),
            "eps": quarter.eps,
            "source": quarter.source,
            "provider": quarter.provider,
            "analyst_count": quarter.analyst_count,
            "dispersion": quarter.dispersion,
        }
        for quarter in forward_metrics.composition
    ]

    # ── Annual FY0 / FY+1 additions ───────────────────────────────────────────
    fy0_pe = getattr(forward_metrics, "forward_pe_fy0", None)
    fy1_pe = getattr(forward_metrics, "forward_pe_fy1", None)
    fy0_est = getattr(forward_metrics, "fy0_estimate", None)
    fy1_est = getattr(forward_metrics, "fy1_estimate", None)

    def _pct_vs_ttm(fy_pe: float | None) -> float | None:
        if fy_pe is None or forward_pe is None or forward_pe == 0:
            return None
        return round((fy_pe - forward_pe) / abs(forward_pe) * 100, 2)

    block: dict[str, Any] = {
        "available": True,
        "as_of_date": forward_metrics.as_of_date.isoformat(),
        "currency": forward_metrics.currency,
        "current_price": display_current_price,
        "forward_eps_ttm": display_forward_eps,
        "forward_pe": forward_pe,
        "canonical_forward_pe": getattr(forward_metrics, "canonical_forward_pe", None),
        "canonical_forward_eps": canonical_forward_eps,
        "raw_spliced_forward_pe": raw_spliced_forward_pe,
        "raw_spliced_forward_eps_ttm": forward_metrics.forward_eps_ttm,
        "trailing_pe": trailing_pe,
        "pe_change_pct": pe_change_pct,
        "confidence": forward_metrics.confidence,
        "composition": composition,
        "notes": list(forward_metrics.notes),
        "canonical_multiples": {
            "price_compass_fwd_per": forward_pe,
            "ttm_per": trailing_pe,
            "current_fy_per": fy0_pe,
            "next_fy_per": fy1_pe,
            "fwd_eps_ttm": display_forward_eps,
            "current_fy_eps": getattr(forward_metrics, "forward_eps_fy0", None),
            "next_fy_eps": getattr(forward_metrics, "forward_eps_fy1", None) or canonical_forward_eps,
            "formula": "Price Compass FwdPER = current_price / forward_eps",
        },
        "interpretation_hint": _build_interpretation_hint(
            forward_metrics,
            trailing_pe,
            forward_pe,
            pe_change_pct,
        ),
    }

    if fy0_pe is not None:
        block["forward_pe_fy0"] = fy0_pe
        block["forward_eps_fy0"] = getattr(forward_metrics, "forward_eps_fy0", None)
        block["fy0_fiscal_year"] = fy0_est.fiscal_year if fy0_est else None
        block["fy0_analyst_count"] = fy0_est.analyst_count if fy0_est else None
        block["fy0_confidence"] = fy0_est.confidence if fy0_est else None

    if fy1_pe is not None:
        block["forward_pe_fy1"] = fy1_pe
        block["forward_eps_fy1"] = getattr(forward_metrics, "forward_eps_fy1", None)
        block["fy1_fiscal_year"] = fy1_est.fiscal_year if fy1_est else None
        block["fy1_analyst_count"] = fy1_est.analyst_count if fy1_est else None
        block["fy1_confidence"] = fy1_est.confidence if fy1_est else None

    if fy0_pe is not None or fy1_pe is not None:
        block["annual_vs_ttm"] = {
            "fy0_minus_ttm_pct": _pct_vs_ttm(fy0_pe),
            "fy1_minus_ttm_pct": _pct_vs_ttm(fy1_pe),
        }

    return block


def _build_interpretation_hint(
    forward_metrics: ForwardMetrics,
    trailing_pe: float | None,
    forward_pe: float | None,
    pe_change_pct: float | None,
) -> str:
    parts: list[str] = []

    if forward_pe is not None and trailing_pe is not None and pe_change_pct is not None:
        direction = "earnings expansion" if pe_change_pct < 0 else "earnings contraction or valuation pressure"
        parts.append(
            f"Price Compass FwdPER {forward_pe:.2f}x vs TTM PER {trailing_pe:.2f}x "
            f"({pe_change_pct:+.1f}%) - consensus implies {direction}."
        )
    elif forward_pe is not None:
        parts.append(f"Price Compass FwdPER {forward_pe:.2f}x; no TTM PER is available for direct comparison.")

    consensus_quarter = next(
        (quarter for quarter in forward_metrics.composition if quarter.source.startswith("consensus")),
        None,
    )
    if consensus_quarter is not None:
        analyst_text = (
            f" from {consensus_quarter.analyst_count} analysts"
            if consensus_quarter.analyst_count
            else ""
        )
        parts.append(
            f"Next-quarter ({consensus_quarter.period}) consensus EPS: "
            f"{consensus_quarter.eps:.2f} {forward_metrics.currency}{analyst_text}."
        )

    if forward_metrics.confidence == "low":
        parts.append("Confidence is LOW; treat forward figures as directional only.")

    fy0_pe = getattr(forward_metrics, "forward_pe_fy0", None)
    fy0_est = getattr(forward_metrics, "fy0_estimate", None)
    if fy0_pe is not None:
        fy0_year = fy0_est.fiscal_year if fy0_est else "FY"
        if forward_pe is not None:
            parts.append(
                f"Current FY PER {fy0_pe:.2f}x (FY{fy0_year}) is an annual anchor, not Price Compass FwdPER."
            )
        else:
            parts.append(f"Current FY PER (FY{fy0_year}) {fy0_pe:.2f}x.")

    return " ".join(parts) if parts else "No interpretive hint available."
