"""Analyst consensus estimate providers for forward EPS.

Each provider hides source-specific quirks behind a tiny common interface. The
forward splicing layer can then ask for next-quarter EPS without deciding where
that estimate came from.
"""

from __future__ import annotations

import logging
import os
from datetime import date
from typing import Any, Protocol

import requests

from src.data.models_forward import AnnualEPSEstimate, QuarterlyEPS


logger = logging.getLogger(__name__)


class EstimateProvider(Protocol):
    name: str

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]: ...

    def fetch_annual_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_years: int = 2,
    ) -> list[AnnualEPSEstimate]: ...


class FMPEstimateProvider:
    name = "FMP"

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or os.environ.get("FMP_API_KEY")

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        if not self._api_key:
            logger.info("FMP_API_KEY not set; skipping FMP estimates for %s", ticker)
            return []

        try:
            response = requests.get(
                f"https://financialmodelingprep.com/api/v3/analyst-estimates/{ticker}",
                params={"period": "quarter", "apikey": self._api_key},
                timeout=10,
            )
            if response.status_code != 200:
                logger.warning("FMP estimates failed for %s: HTTP %s", ticker, response.status_code)
                return []

            payload = response.json()
            if not isinstance(payload, list):
                logger.warning("FMP estimates returned non-list payload for %s", ticker)
                return []

            estimates: list[QuarterlyEPS] = []
            for row in payload:
                if not isinstance(row, dict):
                    continue
                fiscal_end = _parse_date(
                    _first_present(row, "date", "fiscalDateEnding", "fiscalPeriodEnd")
                )
                eps = _as_float(
                    _first_present(
                        row,
                        "estimatedEpsAvg",
                        "estimatedEPSAvg",
                        "estimatedEpsAverage",
                        "epsEstimatedAverage",
                        "estimatedEPS",
                    )
                )
                if fiscal_end is None or fiscal_end <= as_of_date or eps is None:
                    continue

                high = _as_float(_first_present(row, "estimatedEpsHigh", "estimatedEPSHigh"))
                low = _as_float(_first_present(row, "estimatedEpsLow", "estimatedEPSLow"))
                estimates.append(
                    QuarterlyEPS(
                        period=_period_label(fiscal_end),
                        fiscal_period_end=fiscal_end,
                        eps=eps,
                        source="consensus",
                        provider=self.name,
                        as_of=as_of_date,
                        analyst_count=_as_int(
                            _first_present(
                                row,
                                "numberAnalystEstimatedEps",
                                "numberAnalystsEstimatedEps",
                                "numberOfAnalystEstimatedEps",
                                "numberOfAnalysts",
                            )
                        ),
                        dispersion=_estimate_dispersion(high, low),
                    )
                )

            return sorted(estimates, key=lambda q: q.fiscal_period_end)[:num_quarters]
        except Exception as exc:
            logger.warning("FMP estimates failed for %s: %s", ticker, exc)
            return []

    def fetch_annual_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_years: int = 2,
    ) -> list[AnnualEPSEstimate]:
        if not self._api_key:
            return []
        try:
            response = requests.get(
                f"https://financialmodelingprep.com/api/v3/analyst-estimates/{ticker}",
                params={"period": "annual", "apikey": self._api_key},
                timeout=10,
            )
            if response.status_code != 200:
                return []
            payload = response.json()
            if not isinstance(payload, list):
                return []

            estimates: list[AnnualEPSEstimate] = []
            for row in payload:
                if not isinstance(row, dict):
                    continue
                fiscal_end = _parse_date(_first_present(row, "date", "fiscalDateEnding"))
                eps = _as_float(_first_present(row, "estimatedEpsAvg", "estimatedEPSAvg", "estimatedEpsAverage"))
                if fiscal_end is None or fiscal_end <= as_of_date or eps is None:
                    continue
                high = _as_float(_first_present(row, "estimatedEpsHigh", "estimatedEPSHigh"))
                low = _as_float(_first_present(row, "estimatedEpsLow", "estimatedEPSLow"))
                analyst_count = _as_int(_first_present(row, "numberAnalystEstimatedEps", "numberOfAnalysts"))
                estimates.append(
                    AnnualEPSEstimate(
                        fiscal_year=fiscal_end.year,
                        fiscal_year_end=fiscal_end,
                        eps=eps,
                        source="consensus",
                        provider=self.name,
                        as_of=as_of_date,
                        analyst_count=analyst_count,
                        dispersion=_estimate_dispersion(high, low),
                        confidence=_grade_annual_confidence(analyst_count),
                    )
                )
            return sorted(estimates, key=lambda e: e.fiscal_year_end)[:num_years]
        except Exception as exc:
            logger.warning("FMP annual estimates failed for %s: %s", ticker, exc)
            return []


