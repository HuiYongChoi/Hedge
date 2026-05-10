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
    "valuation. Compare forward P/E to trailing P/E and explain whether the consensus "
    "implies earnings expansion or contraction. Quote the next-quarter consensus EPS "
    "value explicitly. Never ignore forward_outlook even if it conflicts with your "
    "trailing-based narrative; explicitly reconcile the two views. If "
    "`forward_outlook.available` is false or `confidence` is 'low', acknowledge the "
    "limitation in one sentence and continue with trailing analysis."
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

    forward_pe = getattr(forward_metrics, "forward_pe", None)
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

    return {
        "available": True,
        "as_of_date": forward_metrics.as_of_date.isoformat(),
        "currency": forward_metrics.currency,
        "current_price": forward_metrics.current_price,
        "forward_eps_ttm": forward_metrics.forward_eps_ttm,
        "forward_pe": forward_pe,
        "trailing_pe": trailing_pe,
        "pe_change_pct": pe_change_pct,
        "confidence": forward_metrics.confidence,
        "composition": composition,
        "notes": list(forward_metrics.notes),
        "interpretation_hint": _build_interpretation_hint(
            forward_metrics,
            trailing_pe,
            forward_pe,
            pe_change_pct,
        ),
    }


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
            f"Forward P/E {forward_pe:.2f}x vs trailing {trailing_pe:.2f}x "
            f"({pe_change_pct:+.1f}%) - consensus implies {direction}."
        )
    elif forward_pe is not None:
        parts.append(f"Forward P/E {forward_pe:.2f}x; no trailing P/E is available for direct comparison.")

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

    return " ".join(parts) if parts else "No interpretive hint available."
