"""Forward TTM EPS / Forward PER synthesis."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from src.data.models_forward import ForwardMetrics, QuarterlyEPS
from src.tools.api import get_financial_metrics, get_prices
from src.tools.estimates_api import EstimateProvider, default_provider_chain


logger = logging.getLogger(__name__)


_FORWARD_CACHE: dict[tuple[str, str], ForwardMetrics | None] = {}


def get_forward_metrics(
    ticker: str,
    as_of_date: str | date | None = None,
    api_key: str | None = None,
    providers: list[EstimateProvider] | None = None,
) -> ForwardMetrics | None:
    """Return forward TTM EPS and forward P/E for ``ticker``.

    The result splices the latest three actual EPS quarters with one
    next-quarter consensus estimate. If no estimate is available, the function
    returns a low-confidence trailing-only snapshot when four actual quarters
    are available.
    """
    as_of = _coerce_date(as_of_date)
    cache_key = (ticker, as_of.isoformat())
    if cache_key in _FORWARD_CACHE:
        return _FORWARD_CACHE[cache_key]

    actuals = _load_trailing_quarterly_eps(ticker, as_of, api_key)
    if len(actuals) < 3:
        result = _trailing_only_fallback(
            ticker,
            as_of,
            actuals,
            reason="insufficient actual quarters",
        )
        _FORWARD_CACHE[cache_key] = result
        return result

    last_three = actuals[-3:]
    provider_chain = providers or default_provider_chain(ticker)
    next_q: QuarterlyEPS | None = None
    used_provider: str | None = None

    for provider in provider_chain:
        try:
            estimates = provider.fetch_quarterly_eps_estimates(ticker, as_of, num_quarters=1)
        except Exception as exc:
            logger.warning("estimate provider %s failed for %s: %s", provider.name, ticker, exc)
            continue

        future_estimates = [
            estimate
            for estimate in estimates
            if estimate.fiscal_period_end > last_three[-1].fiscal_period_end
        ]
        if future_estimates:
            next_q = sorted(future_estimates, key=lambda q: q.fiscal_period_end)[0]
            used_provider = provider.name
            break

    if next_q is None:
        result = _trailing_only_fallback(
            ticker,
            as_of,
            actuals,
            reason="no consensus estimate available",
        )
        _FORWARD_CACHE[cache_key] = result
        return result

    composition = last_three + [next_q]
    forward_eps_ttm = sum(q.eps for q in composition)
    current_price = _latest_close(ticker, as_of)
    if current_price is None:
        logger.warning("no price available for %s as of %s", ticker, as_of)
        _FORWARD_CACHE[cache_key] = None
        return None

    notes = ["EPS splice mixes reported EPS with consensus EPS; normalization is not adjusted in v1."]
    if forward_eps_ttm <= 0:
        forward_pe: float | None = None
        notes.append(f"forward_eps_ttm={forward_eps_ttm:.2f}; forward_pe undefined")
    else:
        forward_pe = current_price / forward_eps_ttm

    confidence = _grade_confidence(next_q, used_provider)
    if (as_of - next_q.as_of) > timedelta(days=14):
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


def _coerce_date(value: str | date | None) -> date:
    if value is None:
        return datetime.utcnow().date()
    if isinstance(value, date):
        return value
    return datetime.strptime(value, "%Y-%m-%d").date()


def _load_trailing_quarterly_eps(
    ticker: str,
    as_of: date,
    api_key: str | None,
) -> list[QuarterlyEPS]:
    """Load quarterly actual EPS sorted ascending by fiscal period end."""
    try:
        metrics = get_financial_metrics(
            ticker=ticker,
            end_date=as_of.isoformat(),
            period="quarter",
            limit=8,
            api_key=api_key,
        )
    except Exception as exc:
        logger.warning("failed to load quarterly financial metrics for %s: %s", ticker, exc)
        return []

    actuals: list[QuarterlyEPS] = []
    for metric in metrics:
        fiscal_end = _parse_report_period(getattr(metric, "report_period", None))
        if fiscal_end is None or fiscal_end > as_of:
            continue

        eps = _metric_eps(metric)
        if eps is None:
            continue

        actuals.append(
            QuarterlyEPS(
                period=_period_label(fiscal_end),
                fiscal_period_end=fiscal_end,
                eps=eps,
                source="actual",
                provider=str(getattr(metric, "source", None) or "FinancialDatasets"),
                as_of=as_of,
            )
        )

    return sorted(actuals, key=lambda q: q.fiscal_period_end)


def _latest_close(ticker: str, as_of: date) -> float | None:
    """Return the latest close at or before ``as_of`` using a 7-day lookback."""
    start = as_of - timedelta(days=7)
    try:
        prices = get_prices(
            ticker=ticker,
            start_date=start.isoformat(),
            end_date=as_of.isoformat(),
        )
    except Exception as exc:
        logger.warning("failed to load prices for %s: %s", ticker, exc)
        return None

    dated_prices: list[tuple[date, float]] = []
    for price in prices:
        price_date = _parse_report_period(getattr(price, "time", None))
        close = getattr(price, "close", None)
        if price_date is not None and price_date <= as_of and close is not None:
            dated_prices.append((price_date, float(close)))

    if not dated_prices:
        return None
    return sorted(dated_prices, key=lambda item: item[0])[-1][1]


def _grade_confidence(next_q: QuarterlyEPS, provider: str | None) -> str:
    if next_q.source == "llm_extracted" or provider == "LLM-fallback":
        return "low"
    if next_q.analyst_count is not None and next_q.analyst_count >= 5:
        return "high"
    return "medium"


def _trailing_only_fallback(
    ticker: str,
    as_of: date,
    actuals: list[QuarterlyEPS],
    reason: str,
) -> ForwardMetrics | None:
    if len(actuals) < 4:
        logger.warning("cannot build trailing-only forward metrics for %s: %s", ticker, reason)
        return None

    composition = actuals[-4:]
    forward_eps_ttm = sum(q.eps for q in composition)
    current_price = _latest_close(ticker, as_of)
    if current_price is None:
        return None

    if forward_eps_ttm <= 0:
        forward_pe: float | None = None
        notes = [reason, f"forward_eps_ttm={forward_eps_ttm:.2f}; forward_pe undefined"]
    else:
        forward_pe = current_price / forward_eps_ttm
        notes = [reason]

    return ForwardMetrics(
        ticker=ticker,
        as_of_date=as_of,
        current_price=current_price,
        forward_eps_ttm=forward_eps_ttm,
        forward_pe=forward_pe,
        composition=composition,
        confidence="low",
        notes=notes,
    )


def _metric_eps(metric: Any) -> float | None:
    eps = getattr(metric, "earnings_per_share", None)
    if eps is not None:
        return float(eps)

    net_income = getattr(metric, "net_income", None)
    shares = getattr(metric, "outstanding_shares", None)
    if net_income is None or not shares:
        return None
    return float(net_income) / float(shares)


def _parse_report_period(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _period_label(fiscal_end: date) -> str:
    quarter = ((fiscal_end.month - 1) // 3) + 1
    return f"{fiscal_end.year}Q{quarter}"