class YFinanceEstimateProvider:
    name = "YFinance"

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        try:
            import yfinance as yf

            tk = yf.Ticker(ticker)
            df = getattr(tk, "earnings_estimate", None)
            if df is None and hasattr(tk, "get_earnings_estimate"):
                df = tk.get_earnings_estimate()
            if df is None or getattr(df, "empty", True):
                df = getattr(tk, "eps_trend", None)
            if df is None or getattr(df, "empty", True):
                return []

            row = _find_yfinance_next_quarter_row(df)
            if row is None:
                return []

            eps = _as_float(_row_get(row, "avg", "average", "epsAvg", "current"))
            if eps is None:
                return []

            fiscal_end = _current_quarter_end(as_of_date)
            estimate = QuarterlyEPS(
                period=_period_label(fiscal_end),
                fiscal_period_end=fiscal_end,
                eps=eps,
                source="consensus",
                provider=self.name,
                as_of=as_of_date,
                analyst_count=_as_int(
                    _row_get(row, "numberOfAnalysts", "numberOfAnalyst", "numAnalysts")
                ),
                dispersion=_estimate_dispersion(
                    _as_float(_row_get(row, "high")),
                    _as_float(_row_get(row, "low")),
                ),
            )
            return [estimate][:num_quarters]
        except Exception as exc:
            logger.warning("YFinance estimates failed for %s: %s", ticker, exc)
            return []

    def fetch_annual_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_years: int = 2,
    ) -> list[AnnualEPSEstimate]:
        try:
            import yfinance as yf

            tk = yf.Ticker(ticker)
            df = getattr(tk, "earnings_estimate", None)
            if df is None and hasattr(tk, "get_earnings_estimate"):
                df = tk.get_earnings_estimate()
            if df is None or getattr(df, "empty", True):
                return []

            # Determine fiscal year end from calendar if available
            fy_end_month, fy_end_day = 12, 31
            try:
                cal = getattr(tk, "calendar", None)
                if isinstance(cal, dict):
                    raw_fy = cal.get("Fiscal Year End") or cal.get("fiscalYearEnd")
                    if raw_fy:
                        parsed = _parse_date(raw_fy)
                        if parsed:
                            fy_end_month, fy_end_day = parsed.month, parsed.day
            except Exception:
                pass

            estimates: list[AnnualEPSEstimate] = []
            for label_offset, row_label in enumerate(("+1y", "+2y"), start=1):
                if row_label not in df.index:
                    continue
                row = df.loc[row_label]
                eps = _as_float(_row_get(row, "avg", "average", "epsAvg", "current"))
                if eps is None:
                    continue
                fy_year = as_of_date.year - 1 + label_offset
                # If current month is past the fiscal year end, target next year
                if as_of_date.month > fy_end_month or (as_of_date.month == fy_end_month and as_of_date.day >= fy_end_day):
                    fy_year += 1
                fy_end = date(fy_year, fy_end_month, fy_end_day)
                if fy_end <= as_of_date:
                    fy_end = date(fy_year + 1, fy_end_month, fy_end_day)
                analyst_count = _as_int(_row_get(row, "numberOfAnalysts", "numberOfAnalyst", "numAnalysts"))
                estimates.append(
                    AnnualEPSEstimate(
                        fiscal_year=fy_end.year,
                        fiscal_year_end=fy_end,
                        eps=eps,
                        source="consensus",
                        provider=self.name,
                        as_of=as_of_date,
                        analyst_count=analyst_count,
                        dispersion=_estimate_dispersion(
                            _as_float(_row_get(row, "high")),
                            _as_float(_row_get(row, "low")),
                        ),
                        confidence=_grade_annual_confidence(analyst_count),
                    )
                )
            return estimates[:num_years]
        except Exception as exc:
            logger.warning("YFinance annual estimates failed for %s: %s", ticker, exc)
            return []


