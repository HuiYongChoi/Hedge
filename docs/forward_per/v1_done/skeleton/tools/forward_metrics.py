"""Forward TTM EPS / Forward PER synthesis.

Splices the most recent 3 quarters of *actual* reported EPS with 1 quarter of
*consensus* estimate EPS to produce a forward-looking trailing-twelve-months
EPS, and divides by the latest close price to get forward P/E.

Single public entry point: `get_forward_metrics(ticker, as_of_date, ...)`.

See docs/forward_per/DESIGN.md for the full plan, especially §2.3 for the
algorithm and §6 for acceptance criteria.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

# IMPORTANT: when this skeleton is moved into src/tools/, change the imports
# below to `from src.data.models_forward import ...` and
# `from src.tools.estimates_api import ...`.
from .estimates_api import EstimateProvider, default_provider_chain  # type: ignore[import-not-found]
from .models_forward import ForwardMetrics, QuarterlyEPS  # type: ignore[import-not-found]

logger = logging.getLogger(__name__)


# Module-level cache — keyed by (ticker, as_of_date_iso). 1-day TTL is enforced
# by including the date in the key; flushing happens naturally as date rolls.
_FORWARD_CACHE: dict[tuple[str, str], ForwardMetrics | None] = {}


def get_forward_metrics(
    ticker: str,
    as_of_date: str | date | None = None,
    api_key: str | None = None,
    providers: list[EstimateProvider] | None = None,
) -> ForwardMetrics | None:
    """Return synthesized forward TTM EPS + forward P/E for a ticker.

    Parameters
    ----------
    ticker : "AAPL", "005930.KS", ...
    as_of_date : ISO date string or date object; defaults to today (UTC).
    api_key : optional financial datasets API key (passes through to trailing fetch).
    providers : optional override of the estimate provider chain (used in tests).

    Returns
    -------
    ForwardMetrics on success, or None if even trailing data is unavailable.
    """
    as_of = _coerce_date(as_of_date)
    cache_key = (ticker, as_of.isoformat())
    if cache_key in _FORWARD_CACHE:
        return _FORWARD_CACHE[cache_key]

    # ---- 1. Trailing actuals: pull last 8 quarterly metrics, take the
    #         most-recent 3 with non-null EPS.
    actuals = _load_trailing_quarterly_eps(ticker, as_of, api_key)
    if len(actuals) < 3:
        # Not enough actuals to splice; fall back to trailing-only with low confidence.
        result = _trailing_only_fallback(ticker, as_of, actuals, reason="insufficient actual quarters")
        _FORWARD_CACHE[cache_key] = result
        return result

    last_three: list[QuarterlyEPS] = actuals[-3:]
    # TODO(codex): assert last_three are contiguous quarters; if a gap exists,
    # log a warning and add a note.

    # ---- 2. Next-quarter consensus from provider chain.
    provider_chain = providers or default_provider_chain(ticker)
    next_q: QuarterlyEPS | None = None
    used_provider: str | None = None
    for prov in provider_chain:
        try:
            est = prov.fetch_quarterly_eps_estimates(ticker, as_of, num_quarters=1)
        except Exception as e:
            logger.warning("estimate provider %s failed for %s: %s", prov.name, ticker, e)
            continue
        if est:
            # Take the first quarter strictly after last actual.
            after = [q for q in est if q.fiscal_period_end > last_three[-1].fiscal_period_end]
            if after:
                next_q = after[0]
                used_provider = prov.name
                break

    if next_q is None:
        result = _trailing_only_fallback(ticker, as_of, actuals, reason="no consensus estimate available")
        _FORWARD_CACHE[cache_key] = result
        return result

    # ---- 3. Compose, then sum.
    composition = last_three + [next_q]
    forward_eps_ttm = sum(q.eps for q in composition)

    # ---- 4. Current price.
    current_price = _latest_close(ticker, as_of)
    if current_price is None:
        logger.warning("no price available for %s as of %s", ticker, as_of)
        _FORWARD_CACHE[cache_key] = None
        return None

    # ---- 5. Forward PE — guard against non-positive EPS.
    notes: list[str] = []
    if forward_eps_ttm <= 0:
        forward_pe: float | None = None
        notes.append(f"forward_eps_ttm={forward_eps_ttm:.2f} ≤ 0; forward_pe undefined")
    else:
        forward_pe = current_price / forward_eps_ttm

    # ---- 6. Confidence.
    confidence = _grade_confidence(next_q, used_provider)

    # ---- 7. Stale-estimate warning.
    if next_q.as_of and (as_of - next_q.as_of) > timedelta(days=14):
        notes.append(f"consensus estimate stale by {(as_of - next_q.as_of).days}d")
        if confidence == "high":
            confidence = "medium"

    result = ForwardMetrics(
        ticker=ticker,
        as_of_date=as_of,
        current_price=current_price,
        forward_eps_ttm=forward_eps_ttm,
        forward_pe=forward_pe,
        composition=composition,
        confidence=confidence,
        notes=notes,
    )
    _FORWARD_CACHE[cache_key] = result
    return result


# ---------------------------------------------------------------------------
# Helpers — Codex fills these in.
# ---------------------------------------------------------------------------
def _coerce_date(value: str | date | None) -> date:
    if value is None:
        return datetime.utcnow().date()
    if isinstance(value, date):
        return value
    return datetime.strptime(value, "%Y-%m-%d").date()


def _load_trailing_quarterly_eps(
    ticker: str, as_of: date, api_key: str | None,
) -> list[QuarterlyEPS]:
    """Pull last 8 quarterly FinancialMetrics, return ascending list of QuarterlyEPS.

    TODO(codex):
    - Call src.tools.api.get_financial_metrics(ticker, end_date=as_of.isoformat(),
      period="quarter", limit=8, api_key=api_key).
    - For each metric m: extract m.earnings_per_share; if None, fall back to
      (m.net_income / m.outstanding_shares) when both are present.
    - Build QuarterlyEPS(period=..., fiscal_period_end=..., eps=..., source="actual",
      provider=m.source if available else "FinancialDatasets", as_of=as_of).
    - Sort ascending by fiscal_period_end and drop entries with null EPS.
    """
    raise NotImplementedError


def _latest_close(ticker: str, as_of: date) -> float | None:
    """Return the most recent close at or before as_of using src.tools.api.get_prices.

    TODO(codex): use a 7-day lookback window to handle weekends/holidays.
    """
    raise NotImplementedError


def _grade_confidence(next_q: QuarterlyEPS, provider: str | None) -> str:
    if next_q.source == "llm_extracted":
        return "low"
    if next_q.analyst_count is not None and next_q.analyst_count >= 5:
        return "high"
    return "medium"


def _trailing_only_fallback(
    ticker: str, as_of: date, actuals: list[QuarterlyEPS], reason: str,
) -> ForwardMetrics | None:
    """Build a ForwardMetrics from trailing actuals only with confidence='low'.

    TODO(codex):
    - Use last 4 actuals if available; if fewer than 4, return None.
    - Sum EPS, compute forward_pe = price / sum.
    - notes=[reason], confidence='low'.
    """
    raise NotImplementedError
