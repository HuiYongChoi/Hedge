import datetime
import logging
import os
import pandas as pd
import requests
import time

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


def _fetch_fmp_metrics(ticker: str) -> dict | None:
    """Fetch FinancialMetrics from FMP stable endpoints (US stocks only)."""
    if _is_korean_ticker(ticker):
        return None
    try:
        km = _fmp_get("key-metrics", {"symbol": ticker, "limit": 1})
        rt = _fmp_get("ratios", {"symbol": ticker, "limit": 1})
        inc = _fmp_get("income-statement", {"symbol": ticker, "limit": 1}) or []
        bal = _fmp_get("balance-sheet-statement", {"symbol": ticker, "limit": 1}) or []
        cf = _fmp_get("cash-flow-statement", {"symbol": ticker, "limit": 1}) or []
        profile = _fmp_get("profile", {"symbol": ticker}) or []
        if not km and not inc and not bal and not cf:
            return None
        m = km[0] if (km and isinstance(km, list) and km) else {}
        r = rt[0] if (rt and isinstance(rt, list) and rt) else {}
        inc_row = inc[0] if isinstance(inc, list) and inc else {}
        bal_row = bal[0] if isinstance(bal, list) and bal else {}
        cf_row = cf[0] if isinstance(cf, list) and cf else {}
        profile_row = profile[0] if isinstance(profile, list) and profile else {}
        report_date = m.get("date") or inc_row.get("date") or bal_row.get("date") or "TTM"
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
        fmp_period = "quarter" if period == "ttm" else "annual"
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
            target_period = "ttm"
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
            # Annual: one LineItem per fiscal year column
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

    # If not in cache, fetch from API
    headers = {}
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers["X-API-KEY"] = financial_api_key

    url = f"https://api.financialdatasets.ai/financial-metrics/?ticker={ticker}&report_period_lte={end_date}&limit={limit}&period={period}"
    response = _make_api_request(url, headers)

    financial_metrics = []
    # Parse response with Pydantic model
    try:
        if response.status_code == 200:
            raw_response = response.json()
            raw_metrics = raw_response.get("financial_metrics", []) if isinstance(raw_response, dict) else []
            financial_metrics = [
                FinancialMetrics(**_build_financial_metric(metric))
                for metric in raw_metrics
                if isinstance(metric, dict)
            ]
    except Exception as e:
        logger.warning("Failed to parse financial metrics response for %s: %s", ticker, e)

    if not financial_metrics and _is_korean_ticker(ticker):
        # Korean stocks: try DART first (official 재무제표)
        try:
            from src.tools.dart_api import fetch_dart_metrics
            dart_data = fetch_dart_metrics(ticker, end_date)
            if dart_data:
                financial_metrics = [FinancialMetrics(**_build_financial_metric(dart_data))]
        except Exception as e:
            logger.debug("DART metrics fetch failed for %s: %s", ticker, e)

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

    # Enrich each metric row: fill null income-statement fields from line_items[0]
    # and re-derive valuation ratios (P/E, P/B, P/S) from the now-correct base data.
    # search_line_items does NOT call get_financial_metrics, so no circular dependency.
    _ENRICHMENT_FIELDS = [
        "revenue", "gross_profit", "operating_income", "net_income",
        "free_cash_flow", "operating_cash_flow", "capital_expenditure",
        "earnings_per_share", "ebitda", "total_debt", "cash_and_equivalents",
        "shareholders_equity", "total_assets", "total_liabilities",
        "research_and_development", "interest_expense", "depreciation_and_amortization",
    ]
    try:
        _li = search_line_items(ticker, _ENRICHMENT_FIELDS, end_date, period="ttm", limit=1, api_key=api_key)
        _li_dicts = [item.model_dump() for item in _li]
        _mc = get_market_cap(ticker, end_date, api_key=api_key)
        financial_metrics = [
            FinancialMetrics(**_build_financial_metric(
                enrich_metrics_from_line_items(m.model_dump(), _li_dicts, _mc)
            ))
            for m in financial_metrics
        ]
    except Exception as e:
        logger.debug("Metrics enrichment failed for %s: %s", ticker, e)

    # Cache the enriched results so subsequent calls (cache hit) also get enriched data
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
        return standardize_line_items(cached_data[:limit], line_items)

    fetch_line_items = _expand_line_items(line_items)
    # If not in cache or insufficient data, fetch from API
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
    response = _make_api_request(url, headers, method="POST", json_data=body)
    search_results = []
    if response.status_code == 200:
        try:
            data = response.json()
            response_model = LineItemResponse(**data)
            search_results = response_model.search_results
        except Exception as e:
            logger.warning("Failed to parse line items response for %s: %s", ticker, e)

    if search_results and not _has_usable_line_item_fields(standardize_line_items(search_results[:limit], line_items), line_items):
        search_results = []

    if not search_results and _is_korean_ticker(ticker):
        # Fallback 1 for Korean: DART (official 재무제표 - most accurate for KR)
        try:
            from src.tools.dart_api import fetch_dart_line_items
            search_results = fetch_dart_line_items(ticker, fetch_line_items, end_date, period, limit)
        except Exception as e:
            logger.debug("DART line items fetch failed for %s: %s", ticker, e)
        if search_results and not _has_usable_line_item_fields(standardize_line_items(search_results[:limit], line_items), line_items):
            search_results = []

    if not search_results:
        # Fallback 2: FMP stable financial statements (US stocks)
        search_results = _fetch_fmp_line_items(ticker, fetch_line_items, end_date, period, limit)
        if search_results and not _has_usable_line_item_fields(standardize_line_items(search_results[:limit], line_items), line_items):
            search_results = []

    if not search_results:
        # Fallback 3: yfinance (works for Korean + US stocks)
        search_results = _fetch_yfinance_line_items(ticker, fetch_line_items, end_date, period, limit)

    if not search_results:
        return []

    return standardize_line_items(search_results[:limit], line_items)


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
                    return response_model.company_facts.market_cap
            except Exception as e:
                logger.debug("Failed to parse company facts for %s: %s", ticker, e)

    financial_metrics = get_financial_metrics(ticker, end_date, api_key=api_key)
    if not financial_metrics:
        return None

    market_cap = financial_metrics[0].market_cap

    if not market_cap:
        return None

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
