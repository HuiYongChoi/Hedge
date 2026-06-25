import datetime
import logging
import os
import pandas as pd
import re
import requests
import time
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger(__name__)

from src.data.cache import get_cache
from src.data.models import (
    CompanyNews,
    CompanyNewsResponse,
    FinancialMetrics,
    FinancialMetricsResponse,
    Price,
    PriceResponse,
    LineItem,
    LineItemResponse,
    InsiderTrade,
    InsiderTradeResponse,
    CompanyFactsResponse,
)
from src.utils.data_standardizer import (
    enrich_metrics_from_line_items,
    standardize_financial_metric_payload,
    standardize_line_items,
)

# Global cache instance
_cache = get_cache()

# Module-level caches for enrichment (prevent duplicate API calls across agents in same run)
_MARKET_CAP_CACHE: dict[tuple[str, str], float | None] = {}
_ENRICHMENT_LINE_ITEMS_CACHE: dict[tuple[str, str], list[dict]] = {}
_ENRICHMENT_IN_PROGRESS: set[tuple[str, str]] = set()  # recursion guard


@dataclass
class PbrHistoryPoint:
    period: str
    price_to_book_ratio: float
    book_value_per_share: float | None = None
    source: str = ""

DEFAULT_FINANCIAL_METRIC_FIELDS = tuple(FinancialMetrics.model_fields.keys())
LINE_ITEM_DERIVED_FIELDS = (
    "gross_margin",
    "operating_margin",
    "debt_to_equity",
    "return_on_invested_capital",
    "goodwill_and_intangible_assets",
    "operating_expense",
    "owner_earnings",
)
LINE_ITEM_DERIVATION_DEPENDENCIES = {
    "gross_margin": ("gross_profit", "revenue"),
    "operating_margin": ("operating_income", "revenue"),
    "net_margin": ("net_income", "revenue"),
    "debt_to_equity": ("total_debt", "short_term_debt", "long_term_debt", "shareholders_equity"),
    "debt_to_assets": ("total_liabilities", "total_assets"),
    "current_ratio": ("current_assets", "current_liabilities"),
    "return_on_invested_capital": ("operating_income", "total_debt", "shareholders_equity", "cash_and_equivalents"),
    "goodwill_and_intangible_assets": ("goodwill", "intangible_assets"),
    "operating_expense": ("revenue", "operating_income"),
    "owner_earnings": ("net_income", "depreciation_and_amortization", "capital_expenditure"),
    "free_cash_flow": ("operating_cash_flow", "capital_expenditure"),
    "free_cash_flow_per_share": ("free_cash_flow", "operating_cash_flow", "capital_expenditure", "outstanding_shares"),
    "book_value_per_share": ("shareholders_equity", "outstanding_shares"),
    "interest_coverage": ("ebit", "operating_income", "interest_expense"),
}


def _build_financial_metric(raw_payload: dict) -> dict:
    payload = standardize_financial_metric_payload(raw_payload)
    for field_name in DEFAULT_FINANCIAL_METRIC_FIELDS:
        payload.setdefault(field_name, None)
    payload.setdefault("source", raw_payload.get("source") or "Financial Datasets")
    return payload


def _expand_line_items(line_items: list[str]) -> list[str]:
    expanded = list(dict.fromkeys(line_items))
    for field in line_items:
        for dependency in LINE_ITEM_DERIVATION_DEPENDENCIES.get(field, ()):
            if dependency not in expanded:
                expanded.append(dependency)
    return expanded


def _has_usable_line_item_fields(items: list[LineItem], requested_fields: list[str]) -> bool:
    if not items:
        return False
    for item in items:
        for field in requested_fields:
            if getattr(item, field, None) is not None:
                return True
    return False


def _filter_usable_line_items(items: list[LineItem], requested_fields: list[str]) -> list[LineItem]:
    if not items:
        return []
    return [
        item for item in items
        if any(getattr(item, field, None) is not None for field in requested_fields)
    ]


def _make_api_request(url: str, headers: dict, method: str = "GET", json_data: dict = None, max_retries: int = 3) -> requests.Response:
    """
    Make an API request with rate limiting handling and moderate backoff.
    
    Args:
        url: The URL to request
        headers: Headers to include in the request
        method: HTTP method (GET or POST)
        json_data: JSON data for POST requests
        max_retries: Maximum number of retries (default: 3)
    
    Returns:
        requests.Response: The response object
    
    Raises:
        Exception: If the request fails with a non-429 error
    """
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        if method.upper() == "POST":
            response = requests.post(url, headers=headers, json=json_data)
        else:
            response = requests.get(url, headers=headers)
        
        if response.status_code == 429 and attempt < max_retries:
            # Linear backoff: 60s, 90s, 120s, 150s...
            delay = 60 + (30 * attempt)
            print(f"Rate limited (429). Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay}s before retrying...")
            time.sleep(delay)
            continue
        
        # Return the response (whether success, other errors, or final 429)
        return response


def get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    """Fetch price data from cache or API."""
    # Create a cache key that includes all parameters to ensure exact matches
    cache_key = f"{ticker}_{start_date}_{end_date}"
    
    # Check cache first - simple exact match
    if cached_data := _cache.get_prices(cache_key):
        return [Price(**price) for price in cached_data]

    # If not in cache, fetch from API
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = f"https://api.financialdatasets.ai/prices/?ticker={ticker}&interval=day&interval_multiplier=1&start_date={start_date}&end_date={end_date}"
    response = _make_api_request(url, headers)
    prices = []
    if response.status_code == 200:
        try:
            price_response = PriceResponse(**response.json())
            prices = price_response.prices
        except Exception as e:
            logger.warning("Failed to parse price response for %s: %s", ticker, e)

    if not prices and _is_korean_ticker(ticker):
        # Fallback 1 for Korean: pykrx (KRX official - most accurate)
        prices = _fetch_pykrx_prices(ticker, start_date, end_date)

    if not prices and _is_korean_ticker(ticker):
        # Fallback 2 for Korean: FinanceDataReader (KRX + NAVER)
        prices = _fetch_fdr_prices(ticker, start_date, end_date)

    if not prices:
        # Fallback 3: yfinance (works for Korean + US stocks)
        prices = _fetch_yfinance_prices(ticker, start_date, end_date)

    if not prices:
        return []

    # Cache the results using the comprehensive cache key
    _cache.set_prices(cache_key, [p.model_dump() for p in prices])
    return prices


FMP_API_KEY = "WnoeVdSBlKezrKNExH7jtXfEWXg8YrtE"
AV_API_KEY = "QCE8EC5Q5OP74PYD"
FMP_STABLE_BASE = "https://financialmodelingprep.com/stable"


def parse_float_safe(val):
    try:
        if val is None:
            return None
        if isinstance(val, str):
            stripped = val.replace(",", "").strip()
            if stripped in ("", "-", "None", "nan", "NaN"):
                return None
            return float(stripped)
        return float(val)
    except Exception:
        return None


def _is_korean_ticker(ticker: str) -> bool:
    return ticker.endswith(".KS") or ticker.endswith(".KQ")


SEC_USER_AGENT = os.environ.get("SEC_USER_AGENT", "AI Hedge Fund data checker contact@example.com")
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
_SEC_TICKER_CIK_CACHE: dict[str, str] | None = None
_SEC_COMPANYFACTS_CACHE: dict[str, dict] = {}
_SEC_QUARTER_FRAME_RE = re.compile(r"^CY\d{4}Q[1-4]$")

_SEC_FACT_CONCEPTS: dict[str, tuple[str, ...]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
    ),
    "gross_profit": ("GrossProfit",),
    "operating_income": ("OperatingIncomeLoss",),
    "net_income": (
        "NetIncomeLoss",
        "ProfitLoss",
    ),
    "earnings_per_share": ("EarningsPerShareDiluted", "EarningsPerShareBasic"),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
    "capital_expenditure": ("PaymentsToAcquirePropertyPlantAndEquipment",),
    "depreciation_and_amortization": (
        "DepreciationDepletionAndAmortization",
        "DepreciationDepletionAndAmortizationExpense",
        "DepreciationAndAmortization",
    ),
    "interest_expense": ("InterestExpenseNonOperating", "InterestExpense"),
    "total_assets": ("Assets",),
    "total_liabilities": ("Liabilities",),
    "shareholders_equity": (
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ),
    "cash_and_equivalents": (
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ),
    "current_assets": ("AssetsCurrent",),
    "current_liabilities": ("LiabilitiesCurrent",),
    "short_term_debt": (
        "ShortTermBorrowings",
        "ShortTermDebt",
        "LongTermDebtAndFinanceLeaseObligationsCurrent",
        "LongTermDebtCurrent",
    ),
    "long_term_debt": (
        "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
        "LongTermDebtNoncurrent",
        "LongTermDebt",
    ),
    "outstanding_shares": (
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "WeightedAverageNumberOfSharesOutstandingDiluted",
        "EntityCommonStockSharesOutstanding",
    ),
    "goodwill": ("Goodwill",),
    "intangible_assets": ("FiniteLivedIntangibleAssetsNet", "IntangibleAssetsNetExcludingGoodwill"),
}
_SEC_FLOW_FIELDS = {
    "revenue",
    "gross_profit",
    "operating_income",
    "net_income",
    "earnings_per_share",
    "operating_cash_flow",
    "capital_expenditure",
    "depreciation_and_amortization",
    "interest_expense",
}
_SEC_FISCAL_PERIOD_ORDER = {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}
_SEC_UNIT_PREFERENCE: dict[str, tuple[str, ...]] = {
    "earnings_per_share": ("USD/shares", "USD / shares", "USD/share"),
    "outstanding_shares": ("shares",),
}


def _sec_headers() -> dict[str, str]:
    return {"User-Agent": SEC_USER_AGENT, "Accept": "application/json"}


