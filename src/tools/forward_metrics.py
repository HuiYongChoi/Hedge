"""Forward TTM EPS / Forward PER synthesis."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from src.data.models_forward import AnnualEPSEstimate, ForwardMetrics, QuarterlyEPS
from src.tools.api import _is_korean_ticker, get_financial_metrics, get_prices
from src.tools.estimates_api import EstimateProvider, default_provider_chain


logger = logging.getLogger(__name__)


_FORWARD_CACHE: dict[tuple[str, str], ForwardMetrics | None] = {}


def _forward_cache_key(ticker: str, as_of: date) -> tuple[str, str]:
    return (ticker.upper(), as_of.isoformat())


def _shared_forward_cache_key(ticker: str, as_of: date) -> str:
    return f"{ticker.upper()}_{as_of.isoformat()}"


def _get_forward_metrics_override(ticker: str, as_of: date) -> ForwardMetrics | None:
    try:
        from src.data.cache import get_cache

        return get_cache().get_forward_metrics(_shared_forward_cache_key(ticker, as_of))
    except Exception:
        return None


def set_forward_metrics_override(forward_metrics: ForwardMetrics) -> None:
    """Inject a run-scoped forward metrics override into both forward caches."""
    as_of = _coerce_date(forward_metrics.as_of_date)
    ticker = forward_metrics.ticker.upper()

    from src.data.cache import get_cache

    get_cache().set_forward_metrics(_shared_forward_cache_key(ticker, as_of), forward_metrics)
    _FORWARD_CACHE[_forward_cache_key(ticker, as_of)] = forward_metrics


def clear_forward_metrics_override(ticker: str, as_of_date: str | date | None) -> None:
    """Remove a run-scoped forward metrics override so later runs recompute data."""
    as_of = _coerce_date(as_of_date)
    normalized_ticker = ticker.upper()

    try:
        from src.data.cache import get_cache

        get_cache()._forward_metrics_cache.pop(_shared_forward_cache_key(normalized_ticker, as_of), None)
    except Exception:
        pass

    _FORWARD_CACHE.pop(_forward_cache_key(normalized_ticker, as_of), None)


def _fetch_price_compass_forward_snapshot(ticker: str):
    """Return the live Price Compass analyst target snapshot when available."""
    try:
        from src.tools.analyst_target_api import fetch_analyst_target

        return fetch_analyst_target(ticker)
    except Exception as exc:
        logger.debug("price compass forward snapshot unavailable for %s: %s", ticker, exc)
        return None


def _positive_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _apply_price_compass_forward_snapshot(result: ForwardMetrics) -> ForwardMetrics:
    """Attach canonical Price Compass FwdPER fields without rewriting raw splice data.

    ``ForwardMetrics.forward_pe`` intentionally remains the raw TTM-splice
    multiple for backward compatibility. Agents and LLM-facing blocks should use
    ``canonical_forward_pe`` when present because it matches the Price Compass
    header and user-facing FwdPER.
    """
    snapshot = _fetch_price_compass_forward_snapshot(result.ticker)
    if snapshot is None:
        return result

    canonical_forward_pe = _positive_float(getattr(snapshot, "forward_pe", None))
    if canonical_forward_pe is None:
        return result

    canonical_current_price = _positive_float(getattr(snapshot, "current_price", None))
    canonical_forward_eps = _positive_float(getattr(snapshot, "forward_eps", None))
    current_fy_eps = _positive_float(getattr(snapshot, "current_fy_eps", None))

    updates: dict[str, Any] = {
        "canonical_forward_pe": canonical_forward_pe,
        "canonical_current_price": canonical_current_price,
        "canonical_forward_eps": canonical_forward_eps,
    }
    if canonical_forward_eps is not None:
        updates.setdefault("forward_eps_fy1", canonical_forward_eps)
        updates.setdefault("forward_pe_fy1", canonical_forward_pe)
    if canonical_current_price is not None and current_fy_eps is not None:
        updates.setdefault("forward_eps_fy0", current_fy_eps)
        updates.setdefault("forward_pe_fy0", canonical_current_price / current_fy_eps)

    notes = list(result.notes)
    notes.append("canonical forward P/E sourced from Price Compass analyst target API")
    updates["notes"] = notes
    return result.model_copy(update=updates)


def build_forward_metrics_override(
    ticker: str,
    as_of_date: str | date | None,
    payload: dict[str, Any],
    api_key: str | None = None,
) -> ForwardMetrics | None:
    """Build a trusted run-scoped ForwardMetrics object from a user override payload."""
    if not isinstance(payload, dict) or "forward_pe" not in payload:
        return None

    try:
        forward_pe = float(payload["forward_pe"])
    except (TypeError, ValueError):
        return None
    if forward_pe <= 0:
        return None

    as_of = _coerce_date(as_of_date)
    if {"current_price", "forward_eps_ttm", "composition"}.issubset(payload.keys()):
        data = dict(payload)
    else:
        baseline = get_forward_metrics(ticker, as_of_date=as_of, api_key=api_key)
        if baseline is None:
            return None
        data = baseline.model_dump()
        data.update(payload)

    data["ticker"] = ticker.upper()
    data["as_of_date"] = as_of
    data["forward_pe"] = forward_pe
    if data.get("confidence") not in ("high", "medium", "low"):
        data["confidence"] = "high"
    if payload.get("forward_pe") is not None:
        data["confidence"] = "high"

    notes = list(data.get("notes") or [])
    override_note = "user override: forward_pe manually set via Data Sandbox"
    if override_note not in notes:
        notes.append(override_note)

    # Handle annual FY0 / FY1 overrides
    for fy_key, eps_key, note_text in (
        ("forward_pe_fy0", "forward_eps_fy0", "user override: forward_pe_fy0 manually set via Data Sandbox"),
        ("forward_pe_fy1", "forward_eps_fy1", "user override: forward_pe_fy1 manually set via Data Sandbox"),
    ):
        raw_fy_pe = payload.get(fy_key)
        if raw_fy_pe is not None:
            try:
                fy_pe = float(raw_fy_pe)
            except (TypeError, ValueError):
                fy_pe = None
            if fy_pe is not None and fy_pe > 0:
                data["confidence"] = "high"
                data[fy_key] = fy_pe
                # If no eps yet, back-derive from price / pe
                if not data.get(eps_key):
                    try:
                        data[eps_key] = float(data.get("current_price", 0)) / fy_pe
                    except Exception:
                        pass
                if note_text not in notes:
                    notes.append(note_text)

    data["notes"] = notes

    try:
        return ForwardMetrics(**data)
    except Exception as exc:
        logger.warning("invalid forward metrics override for %s: %s", ticker, exc)
        return None


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
    if override := _get_forward_metrics_override(ticker, as_of):
        return override

    cache_key = _forward_cache_key(ticker, as_of)
    if cache_key in _FORWARD_CACHE:
        return _FORWARD_CACHE[cache_key]

    use_price_compass_snapshot = providers is None
    actuals = _load_trailing_quarterly_eps(ticker, as_of, api_key)

    # Detect staleness: most recent actual > 6 months before as_of
    staleness_notes: list[str] = []
    staleness_confidence_downgrade = False
    if actuals:
        most_recent_actual = actuals[-1].fiscal_period_end
        stale_days = (as_of - most_recent_actual).days
        if stale_days > 180:
            staleness_notes.append(f"actual data stale by {stale_days}d (latest: {most_recent_actual})")
            staleness_confidence_downgrade = True

    # Detect missing quarters
    gap_notes = _detect_missing_quarters(actuals, as_of)

    if len(actuals) < 3:
        result = _trailing_only_fallback(
            ticker,
            as_of,
            actuals,
            reason="insufficient actual quarters",
        )
        if result is not None:
            result.notes.extend(staleness_notes + gap_notes)
            if use_price_compass_snapshot:
                result = _apply_price_compass_forward_snapshot(result)
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
        if result is not None and use_price_compass_snapshot:
            result = _apply_price_compass_forward_snapshot(result)
        _FORWARD_CACHE[cache_key] = result
        return result

    composition = last_three + [next_q]
    forward_eps_ttm = sum(q.eps for q in composition)
    current_price = _latest_close(ticker, as_of)
    if current_price is None:
        logger.warning("no price available for %s as of %s", ticker, as_of)
        _FORWARD_CACHE[cache_key] = None
        return None

    # Currency guard: verify price and EPS are in the same currency
    ticker_currency = _detect_ticker_currency(ticker)
    currency_note = _check_currency_consistency(ticker, ticker_currency, composition)
    if currency_note == "MISMATCH":
        logger.warning("currency mismatch detected for %s; forward_pe unreliable", ticker)

    notes: list[str] = ["EPS splice mixes reported EPS with consensus EPS; normalization is not adjusted in v1."]
    notes.extend(staleness_notes)
    notes.extend(gap_notes)
    if currency_note and currency_note != "MISMATCH":
        notes.append(currency_note)

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

    if staleness_confidence_downgrade:
        confidence = _downgrade_confidence(confidence)

    if currency_note == "MISMATCH":
        notes.append("currency mismatch between price and EPS; forward_pe may be unreliable")

    # ── Annual FY0 / FY+1 synthesis ───────────────────────────────────────────
    annual_estimates: list[AnnualEPSEstimate] = []
    forward_eps_fy0: float | None = None
    forward_pe_fy0: float | None = None
    fy0_estimate: AnnualEPSEstimate | None = None
    forward_eps_fy1: float | None = None
    forward_pe_fy1: float | None = None
    fy1_estimate: AnnualEPSEstimate | None = None

    for provider in provider_chain:
        try:
            ann = provider.fetch_annual_eps_estimates(ticker, as_of, num_years=2)
        except Exception as exc:
            logger.warning("annual estimate provider %s failed for %s: %s", provider.name, ticker, exc)
            continue
        future_ann = [e for e in ann if e.fiscal_year_end >= as_of]
        future_ann.sort(key=lambda e: e.fiscal_year_end)
        if future_ann:
            annual_estimates = future_ann[:2]
            notes.append(f"annual estimate provider={provider.name}")
            break

    if currency_note != "MISMATCH" and annual_estimates:
        fy0_est = annual_estimates[0]
        fy0_estimate = fy0_est
        forward_eps_fy0 = fy0_est.eps
        if fy0_est.eps > 0:
            forward_pe_fy0 = current_price / fy0_est.eps
        if fy0_est.analyst_count is not None:
            notes.append(f"fy0 analyst_count={fy0_est.analyst_count}")
        if len(annual_estimates) >= 2:
            fy1_est = annual_estimates[1]
            fy1_estimate = fy1_est
            forward_eps_fy1 = fy1_est.eps
            if fy1_est.eps > 0:
                forward_pe_fy1 = current_price / fy1_est.eps

    result = ForwardMetrics(
        ticker=ticker,
        as_of_date=as_of,
        current_price=current_price,
        forward_eps_ttm=forward_eps_ttm,
        forward_pe=forward_pe,
        composition=composition,
        confidence=confidence,
        notes=notes,
        currency=ticker_currency or "USD",
        forward_eps_fy0=forward_eps_fy0,
        forward_pe_fy0=forward_pe_fy0,
        fy0_estimate=fy0_estimate,
        forward_eps_fy1=forward_eps_fy1,
        forward_pe_fy1=forward_pe_fy1,
        fy1_estimate=fy1_estimate,
        annual_estimates=annual_estimates,
    )
    if use_price_compass_snapshot:
        result = _apply_price_compass_forward_snapshot(result)
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
    """Load quarterly actual EPS sorted ascending by fiscal period end.

    For Korean tickers, merges yfinance data with DART quarterly series.
    DART data takes precedence on duplicate fiscal_period_end (official source).
    Also annotates staleness and missing quarters for use by the caller.
    """
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
        metrics = []

    primary: list[QuarterlyEPS] = []
    for metric in metrics:
        metric_period = str(getattr(metric, "period", "") or "").lower()
        if metric_period not in ("quarter", "quarterly"):
            continue
        fiscal_end = _parse_report_period(getattr(metric, "report_period", None))
        if fiscal_end is None or fiscal_end > as_of:
            continue
        eps = _metric_eps(metric)
        if eps is None:
            continue
        primary.append(
            QuarterlyEPS(
                period=_period_label(fiscal_end),
                fiscal_period_end=fiscal_end,
                eps=eps,
                source="actual",
                provider=str(getattr(metric, "source", None) or "FinancialDatasets"),
                as_of=as_of,
            )
        )

    yf_actuals = _load_yfinance_quarterly_eps(ticker, as_of)
    combined = _merge_quarterly_eps(primary, yf_actuals)

    if _is_korean_ticker(ticker):
        dart_actuals = _load_dart_quarterly_eps(ticker, as_of)
        combined = _merge_quarterly_eps(combined, dart_actuals, prefer_new=True)

    combined.sort(key=lambda q: q.fiscal_period_end)
    return combined


def _load_dart_quarterly_eps(ticker: str, as_of: date) -> list[QuarterlyEPS]:
    """Load DART quarterly EPS series for a Korean ticker."""
    try:
        from src.tools.dart_api import fetch_quarterly_eps_series
        return fetch_quarterly_eps_series(ticker, as_of.isoformat(), num_quarters=8)
    except Exception as exc:
        logger.warning("DART quarterly EPS load failed for %s: %s", ticker, exc)
        return []


def _merge_quarterly_eps(
    base: list[QuarterlyEPS],
    overlay: list[QuarterlyEPS],
    prefer_new: bool = False,
) -> list[QuarterlyEPS]:
    """Merge two lists deduplicated by fiscal_period_end.

    When prefer_new=True, overlay wins on collision (used for DART over yfinance).
    When prefer_new=False, base wins (yfinance over primary API when primary is sparse).
    """
    result: dict[date, QuarterlyEPS] = {}
    for q in base:
        result[q.fiscal_period_end] = q
    for q in overlay:
        if prefer_new or q.fiscal_period_end not in result:
            result[q.fiscal_period_end] = q
    return list(result.values())


def _detect_missing_quarters(actuals: list[QuarterlyEPS], as_of: date) -> list[str]:
    """Return list of note strings for missing expected quarters in the last 18 months."""
    if len(actuals) < 2:
        return []

    notes: list[str] = []
    ends = sorted(q.fiscal_period_end for q in actuals)
    # Check contiguity — expected quarters are approx 3 months apart
    for i in range(1, len(ends)):
        gap_months = (ends[i].year - ends[i - 1].year) * 12 + (ends[i].month - ends[i - 1].month)
        if gap_months > 4:
            # There's a gap; estimate which quarters are missing
            mid = date(ends[i - 1].year + (ends[i - 1].month + 3) // 12,
                       ((ends[i - 1].month + 2) % 12) + 1, 28)
            notes.append(f"gap in quarterly series: {ends[i-1]} → {ends[i]} (≈{gap_months}mo)")
    return notes


def _load_yfinance_quarterly_eps(ticker: str, as_of: date) -> list[QuarterlyEPS]:
    """Load quarterly actual EPS from yfinance when primary metrics lack quarters."""
    try:
        import yfinance as yf

        ticker_obj = yf.Ticker(ticker)
        statement = getattr(ticker_obj, "quarterly_income_stmt", None)
        if statement is None or getattr(statement, "empty", True):
            statement = getattr(ticker_obj, "quarterly_financials", None)
        if (statement is None or getattr(statement, "empty", True)) and hasattr(ticker_obj, "get_income_stmt"):
            statement = ticker_obj.get_income_stmt(freq="quarterly")
        if statement is None or getattr(statement, "empty", True):
            return []

        dated_columns: list[tuple[date, Any]] = []
        for column in statement.columns:
            fiscal_end = _parse_report_period(column)
            if fiscal_end is not None and fiscal_end <= as_of:
                dated_columns.append((fiscal_end, column))

        actuals: list[QuarterlyEPS] = []
        for fiscal_end, column in sorted(dated_columns, key=lambda item: item[0], reverse=True)[:8]:
            eps = _statement_value(
                statement,
                column,
                ("Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"),
            )
            if eps is None:
                net_income = _statement_value(
                    statement,
                    column,
                    (
                        "Net Income",
                        "NetIncome",
                        "Net Income Common Stockholders",
                        "NetIncomeCommonStockholders",
                    ),
                )
                shares = _statement_value(
                    statement,
                    column,
                    ("Diluted Average Shares", "DilutedAverageShares", "Basic Average Shares", "BasicAverageShares"),
                )
                if net_income is not None and shares:
                    eps = net_income / shares
            if eps is None:
                continue

            actuals.append(
                QuarterlyEPS(
                    period=_period_label(fiscal_end),
                    fiscal_period_end=fiscal_end,
                    eps=eps,
                    source="actual",
                    provider="YFinance",
                    as_of=as_of,
                )
            )

        return sorted(actuals, key=lambda q: q.fiscal_period_end)
    except Exception as exc:
        logger.warning("failed to load yfinance quarterly EPS for %s: %s", ticker, exc)
        return []


def _statement_value(statement: Any, column: Any, labels: tuple[str, ...]) -> float | None:
    label_lookup = {_normalize_statement_label(index): index for index in getattr(statement, "index", [])}
    for label in labels:
        actual_label = label_lookup.get(_normalize_statement_label(label))
        if actual_label is None:
            continue
        try:
            value = statement.loc[actual_label, column]
            if value is None:
                return None
            number = float(value)
            if number != number:
                return None
            return number
        except Exception:
            return None
    return None


def _normalize_statement_label(value: Any) -> str:
    return "".join(ch for ch in str(value).lower() if ch.isalnum())


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
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if hasattr(value, "date"):
        try:
            converted = value.date()
            if isinstance(converted, datetime):
                return converted.date()
            if isinstance(converted, date):
                return converted
        except Exception:
            pass
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _period_label(fiscal_end: date) -> str:
    quarter = ((fiscal_end.month - 1) // 3) + 1
    return f"{fiscal_end.year}Q{quarter}"


def _detect_ticker_currency(ticker: str) -> str | None:
    """Return the currency for a ticker using yfinance fast_info when available."""
    try:
        if _is_korean_ticker(ticker):
            return "KRW"
        import yfinance as yf
        info = yf.Ticker(ticker).fast_info
        return getattr(info, "currency", None) or info.get("currency")
    except Exception:
        return None


def _check_currency_consistency(
    ticker: str,
    ticker_currency: str | None,
    composition: list[QuarterlyEPS],
) -> str:
    """Return 'MISMATCH', a warning note string, or empty string.

    Logic: if the ticker is Korean (KRW price) but providers report USD EPS (or vice-versa),
    flag a mismatch. In practice, Korean providers (DART / NaverFinance) always report in KRW,
    so this check is mainly a guard for cross-provider contamination.
    """
    if ticker_currency is None:
        return ""
    if not composition:
        return ""

    providers_used = {q.provider for q in composition if q.source != "consensus"}
    # DART and NaverFinance always provide KRW
    kr_providers = {"DART", "NaverFinance", "WiseReport", "HankyungConsensus"}
    us_providers = {"FMP", "YFinance", "FinancialDatasets"}

    has_kr_provider = bool(providers_used & kr_providers)
    has_us_provider = bool(providers_used & us_providers)

    if has_kr_provider and has_us_provider:
        return "MISMATCH"
    if ticker_currency == "KRW" and has_us_provider and not has_kr_provider:
        return "MISMATCH"
    if ticker_currency == "USD" and has_kr_provider and not has_us_provider:
        return "MISMATCH"
    return ""


def _downgrade_confidence(confidence: str) -> str:
    if confidence == "high":
        return "medium"
    if confidence == "medium":
        return "low"
    return "low"
