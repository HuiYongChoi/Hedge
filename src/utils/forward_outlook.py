"""Forward outlook helpers for analyst LLM payloads."""

from __future__ import annotations

import logging
from typing import Any

from src.data.models_forward import ForwardMetrics
from src.tools.forward_metrics import get_forward_metrics

logger = logging.getLogger(__name__)

CACHE_KEY = "forward_metrics_cache"

FORWARD_OUTLOOK_SYSTEM_INSTRUCTION = (
    "FORWARD OUTLOOK REQUIREMENT: When the analysis input contains a forward "
    "outlook block with `available: true`, you MUST weigh the forward consensus "
    "when discussing valuation. Read the baseline forward P/E from the input "
    "data and compare it to the trailing P/E. Explain whether the consensus "
    "implies earnings expansion (forward P/E below trailing) or contraction / "
    "valuation pressure (forward P/E above trailing). Quote the forward "
    "consensus EPS value explicitly. Reconcile the two views in your "
    "narrative. If the forward outlook is unavailable, use trailing metrics "
    "only. If confidence is low, acknowledge the limitation in one sentence "
    "but treat the baseline forward P/E as directional; must not revert to a "
    "trailing-only conclusion. When the baseline forward P/E is below the "
    "trailing P/E, state that the consensus implies earnings / operating-"
    "income expansion, NOT valuation pressure. When annual-anchor forward "
    "P/Es (current fiscal year, next fiscal year) are also provided, quote "
    "them alongside the TTM PER; do not silently average them with "
    "the baseline. \n\n"
    "OUTPUT LANGUAGE RULES — STRICTLY ENFORCED:\n"
    "- Your investor-facing narrative must read as a securities analyst's "
    "summary, NOT as a developer reading raw data fields.\n"
    "- NEVER write the literal terms 'Price Compass', 'canonical FwdPER', "
    "'canonical_multiples', 'forward_outlook', "
    "'raw spliced', 'interpretation_hint', 'pe_change_pct', or any other "
    "data-key style identifier in your output text.\n"
    "- Refer to the baseline forward P/E as '선행 PER' (Korean) or 'forward "
    "P/E' (English). Refer to the trailing twelve-month splice as 'TTM PER'.\n"
    "- Refer to the forward EPS as '선행 12M 컨센 EPS' / '12M forward "
    "consensus EPS'. Do NOT call it 'next-quarter consensus EPS' — it is a "
    "12-month forward / annualized figure.\n"
    "- Do NOT splice two different forward P/E values into a 'A x vs B x' "
    "comparison. There is exactly one baseline forward P/E; quote it once.\n"
)


def _round1(value: Any) -> Any:
    """Round a numeric to one decimal for narrative display.

    EPS values reach the LLM as raw floats (e.g. 105.28448) and get quoted
    verbatim — there is no post-processing pass for EPS the way there is for
    PER — so they must be rounded at the source to keep the narrative to one
    decimal. None / non-numeric pass through unchanged.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 1)
    return value


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
        pe_change_pct = round((forward_pe - trailing_pe) / trailing_pe * 100, 1)

    composition = [
        {
            "period": quarter.period,
            "fiscal_period_end": quarter.fiscal_period_end.isoformat(),
            "eps": _round1(quarter.eps),
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
        return round((fy_pe - forward_pe) / abs(forward_pe) * 100, 1)

    block: dict[str, Any] = {
        "available": True,
        "as_of_date": forward_metrics.as_of_date.isoformat(),
        "currency": forward_metrics.currency,
        "current_price": display_current_price,
        "forward_eps_ttm": _round1(display_forward_eps),
        "forward_pe": _round1(forward_pe),
        "canonical_forward_pe": _round1(getattr(forward_metrics, "canonical_forward_pe", None)),
        "canonical_forward_eps": _round1(canonical_forward_eps),
        "raw_spliced_forward_pe": _round1(raw_spliced_forward_pe),
        "raw_spliced_forward_eps_ttm": _round1(forward_metrics.forward_eps_ttm),
        "trailing_pe": _round1(trailing_pe),
        "pe_change_pct": pe_change_pct,
        "confidence": forward_metrics.confidence,
        "composition": composition,
        "notes": list(forward_metrics.notes),
        "canonical_multiples": {
            "price_compass_fwd_per": _round1(forward_pe),
            "ttm_per": _round1(trailing_pe),
            "current_fy_per": _round1(fy0_pe),
            "next_fy_per": _round1(fy1_pe),
            "fwd_eps_ttm": _round1(display_forward_eps),
            "current_fy_eps": _round1(getattr(forward_metrics, "forward_eps_fy0", None)),
            "next_fy_eps": _round1(getattr(forward_metrics, "forward_eps_fy1", None) or canonical_forward_eps),
            "formula": "Baseline forward P/E = current_price / forward_eps",
        },
        "interpretation_hint": _build_interpretation_hint(
            forward_metrics,
            trailing_pe,
            forward_pe,
            pe_change_pct,
        ),
    }

    if fy0_pe is not None:
        block["forward_pe_fy0"] = _round1(fy0_pe)
        block["forward_eps_fy0"] = _round1(getattr(forward_metrics, "forward_eps_fy0", None))
        block["fy0_fiscal_year"] = fy0_est.fiscal_year if fy0_est else None
        block["fy0_analyst_count"] = fy0_est.analyst_count if fy0_est else None
        block["fy0_confidence"] = fy0_est.confidence if fy0_est else None

    if fy1_pe is not None:
        block["forward_pe_fy1"] = _round1(fy1_pe)
        block["forward_eps_fy1"] = _round1(getattr(forward_metrics, "forward_eps_fy1", None))
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
        direction = (
            "earnings expansion"
            if pe_change_pct < 0
            else "earnings contraction or valuation pressure"
        )
        parts.append(
            f"Baseline forward P/E {forward_pe:.1f}x vs TTM P/E {trailing_pe:.1f}x "
            f"({pe_change_pct:+.1f}%) — consensus implies {direction}."
        )
    elif forward_pe is not None:
        parts.append(
            f"Baseline forward P/E {forward_pe:.1f}x; no TTM P/E available "
            f"for direct comparison."
        )

    consensus_quarter = next(
        (
            quarter
            for quarter in forward_metrics.composition
            if quarter.source.startswith("consensus")
        ),
        None,
    )
    if consensus_quarter is not None:
        analyst_text = (
            f" from {consensus_quarter.analyst_count} analysts"
            if consensus_quarter.analyst_count
            else ""
        )
        parts.append(
            f"Forward consensus EPS ({consensus_quarter.period}): "
            f"{consensus_quarter.eps:.1f} {forward_metrics.currency}{analyst_text}."
        )

    if forward_metrics.confidence == "low":
        parts.append("Confidence is low; treat forward figures as directional only.")

    fy0_pe = getattr(forward_metrics, "forward_pe_fy0", None)
    fy0_est = getattr(forward_metrics, "fy0_estimate", None)
    if fy0_pe is not None:
        fy0_year = fy0_est.fiscal_year if fy0_est else "FY"
        if forward_pe is not None:
            parts.append(
                f"Current-year P/E {fy0_pe:.1f}x (FY{fy0_year}) is the annual "
                f"anchor and is separate from the baseline forward P/E."
            )
        else:
            parts.append(f"Current-year P/E (FY{fy0_year}) {fy0_pe:.1f}x.")

    return " ".join(parts) if parts else "No interpretive hint available."