def _resolve_sec_cik(ticker: str) -> str | None:
    global _SEC_TICKER_CIK_CACHE
    symbol = ticker.upper().strip()
    if not symbol or _is_korean_ticker(symbol) or "." in symbol:
        return None
    if symbol.isdigit():
        return symbol.zfill(10)

    if _SEC_TICKER_CIK_CACHE is None:
        try:
            response = requests.get(SEC_TICKERS_URL, headers=_sec_headers(), timeout=10)
            if response.status_code != 200:
                return None
            raw = response.json()
            _SEC_TICKER_CIK_CACHE = {
                str(item.get("ticker", "")).upper(): str(item.get("cik_str", "")).zfill(10)
                for item in (raw.values() if isinstance(raw, dict) else raw)
                if item.get("ticker") and item.get("cik_str")
            }
        except Exception as exc:
            logger.debug("SEC ticker map fetch failed: %s", exc)
            _SEC_TICKER_CIK_CACHE = {}
    return _SEC_TICKER_CIK_CACHE.get(symbol)


def _fetch_sec_companyfacts(ticker: str) -> dict | None:
    cik = _resolve_sec_cik(ticker)
    if not cik:
        return None
    if cik in _SEC_COMPANYFACTS_CACHE:
        return _SEC_COMPANYFACTS_CACHE[cik]
    try:
        response = requests.get(SEC_COMPANYFACTS_URL.format(cik=cik), headers=_sec_headers(), timeout=15)
        if response.status_code != 200:
            return None
        data = response.json()
        _SEC_COMPANYFACTS_CACHE[cik] = data
        return data
    except Exception as exc:
        logger.debug("SEC companyfacts fetch failed for %s: %s", ticker, exc)
        return None


def _sec_fact_candidates(companyfacts: dict, field: str) -> list[dict]:
    us_gaap = (companyfacts.get("facts") or {}).get("us-gaap") or {}
    for concept in _SEC_FACT_CONCEPTS.get(field, ()):
        concept_data = us_gaap.get(concept) or {}
        units = concept_data.get("units") or {}
        unit_names = _SEC_UNIT_PREFERENCE.get(field, ("USD",))
        for unit_name in unit_names:
            if unit_name in units:
                return [dict(fact, _concept=concept) for fact in units.get(unit_name, [])]
        if units:
            first_unit = next(iter(units))
            return [dict(fact, _concept=concept) for fact in units.get(first_unit, [])]
    return []


def _sec_fact_is_eligible(fact: dict, end_date: str) -> bool:
    value = parse_float_safe(fact.get("val"))
    return (
        value is not None
        and fact.get("end")
        and str(fact.get("end"))[:10] <= end_date
        and fact.get("form") in ("10-Q", "10-K", "8-K", "20-F", "40-F")
    )


def _latest_fact_for_end(facts: list[dict], period_end: str, require_quarter_frame: bool) -> dict | None:
    eligible = [
        fact for fact in facts
        if fact.get("end") == period_end
        and (not require_quarter_frame or _SEC_QUARTER_FRAME_RE.match(str(fact.get("frame") or "")))
    ]
    if not eligible:
        return None
    eligible.sort(key=lambda fact: (str(fact.get("filed") or ""), str(fact.get("frame") or "")), reverse=True)
    return eligible[0]


def _sec_latest_instant_value(companyfacts: dict, field: str, end_date: str) -> float | None:
    facts = [
        fact for fact in _sec_fact_candidates(companyfacts, field)
        if _sec_fact_is_eligible(fact, end_date)
    ]
    if not facts:
        return None
    facts.sort(key=lambda fact: (str(fact.get("end") or ""), str(fact.get("filed") or "")), reverse=True)
    return parse_float_safe(facts[0].get("val"))


def _sec_cumulative_quarter_values(companyfacts: dict, field: str, end_date: str) -> dict[str, dict]:
    facts = [
        fact for fact in _sec_fact_candidates(companyfacts, field)
        if _sec_fact_is_eligible(fact, end_date)
        and str(fact.get("fp") or "").upper() in _SEC_FISCAL_PERIOD_ORDER
    ]
    if not facts:
        return {}

    latest_by_period: dict[tuple[int, str, str], dict] = {}
    for fact in facts:
        try:
            fy = int(fact.get("fy"))
        except (TypeError, ValueError):
            continue
        fp = str(fact.get("fp") or "").upper()
        period_end = str(fact.get("end"))[:10]
        key = (fy, fp, period_end)
        current = latest_by_period.get(key)
        fact_is_framed = bool(_SEC_QUARTER_FRAME_RE.match(str(fact.get("frame") or "")))
        current_is_framed = bool(
            _SEC_QUARTER_FRAME_RE.match(str(current.get("frame") or ""))
        ) if current is not None else False
        if (
            current is None
            or (current_is_framed and not fact_is_framed)
            or (
                current_is_framed == fact_is_framed
                and str(fact.get("filed") or "") >= str(current.get("filed") or "")
            )
        ):
            latest_by_period[key] = fact

    by_fy: dict[int, list[dict]] = {}
    for (fy, _fp, _period_end), fact in latest_by_period.items():
        by_fy.setdefault(fy, []).append(fact)

    quarter_values: dict[str, dict] = {}
    for fy, fiscal_facts in by_fy.items():
        fiscal_facts.sort(key=lambda fact: _SEC_FISCAL_PERIOD_ORDER.get(str(fact.get("fp") or "").upper(), 0))
        previous_value: float | None = None
        previous_order = 0
        for fact in fiscal_facts:
            fp = str(fact.get("fp") or "").upper()
            order = _SEC_FISCAL_PERIOD_ORDER.get(fp)
            cumulative_value = parse_float_safe(fact.get("val"))
            if order is None or cumulative_value is None:
                continue
            if order == 1:
                quarter_value = cumulative_value
            elif previous_value is not None and previous_order == order - 1:
                quarter_value = cumulative_value - previous_value
            else:
                previous_value = cumulative_value
                previous_order = order
                continue

            period_end = str(fact.get("end"))[:10]
            quarter_values[period_end] = dict(fact, val=quarter_value, fy=fy, fp=fp)
            previous_value = cumulative_value
            previous_order = order
    return quarter_values


def _extract_sec_quarter_rows(
    ticker: str,
    companyfacts: dict,
    line_items: list[str],
    end_date: str,
    limit: int,
) -> list[dict]:
    fact_map: dict[str, dict[str, dict]] = {}
    for field in _SEC_FLOW_FIELDS:
        if field not in line_items:
            continue
        field_facts = [
            fact for fact in _sec_fact_candidates(companyfacts, field)
            if _sec_fact_is_eligible(fact, end_date)
            and _SEC_QUARTER_FRAME_RE.match(str(fact.get("frame") or ""))
        ]
        by_end: dict[str, dict] = {}
        for fact in sorted(field_facts, key=lambda item: (str(item.get("end") or ""), str(item.get("filed") or ""))):
            by_end[str(fact.get("end"))[:10]] = fact
        for period_end, fact in _sec_cumulative_quarter_values(companyfacts, field, end_date).items():
            by_end.setdefault(period_end, fact)
        fact_map[field] = by_end

    period_ends = sorted(
        {period_end for by_end in fact_map.values() for period_end in by_end.keys()},
        reverse=True,
    )[:limit]

    rows: list[dict] = []
    for period_end in period_ends:
        row = {
            "ticker": ticker,
            "report_period": period_end,
            "period": "quarter",
            "currency": "USD",
            "source": "SEC Companyfacts",
        }
        for field, by_end in fact_map.items():
            fact = by_end.get(period_end)
            if fact is not None:
                row[field] = parse_float_safe(fact.get("val"))

        for field in line_items:
            if field in _SEC_FLOW_FIELDS or field not in _SEC_FACT_CONCEPTS:
                continue
            value = _sec_latest_instant_value(companyfacts, field, period_end)
            if value is not None:
                row[field] = value

        if row.get("short_term_debt") is not None or row.get("long_term_debt") is not None:
            row["total_debt"] = (row.get("short_term_debt") or 0) + (row.get("long_term_debt") or 0)
        rows.append(row)
    return rows


def _extract_sec_line_items_from_companyfacts(
    ticker: str,
    companyfacts: dict,
    line_items: list[str],
    end_date: str,
    period: str,
    limit: int,
) -> list[LineItem]:
    if period == "quarter":
        return standardize_line_items(
            _extract_sec_quarter_rows(ticker, companyfacts, line_items, end_date, limit),
            line_items,
        )

    if period == "ttm":
        quarter_rows = _extract_sec_quarter_rows(ticker, companyfacts, line_items, end_date, max(4, limit * 4))
        if not quarter_rows:
            return []
        latest = quarter_rows[0]
        ttm_row = {
            "ticker": ticker,
            "report_period": latest["report_period"],
            "period": "ttm",
            "currency": "USD",
            "source": "SEC Companyfacts",
        }
        for field in line_items:
            if field in _SEC_FLOW_FIELDS:
                values = [parse_float_safe(row.get(field)) for row in quarter_rows[:4]]
                if values and all(value is not None for value in values):
                    ttm_row[field] = sum(value for value in values if value is not None)
            elif field in _SEC_FACT_CONCEPTS:
                value = _sec_latest_instant_value(companyfacts, field, latest["report_period"])
                if value is not None:
                    ttm_row[field] = value
        if ttm_row.get("short_term_debt") is not None or ttm_row.get("long_term_debt") is not None:
            ttm_row["total_debt"] = (ttm_row.get("short_term_debt") or 0) + (ttm_row.get("long_term_debt") or 0)
        return standardize_line_items([ttm_row], line_items)

    annual_facts: dict[str, dict[str, dict]] = {}
    for field in _SEC_FLOW_FIELDS:
        if field not in line_items:
            continue
        facts = [
            fact for fact in _sec_fact_candidates(companyfacts, field)
            if _sec_fact_is_eligible(fact, end_date)
            and re.match(r"^CY\d{4}$", str(fact.get("frame") or ""))
        ]
        by_end: dict[str, dict] = {}
        for fact in sorted(facts, key=lambda item: (str(item.get("end") or ""), str(item.get("filed") or ""))):
            by_end[str(fact.get("end"))[:10]] = fact
        annual_facts[field] = by_end
    period_ends = sorted({end for by_end in annual_facts.values() for end in by_end}, reverse=True)[:limit]
    rows = []
    for period_end in period_ends:
        row = {
            "ticker": ticker,
            "report_period": period_end,
            "period": "annual",
            "currency": "USD",
            "source": "SEC Companyfacts",
        }
        for field, by_end in annual_facts.items():
            fact = by_end.get(period_end)
            if fact is not None:
                row[field] = parse_float_safe(fact.get("val"))
        for field in line_items:
            if field in _SEC_FLOW_FIELDS or field not in _SEC_FACT_CONCEPTS:
                continue
            value = _sec_latest_instant_value(companyfacts, field, period_end)
            if value is not None:
                row[field] = value
        rows.append(row)
    return standardize_line_items(rows, line_items)