class KrFnGuideProvider:
    # Deprecated: replaced by kr_consensus package providers in default_provider_chain.
    # Kept for import compatibility.
    name = "KrFnGuide"

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        logger.info("KrFnGuideProvider deprecated; falling through for %s", ticker)
        return []

    def fetch_annual_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_years: int = 2,
    ) -> list[AnnualEPSEstimate]:
        return []


class LLMEstimateProvider:
    name = "LLM-fallback"

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        logger.info("LLMEstimateProvider not implemented; no estimate for %s", ticker)
        return []

    def fetch_annual_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_years: int = 2,
    ) -> list[AnnualEPSEstimate]:
        return []


def _grade_annual_confidence(analyst_count: int | None) -> str:
    if analyst_count is not None and analyst_count >= 5:
        return "high"
    if analyst_count is not None and analyst_count >= 1:
        return "medium"
    return "low"


def default_provider_chain(ticker: str) -> list[EstimateProvider]:
    """Return provider priority for a ticker without duplicating ticker routing."""
    try:
        from src.tools.api import _is_korean_ticker
    except Exception:
        _is_korean_ticker = lambda value: value.endswith((".KS", ".KQ"))

    if _is_korean_ticker(ticker):
        try:
            from src.tools.kr_consensus import (
                HankyungMetaProvider,
                NaverConsensusProvider,
                WiseReportProvider,
            )
            return [
                NaverConsensusProvider(),
                WiseReportProvider(),
                HankyungMetaProvider(),
                LLMEstimateProvider(),
            ]
        except ImportError:
            logger.warning("kr_consensus package unavailable; falling back to stub")
            return [KrFnGuideProvider(), LLMEstimateProvider()]

    return [FMPEstimateProvider(), YFinanceEstimateProvider(), LLMEstimateProvider()]


def _first_present(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        if isinstance(value, str):
            value = value.replace(",", "").strip()
            if value in ("", "-", "nan", "NaN", "None"):
                return None
        return float(value)
    except Exception:
        return None


def _as_int(value: Any) -> int | None:
    number = _as_float(value)
    if number is None:
        return None
    return int(number)


def _parse_date(value: Any) -> date | None:
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


def _estimate_dispersion(high: float | None, low: float | None) -> float | None:
    if high is None or low is None or high < low:
        return None
    return (high - low) / 4


def _find_yfinance_next_quarter_row(df: Any) -> Any | None:
    try:
        for label in ("+1q", "1q", "next q", "next quarter", "0q"):
            if label in df.index:
                return df.loc[label]
        for idx in df.index:
            if "q" in str(idx).lower():
                return df.loc[idx]
    except Exception:
        return None
    return None


def _row_get(row: Any, *keys: str) -> Any:
    lookup = {str(key).lower(): key for key in getattr(row, "index", [])}
    for key in keys:
        actual = lookup.get(key.lower())
        if actual is not None:
            return row.get(actual)
    return None


def _current_quarter_end(as_of_date: date) -> date:
    quarter = ((as_of_date.month - 1) // 3) + 1
    end_month = quarter * 3
    end_day = 31 if end_month in (3, 12) else 30
    return date(as_of_date.year, end_month, end_day)