def _fetch_sec_line_items(ticker: str, line_items: list[str], end_date: str, period: str, limit: int) -> list[LineItem]:
    if _is_korean_ticker(ticker):
        return []
    companyfacts = _fetch_sec_companyfacts(ticker)
    if not companyfacts:
        return []
    try:
        return _extract_sec_line_items_from_companyfacts(ticker, companyfacts, line_items, end_date, period, limit)
    except Exception as exc:
        logger.debug("SEC line items extraction failed for %s: %s", ticker, exc)
        return []


def _line_items_newer_than_metrics(
    metrics: dict | None,
    line_items: list[dict] | None,
    end_date: str | None = None,
) -> bool:
    if not metrics or not line_items:
        return False
    line_item_source = str(line_items[0].get("source") or "")
    metric_source = str(metrics.get("source") or "")
    official_sources = {"SEC Companyfacts", "DART"}
    if line_item_source in official_sources and metric_source not in official_sources:
        return True
    metric_date = str(metrics.get("report_period") or "")[:10]
    line_item_date = str(line_items[0].get("report_period") or "")[:10]
    if end_date and metric_date and metric_date > str(end_date)[:10] and line_item_source in official_sources:
        return True
    return bool(metric_date and line_item_date and line_item_date > metric_date)


def _fmp_get(endpoint: str, params: dict) -> list | dict | None:
    """FMP stable endpoint GET helper. Returns parsed JSON or None on failure."""
    try:
        params["apikey"] = FMP_API_KEY
        r = requests.get(f"{FMP_STABLE_BASE}/{endpoint}", params=params, timeout=8)
        if r.status_code == 200:
            data = r.json()
            # FMP returns empty dict {} when no data available
            if isinstance(data, dict) and not data:
                return None
            return data
    except Exception:
        pass
    return None


def _fmp_yoy_growth(curr, prev) -> float | None:
    """YoY growth rate: (curr - prev) / abs(prev). Returns None if data missing."""
    c = parse_float_safe(curr)
    p = parse_float_safe(prev)
    if c is None or p is None or p == 0:
        return None
    return (c - p) / abs(p)


def _fetch_fmp_metrics(ticker: str) -> dict | None:
    """Fetch FinancialMetrics from FMP stable endpoints (US stocks only)."""
    if _is_korean_ticker(ticker):
        return None
    try:
        km = _fmp_get("key-metrics", {"symbol": ticker, "limit": 1})
        rt = _fmp_get("ratios", {"symbol": ticker, "limit": 1})
        # limit=2: 현재 연도 + 전년도 → YoY 성장률 계산 가능
        inc = _fmp_get("income-statement", {"symbol": ticker, "limit": 2}) or []
        bal = _fmp_get("balance-sheet-statement", {"symbol": ticker, "limit": 2}) or []
        cf = _fmp_get("cash-flow-statement", {"symbol": ticker, "limit": 2}) or []
        profile = _fmp_get("profile", {"symbol": ticker}) or []
        if not km and not inc and not bal and not cf:
            return None
        m = km[0] if (km and isinstance(km, list) and km) else {}
        r = rt[0] if (rt and isinstance(rt, list) and rt) else {}
        inc_row  = inc[0] if isinstance(inc, list) and len(inc) > 0 else {}
        inc_prev = inc[1] if isinstance(inc, list) and len(inc) > 1 else {}
        bal_row  = bal[0] if isinstance(bal, list) and len(bal) > 0 else {}
        bal_prev = bal[1] if isinstance(bal, list) and len(bal) > 1 else {}
        cf_row   = cf[0]  if isinstance(cf,  list) and len(cf)  > 0 else {}
        cf_prev  = cf[1]  if isinstance(cf,  list) and len(cf)  > 1 else {}
        profile_row = profile[0] if isinstance(profile, list) and profile else {}
        report_date = m.get("date") or inc_row.get("date") or bal_row.get("date") or "TTM"

        # ── YoY 성장률 계산 ─────────────────────────────────────────────
        rev_growth    = _fmp_yoy_growth(inc_row.get("revenue"),         inc_prev.get("revenue"))
        ni_growth     = _fmp_yoy_growth(inc_row.get("netIncome"),       inc_prev.get("netIncome"))
        oi_growth     = _fmp_yoy_growth(inc_row.get("operatingIncome"), inc_prev.get("operatingIncome"))
        ebitda_growth = _fmp_yoy_growth(inc_row.get("ebitda"),          inc_prev.get("ebitda"))
        fcf_growth    = _fmp_yoy_growth(cf_row.get("freeCashFlow"),     cf_prev.get("freeCashFlow"))
        # BPS 성장: balance sheet equity / shares (current vs prev)
        eq_curr   = parse_float_safe(bal_row.get("totalStockholdersEquity"))
        eq_prev   = parse_float_safe(bal_prev.get("totalStockholdersEquity"))
        sh_curr   = parse_float_safe(inc_row.get("weightedAverageShsOutDil"))
        sh_prev   = parse_float_safe(inc_prev.get("weightedAverageShsOutDil"))
        bvps_curr = (eq_curr / sh_curr) if (eq_curr and sh_curr) else None
        bvps_prev = (eq_prev / sh_prev) if (eq_prev and sh_prev) else None
        bv_growth = _fmp_yoy_growth(bvps_curr, bvps_prev)
        # EPS 성장: NI / shares (current vs prev)
        eps_curr     = parse_float_safe(r.get("netIncomePerShare"))
        ni_prev_val  = parse_float_safe(inc_prev.get("netIncome"))
        eps_prev_val = (ni_prev_val / sh_prev) if (ni_prev_val is not None and sh_prev) else None
        eps_growth   = _fmp_yoy_growth(eps_curr, eps_prev_val)

        return {
            "ticker": ticker,
            "source": "FMP",
            "report_period": report_date,
            "period": "ttm",
            "currency": m.get("reportedCurrency") or inc_row.get("reportedCurrency") or "USD",
            "market_cap": parse_float_safe(m.get("marketCap")),
            "enterprise_value": parse_float_safe(m.get("enterpriseValue")),
            "price_to_earnings_ratio": parse_float_safe(r.get("priceToEarningsRatio")),
            "price_to_book_ratio": parse_float_safe(r.get("priceToBookRatio")),
            "price_to_sales_ratio": parse_float_safe(r.get("priceToSalesRatio")),
            "enterprise_value_to_ebitda_ratio": parse_float_safe(m.get("evToEBITDA")),
            "enterprise_value_to_revenue_ratio": parse_float_safe(m.get("evToSales")),
            "free_cash_flow_yield": parse_float_safe(m.get("freeCashFlowYield")),
            "peg_ratio": parse_float_safe(r.get("priceToEarningsGrowthRatio")),
            "gross_margin": parse_float_safe(r.get("grossProfitMargin")),
            "operating_margin": parse_float_safe(r.get("operatingProfitMargin")),
            "net_margin": parse_float_safe(r.get("netProfitMargin")),
            "return_on_equity": parse_float_safe(m.get("returnOnEquity")),
            "return_on_assets": parse_float_safe(m.get("returnOnAssets")),
            "return_on_invested_capital": parse_float_safe(m.get("returnOnInvestedCapital")),
            "asset_turnover": parse_float_safe(r.get("assetTurnover")),
            "inventory_turnover": parse_float_safe(r.get("inventoryTurnover")),
            "receivables_turnover": parse_float_safe(r.get("receivablesTurnover")),
            "current_ratio": parse_float_safe(r.get("currentRatio")),
            "quick_ratio": parse_float_safe(r.get("quickRatio")),
            "cash_ratio": parse_float_safe(r.get("cashRatio")),
            "operating_cash_flow_ratio": parse_float_safe(r.get("operatingCashFlowRatio")),
            "debt_to_equity": parse_float_safe(r.get("debtToEquityRatio")),
            "debt_to_assets": parse_float_safe(r.get("debtToAssetsRatio")),
            "interest_coverage": parse_float_safe(r.get("interestCoverageRatio")),
            "payout_ratio": parse_float_safe(r.get("dividendPayoutRatio")),
            "earnings_per_share": parse_float_safe(r.get("netIncomePerShare")),
            "book_value_per_share": parse_float_safe(r.get("bookValuePerShare")),
            "free_cash_flow_per_share": parse_float_safe(r.get("freeCashFlowPerShare")),
            # ── 성장률 (YoY) ──────────────────────────────────────────
            "revenue_growth": rev_growth,
            "earnings_growth": ni_growth,
            "operating_income_growth": oi_growth,
            "ebitda_growth": ebitda_growth,
            "free_cash_flow_growth": fcf_growth,
            "book_value_growth": bv_growth,
            "earnings_per_share_growth": eps_growth,
            # ── 손익계산서 ────────────────────────────────────────────
            "revenue": parse_float_safe(inc_row.get("revenue")),
            "gross_profit": parse_float_safe(inc_row.get("grossProfit")),
            "operating_income": parse_float_safe(inc_row.get("operatingIncome")),
            "net_income": parse_float_safe(inc_row.get("netIncome")),
            "ebit": parse_float_safe(inc_row.get("ebit")),
            "ebitda": parse_float_safe(inc_row.get("ebitda")),
            "interest_expense": parse_float_safe(inc_row.get("interestExpense")),
            "total_debt": parse_float_safe(bal_row.get("totalDebt")),
            "cash_and_equivalents": parse_float_safe(bal_row.get("cashAndCashEquivalents")),
            "outstanding_shares": parse_float_safe(inc_row.get("weightedAverageShsOutDil")),
            "operating_cash_flow": parse_float_safe(cf_row.get("operatingCashFlow")),
            "capital_expenditure": parse_float_safe(cf_row.get("capitalExpenditure")),
            "free_cash_flow": parse_float_safe(cf_row.get("freeCashFlow")),
            "depreciation_and_amortization": parse_float_safe(inc_row.get("depreciationAndAmortization") or cf_row.get("depreciationAndAmortization")),
            "total_assets": parse_float_safe(bal_row.get("totalAssets")),
            "total_liabilities": parse_float_safe(bal_row.get("totalLiabilities")),
            "shareholders_equity": parse_float_safe(bal_row.get("totalStockholdersEquity")),
            "current_assets": parse_float_safe(bal_row.get("totalCurrentAssets")),
            "current_liabilities": parse_float_safe(bal_row.get("totalCurrentLiabilities")),
            "beta": parse_float_safe(profile_row.get("beta")),
        }
    except Exception as e:
        logger.debug("FMP metrics fetch failed for %s: %s", ticker, e)
    return None


def _fetch_yfinance_metrics(ticker: str) -> dict | None:
    """Fetch FinancialMetrics from yfinance (works for Korean + US stocks)."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.info
        if not info or info.get("regularMarketPrice") is None and info.get("marketCap") is None:
            return None
        market_cap = parse_float_safe(info.get("marketCap"))
        rev = parse_float_safe(info.get("totalRevenue"))
        gp = parse_float_safe(info.get("grossProfits"))
        ni = parse_float_safe(info.get("netIncomeToCommon"))
        op_inc = parse_float_safe(info.get("operatingIncome") or info.get("ebit"))
        ebitda = parse_float_safe(info.get("ebitda"))
        total_debt = parse_float_safe(info.get("totalDebt"))
        bvps = parse_float_safe(info.get("bookValue"))
        shares = parse_float_safe(info.get("sharesOutstanding"))
        total_equity = bvps * shares if bvps is not None and shares is not None else None
        currency = info.get("currency", "USD")
        report_date = info.get("mostRecentQuarter") or "TTM"
        if isinstance(report_date, (int, float)):
            import datetime
            report_date = datetime.datetime.fromtimestamp(report_date).strftime("%Y-%m-%d")

        fcf = parse_float_safe(info.get("freeCashflow"))
        price = parse_float_safe(info.get("regularMarketPrice") or info.get("currentPrice"))

        return {
            "ticker": ticker,
            "source": "Yahoo Finance",
            "report_period": str(report_date),
            "period": "ttm",
            "currency": currency,
            "market_cap": market_cap,
            "enterprise_value": parse_float_safe(info.get("enterpriseValue")),
            "price_to_earnings_ratio": parse_float_safe(info.get("trailingPE")),
            "price_to_book_ratio": parse_float_safe(info.get("priceToBook")),
            "price_to_sales_ratio": parse_float_safe(info.get("priceToSalesTrailing12Months")),
            "enterprise_value_to_ebitda_ratio": parse_float_safe(info.get("enterpriseToEbitda")),
            "enterprise_value_to_revenue_ratio": parse_float_safe(info.get("enterpriseToRevenue")),
            "peg_ratio": parse_float_safe(info.get("pegRatio")),
            "gross_margin": parse_float_safe(info.get("grossMargins")),
            "operating_margin": parse_float_safe(info.get("operatingMargins")),
            "net_margin": parse_float_safe(info.get("profitMargins")),
            "return_on_equity": parse_float_safe(info.get("returnOnEquity")),
            "return_on_assets": parse_float_safe(info.get("returnOnAssets")),
            "return_on_invested_capital": None,
            "current_ratio": parse_float_safe(info.get("currentRatio")),
            "quick_ratio": parse_float_safe(info.get("quickRatio")),
            "debt_to_equity": (total_debt / total_equity) if (total_debt and total_equity) else None,
            "revenue_growth": parse_float_safe(info.get("revenueGrowth")),
            "earnings_growth": parse_float_safe(info.get("earningsGrowth")),
            "earnings_per_share": parse_float_safe(info.get("trailingEps")),
            "book_value_per_share": bvps,
            "free_cash_flow_per_share": (fcf / shares) if (fcf and shares) else None,
            "payout_ratio": parse_float_safe(info.get("payoutRatio")),
            "revenue": rev,
            "gross_profit": gp,
            "operating_income": op_inc,
            "net_income": ni,
            "free_cash_flow": fcf,
            "operating_cash_flow": parse_float_safe(info.get("operatingCashflow")),
            "capital_expenditure": None,
            "depreciation_and_amortization": None,
            "ebit": parse_float_safe(info.get("ebit")),
            "ebitda": ebitda,
            "interest_expense": None,
            "total_debt": total_debt,
            "cash_and_equivalents": parse_float_safe(info.get("totalCash")),
            "outstanding_shares": shares,
            "shareholders_equity": total_equity,
            "beta": parse_float_safe(info.get("beta")),
        }
    except Exception as e:
        logger.debug("yfinance metrics fetch failed for %s: %s", ticker, e)
    return None


# ─── Line Item field mapping ──────────────────────────────────────────────────
# Maps our internal LineItem field name → FMP income-statement field name
_INCOME_MAP = {
    "revenue": "revenue",
    "gross_profit": "grossProfit",
    "net_income": "netIncome",
    "operating_income": "operatingIncome",
    "operating_expense": "operatingExpenses",
    "ebitda": "ebitda",
    "ebit": "ebit",
    "interest_expense": "interestExpense",
    "depreciation_and_amortization": "depreciationAndAmortization",
    "earnings_per_share": "epsDiluted",
    "outstanding_shares": "weightedAverageShsOutDil",
    "research_and_development": "researchAndDevelopmentExpenses",
}
_BALANCE_MAP = {
    "total_assets": "totalAssets",
    "total_liabilities": "totalLiabilities",
    "shareholders_equity": "totalStockholdersEquity",
    "total_debt": "totalDebt",
    "short_term_debt": "shortTermDebt",
    "long_term_debt": "longTermDebt",
    "cash_and_equivalents": "cashAndCashEquivalents",
    "current_assets": "totalCurrentAssets",
    "current_liabilities": "totalCurrentLiabilities",
    "inventory": "inventory",
    "goodwill": "goodwill",
    "intangible_assets": "intangibleAssets",
    "goodwill_and_intangible_assets": None,  # computed from goodwill + intangible_assets
    "retained_earnings": "retainedEarnings",
    "book_value_per_share": None,  # computed below
    "working_capital": None,       # computed below
}
_CASHFLOW_MAP = {
    "capital_expenditure": "capitalExpenditure",
    "free_cash_flow": "freeCashFlow",
    "operating_cash_flow": "operatingCashFlow",
    "dividends_and_other_cash_distributions": "netDividendsPaid",
    "issuance_or_purchase_of_equity_shares": "netStockIssuance",
    "stock_based_compensation": "stockBasedCompensation",
}

# yfinance income_stmt / balance_sheet / cashflow row label mapping
_YF_INCOME_MAP = {
    "revenue": ["Total Revenue"],
    "gross_profit": ["Gross Profit"],
    "net_income": ["Net Income", "Net Income From Continuing And Discontinued Operation"],
    "operating_income": ["Operating Income", "Total Operating Income As Reported"],
    "operating_expense": ["Operating Expense", "Total Expenses", "Selling General And Administration"],
    "ebitda": ["EBITDA", "Normalized EBITDA"],
    "ebit": ["EBIT"],
    "interest_expense": ["Interest Expense"],
    "depreciation_and_amortization": ["Reconciled Depreciation"],
    "earnings_per_share": ["Diluted EPS", "Basic EPS"],
    "outstanding_shares": ["Diluted Average Shares", "Basic Average Shares"],
}
_YF_BALANCE_MAP = {
    "total_assets": ["Total Assets"],
    "total_liabilities": ["Total Liabilities Net Minority Interest", "Total Liabilities"],
    "shareholders_equity": ["Stockholders Equity", "Total Equity Gross Minority Interest"],
    "total_debt": ["Total Debt"],
    "short_term_debt": ["Current Debt", "Current Debt And Capital Lease Obligation"],
    "long_term_debt": ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"],
    "cash_and_equivalents": ["Cash And Cash Equivalents"],
    "current_assets": ["Current Assets"],
    "current_liabilities": ["Current Liabilities"],
    "inventory": ["Inventory"],
    "goodwill": ["Goodwill"],
    "intangible_assets": ["Intangible Assets"],
    "goodwill_and_intangible_assets": ["Goodwill And Other Intangible Assets", "Goodwill And Intangible Assets"],
    "retained_earnings": ["Retained Earnings"],
}
_YF_CASHFLOW_MAP = {
    "capital_expenditure": ["Capital Expenditure"],
    "free_cash_flow": ["Free Cash Flow"],
    "operating_cash_flow": ["Operating Cash Flow"],
    "dividends_and_other_cash_distributions": ["Common Dividends Paid", "Dividends Paid"],
    "issuance_or_purchase_of_equity_shares": ["Net Common Stock Issuance", "Repurchase Of Capital Stock"],
    "stock_based_compensation": ["Stock Based Compensation"],
}


def _df_get(df, keys: list):
    """Extract first matching row value from a DataFrame indexed by row labels."""
    if df is None or df.empty:
        return None
    for key in keys:
        for idx in df.index:
            if str(idx).strip() == key:
                vals = df.loc[idx].dropna()
                return float(vals.iloc[0]) if not vals.empty else None
    return None


def _fetch_fmp_line_items(ticker: str, line_items: list[str], end_date: str, period: str, limit: int) -> list[LineItem]:
    """Fetch line items from FMP stable financial statements (US stocks only)."""
    if _is_korean_ticker(ticker):
        return []
    try:
        fmp_period = "quarter" if period in ("ttm", "quarter") else "annual"
        fetch_limit = max(limit * 4, 8) if period == "ttm" else limit

        inc_data = _fmp_get("income-statement", {"symbol": ticker, "limit": fetch_limit, "period": fmp_period}) or []
        bal_data = _fmp_get("balance-sheet-statement", {"symbol": ticker, "limit": fetch_limit, "period": fmp_period}) or []
        cf_data = _fmp_get("cash-flow-statement", {"symbol": ticker, "limit": fetch_limit, "period": fmp_period}) or []

        if not inc_data and not bal_data and not cf_data:
            return []

        # For TTM: group by annual batches (sum flow items for 4Q, take latest balance)
        # For annual: one record per year
        if period == "ttm":
            # Aggregate last 4 quarters into one TTM record
            results = []
            quarters_to_use = min(4, len(inc_data))
            if quarters_to_use == 0:
                return []
            latest_inc = inc_data[0] if inc_data else {}
            latest_bal = bal_data[0] if bal_data else {}
            latest_cf = cf_data[0] if cf_data else {}
            report_date = latest_inc.get("date") or latest_bal.get("date") or end_date
            currency = latest_inc.get("reportedCurrency") or latest_bal.get("reportedCurrency") or "USD"

            # Sum flow items across quarters
            inc_ttm = {}
            for q in inc_data[:quarters_to_use]:
                for fld in _INCOME_MAP.values():
                    if fld and fld in q and q[fld] is not None:
                        inc_ttm[fld] = inc_ttm.get(fld, 0) + (q[fld] or 0)
            cf_ttm = {}
            for q in cf_data[:quarters_to_use]:
                for fld in _CASHFLOW_MAP.values():
                    if fld and fld in q and q[fld] is not None:
                        cf_ttm[fld] = cf_ttm.get(fld, 0) + (q[fld] or 0)

            row = {"ticker": ticker, "report_period": report_date, "period": "ttm", "currency": currency}
            for our_field, fmp_field in _INCOME_MAP.items():
                if our_field in line_items and fmp_field:
                    row[our_field] = inc_ttm.get(fmp_field)
            for our_field, fmp_field in _BALANCE_MAP.items():
                if our_field in line_items and fmp_field and fmp_field in latest_bal:
                    row[our_field] = parse_float_safe(latest_bal[fmp_field])
            for our_field, fmp_field in _CASHFLOW_MAP.items():
                if our_field in line_items and fmp_field:
                    row[our_field] = cf_ttm.get(fmp_field)
            # Computed fields
            if "working_capital" in line_items:
                ca = parse_float_safe(latest_bal.get("totalCurrentAssets"))
                cl = parse_float_safe(latest_bal.get("totalCurrentLiabilities"))
                row["working_capital"] = (ca - cl) if (ca is not None and cl is not None) else None
            if "book_value_per_share" in line_items:
                eq = parse_float_safe(latest_bal.get("totalStockholdersEquity"))
                sh = inc_ttm.get("weightedAverageShsOutDil")
                row["book_value_per_share"] = (eq / sh) if (eq and sh) else None
            results.append(LineItem(**row))
            return results
        else:
            # Annual: one LineItem per annual period
            results = []
            max_periods = min(limit, len(inc_data), max(len(bal_data), 1), max(len(cf_data), 1))
            max_periods = min(limit, max(len(inc_data), len(bal_data), len(cf_data)))
            for i in range(min(limit, max(len(inc_data), len(bal_data)))):
                inc_row = inc_data[i] if i < len(inc_data) else {}
                bal_row = bal_data[i] if i < len(bal_data) else {}
                cf_row = cf_data[i] if i < len(cf_data) else {}
                report_date = inc_row.get("date") or bal_row.get("date") or end_date
                if report_date > end_date:
                    continue
                currency = inc_row.get("reportedCurrency") or bal_row.get("reportedCurrency") or "USD"
                row = {"ticker": ticker, "report_period": report_date, "period": "annual", "currency": currency}
                for our_field, fmp_field in _INCOME_MAP.items():
                    if our_field in line_items and fmp_field and fmp_field in inc_row:
                        row[our_field] = parse_float_safe(inc_row[fmp_field])
                for our_field, fmp_field in _BALANCE_MAP.items():
                    if our_field in line_items and fmp_field and fmp_field in bal_row:
                        row[our_field] = parse_float_safe(bal_row[fmp_field])
                for our_field, fmp_field in _CASHFLOW_MAP.items():
                    if our_field in line_items and fmp_field and fmp_field in cf_row:
                        row[our_field] = parse_float_safe(cf_row[fmp_field])
                if "working_capital" in line_items:
                    ca = parse_float_safe(bal_row.get("totalCurrentAssets"))
                    cl = parse_float_safe(bal_row.get("totalCurrentLiabilities"))
                    row["working_capital"] = (ca - cl) if (ca is not None and cl is not None) else None
                if "book_value_per_share" in line_items:
                    eq = parse_float_safe(bal_row.get("totalStockholdersEquity"))
                    sh = parse_float_safe(inc_row.get("weightedAverageShsOutDil"))
                    row["book_value_per_share"] = (eq / sh) if (eq and sh) else None
                results.append(LineItem(**row))
            return results
    except Exception as e:
        logger.warning("FMP line items fetch failed for %s: %s", ticker, e)
    return []


def _fetch_yfinance_line_items(ticker: str, line_items: list[str], end_date: str, period: str, limit: int) -> list[LineItem]:
    """Fetch line items from yfinance (works for Korean + US stocks)."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        # Use annual or quarterly statements
        if period in ("ttm", "quarter"):
            inc_df = t.quarterly_income_stmt
            bal_df = t.quarterly_balance_sheet
            cf_df = t.quarterly_cashflow
            target_period = period
        else:
            inc_df = t.income_stmt
            bal_df = t.balance_sheet
            cf_df = t.cashflow
            target_period = "annual"

        if inc_df is None and bal_df is None and cf_df is None:
            return []

        # For TTM: sum last 4 quarters of flow statements, take latest balance
        if period == "ttm":
            results = []
            # Sum last 4 quarters for flow items
            def _sum_quarters(df, row_keys, n=4):
                if df is None or df.empty:
                    return None
                for key in row_keys:
                    for idx in df.index:
                        if str(idx).strip() == key:
                            vals = df.loc[idx].dropna().head(n)
                            if not vals.empty:
                                return float(vals.sum())
                return None

            currency = t.info.get("currency", "USD") if t.info else "USD"
            # Get date of latest period
            latest_date = end_date
            if inc_df is not None and not inc_df.empty:
                col0 = inc_df.columns[0]
                latest_date = str(col0)[:10] if hasattr(col0, '__str__') else end_date

            row = {"ticker": ticker, "report_period": latest_date, "period": "ttm", "currency": currency}
            for our_field, yf_keys in _YF_INCOME_MAP.items():
                if our_field in line_items:
                    row[our_field] = _sum_quarters(inc_df, yf_keys, 4)
            for our_field, yf_keys in _YF_BALANCE_MAP.items():
                if our_field in line_items:
                    row[our_field] = _df_get(bal_df, yf_keys) if bal_df is not None else None
            for our_field, yf_keys in _YF_CASHFLOW_MAP.items():
                if our_field in line_items:
                    row[our_field] = _sum_quarters(cf_df, yf_keys, 4)
            if "working_capital" in line_items:
                ca = _df_get(bal_df, ["Current Assets"]) if bal_df is not None else None
                cl = _df_get(bal_df, ["Current Liabilities"]) if bal_df is not None else None
                row["working_capital"] = (ca - cl) if (ca is not None and cl is not None) else None
            if "book_value_per_share" in line_items:
                eq = _df_get(bal_df, ["Stockholders Equity", "Total Equity Gross Minority Interest"]) if bal_df is not None else None
                sh = _sum_quarters(inc_df, ["Diluted Average Shares", "Basic Average Shares"], 1)
                row["book_value_per_share"] = (eq / sh) if (eq and sh) else None
            results.append(LineItem(**row))
            return results
        else:
            # Quarter or Annual: one LineItem per column
            results = []
            cols = []
            if inc_df is not None and not inc_df.empty:
                cols = [c for c in inc_df.columns if str(c)[:10] <= end_date]
            elif bal_df is not None and not bal_df.empty:
                cols = [c for c in bal_df.columns if str(c)[:10] <= end_date]
            cols = cols[:limit]
            if not cols:
                return []
            currency = t.info.get("currency", "USD") if t.info else "USD"
            for col in cols:
                col_str = str(col)[:10]
                row = {"ticker": ticker, "report_period": col_str, "period": "annual", "currency": currency}
                for our_field, yf_keys in _YF_INCOME_MAP.items():
                    if our_field in line_items and inc_df is not None and not inc_df.empty:
                        for key in yf_keys:
                            for idx in inc_df.index:
                                if str(idx).strip() == key and col in inc_df.columns:
                                    val = inc_df.loc[idx, col]
                                    if val is not None and str(val) != "nan":
                                        row[our_field] = float(val)
                                    break
                for our_field, yf_keys in _YF_BALANCE_MAP.items():
                    if our_field in line_items and bal_df is not None and not bal_df.empty:
                        for key in yf_keys:
                            for idx in bal_df.index:
                                if str(idx).strip() == key and col in bal_df.columns:
                                    val = bal_df.loc[idx, col]
                                    if val is not None and str(val) != "nan":
                                        row[our_field] = float(val)
                                    break
                for our_field, yf_keys in _YF_CASHFLOW_MAP.items():
                    if our_field in line_items and cf_df is not None and not cf_df.empty:
                        for key in yf_keys:
                            for idx in cf_df.index:
                                if str(idx).strip() == key and col in cf_df.columns:
                                    val = cf_df.loc[idx, col]
                                    if val is not None and str(val) != "nan":
                                        row[our_field] = float(val)
                                    break
                if "working_capital" in line_items:
                    ca = row.get("current_assets")
                    cl = row.get("current_liabilities")
                    row["working_capital"] = (ca - cl) if (ca is not None and cl is not None) else None
                if "book_value_per_share" in line_items:
                    eq = row.get("shareholders_equity")
                    sh = row.get("outstanding_shares")
                    row["book_value_per_share"] = (eq / sh) if (eq and sh) else None
                results.append(LineItem(**row))
            return results
    except Exception as e:
        logger.warning("yfinance line items fetch failed for %s: %s", ticker, e)
    return []


def _fetch_yfinance_prices(ticker: str, start_date: str, end_date: str) -> list[Price]:
    """Fetch price data from yfinance."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        df = t.history(start=start_date, end=end_date, auto_adjust=True)
        if df is None or df.empty:
            return []
        prices = []
        for ts, row in df.iterrows():
            time_str = ts.strftime("%Y-%m-%dT00:00:00") if hasattr(ts, "strftime") else str(ts)[:10] + "T00:00:00"
            prices.append(Price(
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=int(row["Volume"]),
                time=time_str,
            ))
        return prices
    except Exception as e:
        logger.warning("yfinance prices fetch failed for %s: %s", ticker, e)
    return []

def _fetch_pykrx_prices(ticker: str, start_date: str, end_date: str) -> list[Price]:
    """Fetch Korean stock price data from pykrx (KRX official). Most accurate for KR."""
    if not _is_korean_ticker(ticker):
        return []
    try:
        from pykrx import stock
        code = ticker.split(".")[0]
        # pykrx date format: YYYYMMDD
        start = start_date.replace("-", "")
        end = end_date.replace("-", "")
        df = stock.get_market_ohlcv(start, end, code)
        if df is None or df.empty:
            return []
        prices = []
        for ts, row in df.iterrows():
            time_str = ts.strftime("%Y-%m-%dT00:00:00") if hasattr(ts, "strftime") else str(ts)[:10] + "T00:00:00"
            prices.append(Price(
                open=float(row.get("시가", row.get("Open", 0))),
                high=float(row.get("고가", row.get("High", 0))),
                low=float(row.get("저가", row.get("Low", 0))),
                close=float(row.get("종가", row.get("Close", 0))),
                volume=int(row.get("거래량", row.get("Volume", 0))),
                time=time_str,
            ))
        return prices
    except Exception as e:
        logger.debug("pykrx prices fetch failed for %s: %s", ticker, e)
    return []


def _fetch_fdr_prices(ticker: str, start_date: str, end_date: str) -> list[Price]:
    """Fetch Korean stock price data from FinanceDataReader (KRX+NAVER)."""
    if not _is_korean_ticker(ticker):
        return []
    try:
        import FinanceDataReader as fdr
        code = ticker.split(".")[0]
        df = fdr.DataReader(code, start_date, end_date)
        if df is None or df.empty:
            return []
        prices = []
        for ts, row in df.iterrows():
            time_str = ts.strftime("%Y-%m-%dT00:00:00") if hasattr(ts, "strftime") else str(ts)[:10] + "T00:00:00"
            prices.append(Price(
                open=float(row.get("Open", row.get("open", 0))),
                high=float(row.get("High", row.get("high", 0))),
                low=float(row.get("Low", row.get("low", 0))),
                close=float(row.get("Close", row.get("close", 0))),
                volume=int(row.get("Volume", row.get("volume", 0))),
                time=time_str,
            ))
        return prices
    except Exception as e:
        logger.debug("FinanceDataReader prices fetch failed for %s: %s", ticker, e)
    return []


def _fetch_alphavantage_metrics(ticker: str) -> dict | None:
    av_key = "QCE8EC5Q5OP74PYD"
    try:
        url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={ticker}&apikey={av_key}"
        r = requests.get(url)
        if r.status_code == 200:
            data = r.json()
            if data and "MarketCapitalization" in data and "Information" not in data:
                rev = parse_float_safe(data.get("RevenueTTM"))
                gp = parse_float_safe(data.get("GrossProfitTTM"))
                market_cap = parse_float_safe(data.get("MarketCapitalization"))
                ebitda = parse_float_safe(data.get("EBITDA"))
                
                return {
                    "ticker": ticker,
                    "source": "Alpha Vantage",
                    "report_period": data.get("LatestQuarter", "TTM"),
                    "period": "ttm",
                    "currency": data.get("Currency", "USD"),
                    "market_cap": market_cap,
                    "enterprise_value": None,
                    "price_to_earnings_ratio": parse_float_safe(data.get("PERatio")),
                    "price_to_book_ratio": parse_float_safe(data.get("PriceToBookRatio")),
                    "price_to_sales_ratio": parse_float_safe(data.get("PriceToSalesRatioTTM")),
                    "enterprise_value_to_ebitda_ratio": parse_float_safe(data.get("EVToEBITDA")),
                    "enterprise_value_to_revenue_ratio": parse_float_safe(data.get("EVToRevenue")),
                    "peg_ratio": parse_float_safe(data.get("PEGRatio")),
                    "gross_margin": (gp / rev) if (gp is not None and rev) else None,
                    "operating_margin": parse_float_safe(data.get("OperatingMarginTTM")),
                    "net_margin": parse_float_safe(data.get("ProfitMargin")),
                    "return_on_equity": parse_float_safe(data.get("ReturnOnEquityTTM")),
                    "return_on_assets": parse_float_safe(data.get("ReturnOnAssetsTTM")),
                    "return_on_invested_capital": parse_float_safe(data.get("ReturnOnEquityTTM")),
                    "revenue_growth": parse_float_safe(data.get("QuarterlyRevenueGrowthYOY")),
                    "earnings_growth": parse_float_safe(data.get("QuarterlyEarningsGrowthYOY")),
                    "earnings_per_share": parse_float_safe(data.get("EPS")),
                    "book_value_per_share": parse_float_safe(data.get("BookValue")),
                    "revenue": rev,
                    "gross_profit": gp,
                    "net_income": parse_float_safe(data.get("NetIncomeTTM")),
                    "ebitda": ebitda,
                    "beta": parse_float_safe(data.get("Beta")),
                }
    except Exception as e:
        pass
    return None


def _valid_pbr_point(period: Any, pbr: Any, bvps: Any, source: str) -> PbrHistoryPoint | None:
    pbr_value = parse_float_safe(pbr)
    if pbr_value is None or pbr_value <= 0:
        return None
    bvps_value = parse_float_safe(bvps)
    return PbrHistoryPoint(
        period=str(period or ""),
        price_to_book_ratio=pbr_value,
        book_value_per_share=bvps_value if bvps_value and bvps_value > 0 else None,
        source=source,
    )


def _dedupe_pbr_points(points: list[PbrHistoryPoint], limit: int) -> list[PbrHistoryPoint]:
    seen: set[str] = set()
    out: list[PbrHistoryPoint] = []
    for point in points:
        period = point.period[:10] if point.period else f"unknown-{len(out)}"
        if period in seen:
            continue
        seen.add(period)
        out.append(point)
    out.sort(key=lambda point: point.period, reverse=True)
    return out[:limit]


def _financialdatasets_pbr_history(
    ticker: str,
    end_date: str,
    limit: int,
    api_key: str | None,
) -> list[PbrHistoryPoint]:
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = (
        "https://api.financialdatasets.ai/financial-metrics/"
        f"?ticker={ticker}&report_period_lte={end_date}&limit={limit}&period=annual"
    )
    try:
        response = _make_api_request(url, headers)
        if response.status_code != 200:
            return []
        raw_response = response.json()
        raw_metrics = raw_response.get("financial_metrics", []) if isinstance(raw_response, dict) else []
    except Exception as exc:
        logger.debug("financialdatasets PBR history failed for %s: %s", ticker, exc)
        return []

    points: list[PbrHistoryPoint] = []
    for row in raw_metrics:
        if not isinstance(row, dict):
            continue
        metric = _build_financial_metric(row)
        point = _valid_pbr_point(
            metric.get("report_period"),
            metric.get("price_to_book_ratio"),
            metric.get("book_value_per_share"),
            "financialdatasets",
        )
        if point:
            points.append(point)
    return _dedupe_pbr_points(points, limit)


def _fetch_fmp_pbr_history(ticker: str, limit: int) -> list[PbrHistoryPoint]:
    if _is_korean_ticker(ticker):
        return []

    def _rows(period: str, row_limit: int) -> list[dict]:
        data = _fmp_get("key-metrics", {"symbol": ticker, "period": period, "limit": row_limit}) or []
        return data if isinstance(data, list) else []

    points: list[PbrHistoryPoint] = []
    for row in _rows("annual", limit):
        if not isinstance(row, dict):
            continue
        point = _valid_pbr_point(
            row.get("date") or row.get("calendarYear"),
            row.get("pbRatio") or row.get("priceToBookRatio") or row.get("priceToBookValueRatio"),
            row.get("bookValuePerShare"),
            "fmp",
        )
        if point:
            points.append(point)

    points = _dedupe_pbr_points(points, limit)
    if len(points) >= 4:
        return points

    for row in _rows("quarter", max(limit * 4, 12)):
        if not isinstance(row, dict):
            continue
        point = _valid_pbr_point(
            row.get("date") or row.get("calendarYear"),
            row.get("pbRatio") or row.get("priceToBookRatio") or row.get("priceToBookValueRatio"),
            row.get("bookValuePerShare"),
            "fmp",
        )
        if point:
            points.append(point)
    return _dedupe_pbr_points(points, limit)


def _timestamp(value: Any) -> pd.Timestamp | None:
    try:
        ts = pd.Timestamp(value)
        if pd.isna(ts):
            return None
        if ts.tzinfo is not None:
            ts = ts.tz_convert(None)
        return ts.normalize()
    except Exception:
        return None


def _df_row_values(df: pd.DataFrame | None, labels: list[str]):
    if df is None or df.empty:
        return None
    normalized = {str(idx).strip().lower(): idx for idx in df.index}
    for label in labels:
        idx = normalized.get(label.lower())
        if idx is not None:
            return df.loc[idx]
    return None


def _close_on_or_before(history: pd.DataFrame, period: pd.Timestamp) -> float | None:
    if history is None or history.empty or "Close" not in history.columns:
        return None
    closes = history[["Close"]].dropna().copy()
    if closes.empty:
        return None
    closes.index = pd.to_datetime(closes.index).tz_localize(None).normalize()
    closes.sort_index(inplace=True)
    eligible = closes[closes.index <= period]
    if eligible.empty:
        eligible = closes[closes.index >= period]
    if eligible.empty:
        return None
    return parse_float_safe(eligible.iloc[-1]["Close"])


def _fetch_yfinance_pbr_series(ticker: str, end_date: str, limit: int) -> list[PbrHistoryPoint]:
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        balance_sheet = getattr(t, "quarterly_balance_sheet", None)
        if balance_sheet is None or balance_sheet.empty:
            balance_sheet = getattr(t, "balance_sheet", None)
        if balance_sheet is None or balance_sheet.empty:
            return []

        info = getattr(t, "info", None) or {}
        fallback_shares = parse_float_safe(info.get("sharesOutstanding"))
        price_history = t.history(period="5y", interval="1mo", auto_adjust=False)
    except Exception as exc:
        logger.debug("yfinance PBR history failed for %s: %s", ticker, exc)
        return []

    equity_row = _df_row_values(balance_sheet, ["Stockholders Equity", "Total Equity Gross Minority Interest"])
    shares_row = _df_row_values(balance_sheet, ["Ordinary Shares Number", "Share Issued", "Common Stock Shares Outstanding"])
    if equity_row is None:
        return []

    end_ts = _timestamp(end_date)
    points: list[PbrHistoryPoint] = []
    for col in balance_sheet.columns:
        period_ts = _timestamp(col)
        if period_ts is None or (end_ts is not None and period_ts > end_ts):
            continue
        equity = parse_float_safe(equity_row.get(col))
        shares = parse_float_safe(shares_row.get(col)) if shares_row is not None else fallback_shares
        if equity is None or equity <= 0 or shares is None or shares <= 0:
            continue
        bvps = equity / shares
        close = _close_on_or_before(price_history, period_ts)
        if close is None or close <= 0 or bvps <= 0:
            continue
        point = _valid_pbr_point(period_ts.strftime("%Y-%m-%d"), close / bvps, bvps, "yfinance")
        if point:
            points.append(point)
    return _dedupe_pbr_points(points, limit)


def _fetch_dart_pbr_series(
    ticker: str,
    end_date: str,
    limit: int,
    include_quarterly: bool = False,
) -> list[PbrHistoryPoint]:
    if not _is_korean_ticker(ticker):
        return []
    try:
        from src.tools.dart_api import (
            REPRT_ANNUAL,
            REPRT_H1,
            REPRT_Q1,
            REPRT_Q3,
            _extract_financials,
            _fetch_dart_fs,
            _get_corp_code,
        )
    except Exception as exc:
        logger.debug("DART PBR import failed for %s: %s", ticker, exc)
        return []

    stock_code = ticker.split(".")[0]
    corp_code = _get_corp_code(stock_code)
    if not corp_code:
        return []

    end_year = int(end_date[:4])
    start_year = max(2010, end_year - max(limit + 2, 8))
    start_date = f"{start_year}-01-01"
    prices = get_prices(ticker, start_date, end_date)
    if not prices:
        return []
    price_df = prices_to_df(prices)

    report_specs = [(REPRT_ANNUAL, "12-31")]
    if include_quarterly:
        report_specs = [
            (REPRT_ANNUAL, "12-31"),
            (REPRT_Q3, "09-30"),
            (REPRT_H1, "06-30"),
            (REPRT_Q1, "03-31"),
        ]

    points: list[PbrHistoryPoint] = []
    for year in range(end_year, start_year - 1, -1):
        for reprt_code, suffix in report_specs:
            period = f"{year}-{suffix}"
            if period > end_date:
                continue
            try:
                df = _fetch_dart_fs(corp_code, year, reprt_code)
                fin = _extract_financials(df) if df is not None else {}
            except Exception as exc:
                logger.debug("DART PBR fetch failed for %s %s %s: %s", ticker, year, reprt_code, exc)
                continue
            if not fin:
                continue
            bvps = parse_float_safe(fin.get("book_value_per_share"))
            if bvps is None:
                equity = parse_float_safe(fin.get("shareholders_equity"))
                shares = parse_float_safe(fin.get("outstanding_shares"))
                bvps = equity / shares if equity and shares else None
            period_ts = _timestamp(period)
            close = _close_on_or_before(price_df, period_ts) if period_ts is not None else None
            if bvps is None or bvps <= 0 or close is None or close <= 0:
                continue
            point = _valid_pbr_point(period, close / bvps, bvps, "dart")
            if point:
                points.append(point)
            if len(_dedupe_pbr_points(points, limit)) >= limit:
                return _dedupe_pbr_points(points, limit)
    return _dedupe_pbr_points(points, limit)


def get_pbr_history(
    ticker: str,
    end_date: str,
    limit: int = 8,
    api_key: str | None = None,
) -> list[PbrHistoryPoint]:
    """Return historical PBR observations newest-first for valuation PBR bands."""
    cache_key = f"{ticker}_{end_date}_{limit}"
    cached_data = _cache.get_pbr_history(cache_key)
    if cached_data is not None:
        return [PbrHistoryPoint(**point) for point in cached_data]

    best: list[PbrHistoryPoint] = []
    for fetch_points in (
        lambda: _financialdatasets_pbr_history(ticker, end_date, limit, api_key),
        lambda: _fetch_fmp_pbr_history(ticker, limit),
        lambda: _fetch_yfinance_pbr_series(ticker, end_date, limit),
    ):
        try:
            points = fetch_points()
        except Exception as exc:
            logger.debug("PBR history source failed for %s: %s", ticker, exc)
            points = []
        if len(points) > len(best):
            best = points
        if len(points) >= 4:
            _cache.set_pbr_history(cache_key, [asdict(point) for point in points])
            return points

    dart_annual = _fetch_dart_pbr_series(ticker, end_date, limit, include_quarterly=False)
    if len(dart_annual) > len(best):
        best = dart_annual
    if len(dart_annual) >= 4:
        _cache.set_pbr_history(cache_key, [asdict(point) for point in dart_annual])
        return dart_annual

    dart_quarterly = _fetch_dart_pbr_series(ticker, end_date, limit, include_quarterly=True)
    if len(dart_quarterly) > len(best):
        best = dart_quarterly
    if len(dart_quarterly) >= 4:
        _cache.set_pbr_history(cache_key, [asdict(point) for point in dart_quarterly])
        return dart_quarterly

    _cache.set_pbr_history(cache_key, [])
    return []


def get_financial_metrics(

    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    """Fetch financial metrics from cache or API."""
    # Create a cache key that includes all parameters to ensure exact matches
    cache_key = f"{ticker}_{period}_{end_date}_{limit}"
    
    # Check cache first - simple exact match
    if cached_data := _cache.get_financial_metrics(cache_key):
        return [FinancialMetrics(**_build_financial_metric(metric)) for metric in cached_data]

    financial_metrics = []

    if _is_korean_ticker(ticker):
        # Korean stocks: prefer DART official filings over third-party feeds.
        try:
            from src.tools.dart_api import fetch_dart_metrics
            dart_data = fetch_dart_metrics(ticker, end_date)
            if dart_data:
                financial_metrics = [FinancialMetrics(**_build_financial_metric(dart_data))]
        except Exception as e:
            logger.debug("DART metrics fetch failed for %s: %s", ticker, e)

    # If not in cache or official filing data, fetch from API
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = f"https://api.financialdatasets.ai/financial-metrics/?ticker={ticker}&report_period_lte={end_date}&limit={limit}&period={period}"
    if not financial_metrics:
        response = _make_api_request(url, headers)

        # Parse response with Pydantic model
        try:
            if response.status_code == 200:
                raw_response = response.json()
                raw_metrics = raw_response.get("financial_metrics", []) if isinstance(raw_response, dict) else []
                # financialdatasets' /financial-metrics/ ships a precomputed debt_to_equity that
                # uses a liabilities-inclusive definition (e.g. AAPL ≈ 3.77) and carries NO
                # balance-sheet primitives, so that inflated ratio used to pass straight through
                # to every agent (MU read ~200% instead of the interest-bearing ~28%). Drop it so
                # it is recomputed from total_debt/shareholders_equity once enrichment supplies the
                # primitives; if those never arrive, we surface null rather than a wrong number.
                financial_metrics = [
                    FinancialMetrics(**_build_financial_metric(
                        {k: v for k, v in metric.items() if k != "debt_to_equity"}
                    ))
                    for metric in raw_metrics
                    if isinstance(metric, dict)
                ]
        except Exception as e:
            logger.warning("Failed to parse financial metrics response for %s: %s", ticker, e)

    if not financial_metrics:
        fmp_data = _fetch_fmp_metrics(ticker)
        if fmp_data:
            financial_metrics = [FinancialMetrics(**_build_financial_metric(fmp_data))]

    if not financial_metrics:
        av_data = _fetch_alphavantage_metrics(ticker)
        if av_data:
            financial_metrics = [FinancialMetrics(**_build_financial_metric(av_data))]

    if not financial_metrics:
        yf_data = _fetch_yfinance_metrics(ticker)
        if yf_data:
            financial_metrics = [FinancialMetrics(**_build_financial_metric(yf_data))]

    if not financial_metrics:
        return []

    # Enrich each metric: fill null income-statement fields from line_items[0] and
    # re-derive valuation ratios (P/E, P/B, P/S) so every agent gets correct values.
    #
    # Design notes:
    # - Uses financial_metrics[0].market_cap directly to avoid calling get_market_cap,
    #   which itself calls get_financial_metrics → infinite recursion.
    # - _ENRICHMENT_IN_PROGRESS guard provides an extra safety net.
    # - _ENRICHMENT_LINE_ITEMS_CACHE is separate from _cache._line_items_cache so it
    #   never interferes with sandbox overrides written by the /run route.
    _ENRICHMENT_FIELDS = [
        "revenue", "gross_profit", "operating_income", "net_income",
        "free_cash_flow", "operating_cash_flow", "capital_expenditure",
        "earnings_per_share", "ebitda", "total_debt", "cash_and_equivalents",
        "shareholders_equity", "total_assets", "total_liabilities",
        "research_and_development", "interest_expense", "depreciation_and_amortization",
    ]
    _enrich_key = (ticker, end_date)
    if _enrich_key not in _ENRICHMENT_IN_PROGRESS:
        _ENRICHMENT_IN_PROGRESS.add(_enrich_key)
        try:
            _mc = financial_metrics[0].market_cap  # avoids calling get_market_cap → no recursion
            _li_dicts = _ENRICHMENT_LINE_ITEMS_CACHE.get(_enrich_key)
            if _li_dicts is None:
                _li_enrich = search_line_items(
                    ticker, _ENRICHMENT_FIELDS, end_date, period=period, limit=5, api_key=api_key
                )
                _li_dicts = [item.model_dump() for item in _li_enrich]
                _ENRICHMENT_LINE_ITEMS_CACHE[_enrich_key] = _li_dicts
            financial_metrics = [
                FinancialMetrics(**_build_financial_metric(
                    enrich_metrics_from_line_items(
                        m.model_dump(),
                        _li_dicts,
                        _mc,
                        prefer_line_items=_line_items_newer_than_metrics(m.model_dump(), _li_dicts, end_date),
                    )
                ))
                for m in financial_metrics
            ]
        except Exception as e:
            logger.debug("Metrics enrichment skipped for %s: %s", ticker, e)
        finally:
            _ENRICHMENT_IN_PROGRESS.discard(_enrich_key)

    # Cache the enriched results so subsequent cache-hits also return enriched data
    _cache.set_financial_metrics(cache_key, [m.model_dump() for m in financial_metrics])
    return financial_metrics


def search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    """Fetch line items from API."""
    # Check for pre-injected sandbox/override data first (set by run handler before graph execution)
    if cached_data := _cache.get_line_items(ticker):
        return _filter_usable_line_items(standardize_line_items(cached_data[:limit], line_items), line_items)[:limit]

    fetch_line_items = _expand_line_items(line_items)
    search_results = []

    if _is_korean_ticker(ticker):
        # Korean stocks: DART official filings should beat third-party feeds.
        try:
            from src.tools.dart_api import fetch_dart_line_items
            search_results = fetch_dart_line_items(ticker, fetch_line_items, end_date, period, limit)
        except Exception as e:
            logger.debug("DART line items fetch failed for %s: %s", ticker, e)
        if search_results and not _has_usable_line_item_fields(_filter_usable_line_items(standardize_line_items(search_results, line_items), line_items), line_items):
            search_results = []

    if not search_results and not _is_korean_ticker(ticker):
        # US stocks: SEC companyfacts is the freshest official filing source.
        search_results = _fetch_sec_line_items(ticker, fetch_line_items, end_date, period, limit)
        if search_results and not _has_usable_line_item_fields(_filter_usable_line_items(standardize_line_items(search_results, line_items), line_items), line_items):
            search_results = []

    # If not in cache or official filings, fetch from API
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = "https://api.financialdatasets.ai/financials/search/line-items"

    body = {
        "tickers": [ticker],
        "line_items": fetch_line_items,
        "end_date": end_date,
        "period": period,
        "limit": limit,
    }
    if not search_results:
        response = _make_api_request(url, headers, method="POST", json_data=body)
        if response.status_code == 200:
            try:
                data = response.json()
                response_model = LineItemResponse(**data)
                search_results = response_model.search_results
            except Exception as e:
                logger.warning("Failed to parse line items response for %s: %s", ticker, e)

        if search_results and not _has_usable_line_item_fields(_filter_usable_line_items(standardize_line_items(search_results, line_items), line_items), line_items):
            search_results = []

    if not search_results and _is_korean_ticker(ticker):
        # Last official retry for Korean if DART was temporarily unavailable above.
        try:
            from src.tools.dart_api import fetch_dart_line_items
            search_results = fetch_dart_line_items(ticker, fetch_line_items, end_date, period, limit)
        except Exception as e:
            logger.debug("DART line items fetch failed for %s: %s", ticker, e)
        if search_results and not _has_usable_line_item_fields(_filter_usable_line_items(standardize_line_items(search_results, line_items), line_items), line_items):
            search_results = []

    if not search_results:
        # Fallback 2: FMP stable financial statements (US stocks)
        search_results = _fetch_fmp_line_items(ticker, fetch_line_items, end_date, period, limit)
        if search_results and not _has_usable_line_item_fields(_filter_usable_line_items(standardize_line_items(search_results, line_items), line_items), line_items):
            search_results = []

    if not search_results:
        # Fallback 3: yfinance (works for Korean + US stocks)
        search_results = _fetch_yfinance_line_items(ticker, fetch_line_items, end_date, period, limit)

    if not search_results:
        return []

    search_results = _filter_usable_line_items(search_results, line_items)
    return standardize_line_items(
        search_results[:limit],
        line_items,
    )


def get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    """Fetch insider trades from cache or API."""
    # Create a cache key that includes all parameters to ensure exact matches
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    
    # Check cache first - simple exact match
    if cached_data := _cache.get_insider_trades(cache_key):
        return [InsiderTrade(**trade) for trade in cached_data]

    # If not in cache, fetch from API
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    all_trades = []
    current_end_date = end_date

    while True:
        url = f"https://api.financialdatasets.ai/insider-trades/?ticker={ticker}&filing_date_lte={current_end_date}"
        if start_date:
            url += f"&filing_date_gte={start_date}"
        url += f"&limit={limit}"

        response = _make_api_request(url, headers)
        if response.status_code != 200:
            break

        try:
            data = response.json()
            response_model = InsiderTradeResponse(**data)
            insider_trades = response_model.insider_trades
        except Exception as e:
            logger.warning("Failed to parse insider trades response for %s: %s", ticker, e)
            break

        if not insider_trades:
            break

        all_trades.extend(insider_trades)

        # Only continue pagination if we have a start_date and got a full page
        if not start_date or len(insider_trades) < limit:
            break

        # Update end_date to the oldest filing date from current batch for next iteration
        current_end_date = min(trade.filing_date for trade in insider_trades).split("T")[0]

        # If we've reached or passed the start_date, we can stop
        if current_end_date <= start_date:
            break

    if not all_trades:
        return []

    # Cache the results using the comprehensive cache key
    _cache.set_insider_trades(cache_key, [trade.model_dump() for trade in all_trades])
    return all_trades


def get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[CompanyNews]:
    """Fetch company news from cache or API."""
    # Create a cache key that includes all parameters to ensure exact matches
    cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
    
    # Check cache first - simple exact match
    if cached_data := _cache.get_company_news(cache_key):
        return [CompanyNews(**news) for news in cached_data]

    # If not in cache, fetch from API
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    all_news = []
    current_end_date = end_date

    while True:
        url = f"https://api.financialdatasets.ai/news/?ticker={ticker}&end_date={current_end_date}"
        if start_date:
            url += f"&start_date={start_date}"
        url += f"&limit={limit}"

        response = _make_api_request(url, headers)
        if response.status_code != 200:
            break

        try:
            data = response.json()
            response_model = CompanyNewsResponse(**data)
            company_news = response_model.news
        except Exception as e:
            logger.warning("Failed to parse company news response for %s: %s", ticker, e)
            break

        if not company_news:
            break

        all_news.extend(company_news)

        # Only continue pagination if we have a start_date and got a full page
        if not start_date or len(company_news) < limit:
            break

        # Update end_date to the oldest date from current batch for next iteration
        current_end_date = min(news.date for news in company_news).split("T")[0]

        # If we've reached or passed the start_date, we can stop
        if current_end_date <= start_date:
            break

    if not all_news:
        # Fallback: yfinance news
        try:
            import yfinance as yf
            yf_news = yf.Ticker(ticker).news or []
            for item in yf_news[:limit]:
                content = item.get("content", {})
                pub_date = ""
                pt = content.get("pubDate") or item.get("providerPublishTime")
                if pt:
                    import datetime
                    if isinstance(pt, (int, float)):
                        pub_date = datetime.datetime.fromtimestamp(pt).strftime("%Y-%m-%dT%H:%M:%S")
                    else:
                        pub_date = str(pt)[:10]
                if pub_date and start_date and pub_date[:10] < start_date:
                    continue
                title = content.get("title") or item.get("title", "")
                summary = content.get("summary") or content.get("body") or item.get("summary", "")
                url = content.get("canonicalUrl", {}).get("url") or item.get("link", "")
                all_news.append(CompanyNews(
                    ticker=ticker,
                    title=title,
                    author=content.get("byline", {}).get("byline", "") if isinstance(content.get("byline"), dict) else "",
                    source=content.get("provider", {}).get("displayName", "Yahoo Finance") if isinstance(content.get("provider"), dict) else "Yahoo Finance",
                    date=pub_date or end_date,
                    url=url,
                    sentiment=None,
                ))
        except Exception as e:
            logger.debug("yfinance news fallback failed for %s: %s", ticker, e)

    if not all_news:
        return []

    # Cache the results using the comprehensive cache key
    _cache.set_company_news(cache_key, [news.model_dump() for news in all_news])
    return all_news


def get_market_cap(
    ticker: str,
    end_date: str,
    api_key: str = None,
) -> float | None:
    """Fetch market cap from the API."""
    _mc_key = (ticker, end_date)
    if _mc_key in _MARKET_CAP_CACHE:
        return _MARKET_CAP_CACHE[_mc_key]

    # Check if end_date is today
    if end_date == datetime.datetime.now().strftime("%Y-%m-%d"):
        # Get the market cap from company facts API
        headers = {}
        financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
        if financial_api_key:
            headers["X-API-KEY"] = financial_api_key

        url = f"https://api.financialdatasets.ai/company/facts/?ticker={ticker}"
        response = _make_api_request(url, headers)
        if response.status_code == 200:
            try:
                data = response.json()
                response_model = CompanyFactsResponse(**data)
                if response_model.company_facts.market_cap:
                    result = response_model.company_facts.market_cap
                    _MARKET_CAP_CACHE[_mc_key] = result
                    return result
            except Exception as e:
                logger.debug("Failed to parse company facts for %s: %s", ticker, e)

    financial_metrics = get_financial_metrics(ticker, end_date, api_key=api_key)
    if not financial_metrics:
        _MARKET_CAP_CACHE[_mc_key] = None
        return None

    market_cap = financial_metrics[0].market_cap

    if not market_cap:
        _MARKET_CAP_CACHE[_mc_key] = None
        return None

    _MARKET_CAP_CACHE[_mc_key] = market_cap
    return market_cap


def prices_to_df(prices: list[Price]) -> pd.DataFrame:
    """Convert prices to a DataFrame."""
    df = pd.DataFrame([p.model_dump() for p in prices])
    df["Date"] = pd.to_datetime(df["time"])
    df.set_index("Date", inplace=True)
    numeric_cols = ["open", "close", "high", "low", "volume"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df.sort_index(inplace=True)
    return df


# Update the get_price_data function to use the new functions
def get_price_data(ticker: str, start_date: str, end_date: str, api_key: str = None) -> pd.DataFrame:
    prices = get_prices(ticker, start_date, end_date, api_key=api_key)
    return prices_to_df(prices)
