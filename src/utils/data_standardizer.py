"""Financial data standardization helpers for analyst agents."""

from __future__ import annotations

import math
from typing import Any, Iterable

from pydantic import BaseModel

from src.data.models import LineItem


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _safe_div(numerator: Any, denominator: Any) -> float | None:
    numerator = _safe_float(numerator)
    denominator = _safe_float(denominator)
    if numerator is None or denominator in (None, 0):
        return None
    try:
        return numerator / denominator
    except ZeroDivisionError:
        return None


def _model_to_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, BaseModel):
        return item.model_dump()
    if isinstance(item, dict):
        return dict(item)
    return dict(getattr(item, "__dict__", {}))


def _first_present(row: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = _safe_float(row.get(name))
        if value is not None:
            return value
    return None


def _sum_present(row: dict[str, Any], *names: str) -> float | None:
    values = [_safe_float(row.get(name)) for name in names]
    present_values = [value for value in values if value is not None]
    return sum(present_values) if present_values else None


def _derive_total_debt(row: dict[str, Any]) -> float | None:
    direct_total_debt = _safe_float(row.get("total_debt"))
    if direct_total_debt is not None:
        return direct_total_debt

    return _sum_present(
        row,
        "short_term_debt",
        "long_term_debt",
        "current_debt",
        "non_current_debt",
        "short_term_borrowings",
        "long_term_borrowings",
    )


def _cash_outflow(value: Any) -> float | None:
    value = _safe_float(value)
    return abs(value) if value is not None else None


def derive_financial_fields(row: dict[str, Any]) -> dict[str, Any]:
    """Derive agent-required metrics only from already present raw values."""
    revenue = _safe_float(row.get("revenue"))
    gross_profit = _safe_float(row.get("gross_profit"))
    operating_income = _safe_float(row.get("operating_income"))
    net_income = _safe_float(row.get("net_income"))
    total_assets = _safe_float(row.get("total_assets"))
    total_liabilities = _safe_float(row.get("total_liabilities"))
    shareholders_equity = _safe_float(row.get("shareholders_equity"))
    current_assets = _safe_float(row.get("current_assets"))
    current_liabilities = _safe_float(row.get("current_liabilities"))
    total_debt = _derive_total_debt(row)
    cash = _safe_float(row.get("cash_and_equivalents"))
    shares = _safe_float(row.get("outstanding_shares"))
    operating_cash_flow = _safe_float(row.get("operating_cash_flow"))
    capex_outflow = _cash_outflow(row.get("capital_expenditure"))
    depreciation = _safe_float(row.get("depreciation_and_amortization"))
    ebit = _first_present(row, "ebit", "operating_income")
    ebitda = _safe_float(row.get("ebitda"))
    interest = _safe_float(row.get("interest_expense"))
    goodwill = _safe_float(row.get("goodwill"))
    intangible_assets = _safe_float(row.get("intangible_assets"))
    market_cap = _safe_float(row.get("market_cap"))

    derived = dict(row)

    if derived.get("free_cash_flow") is None and operating_cash_flow is not None and capex_outflow is not None:
        derived["free_cash_flow"] = operating_cash_flow - capex_outflow
    free_cash_flow = _safe_float(derived.get("free_cash_flow"))

    if derived.get("gross_margin") is None:
        derived["gross_margin"] = _safe_div(gross_profit, revenue)
    if derived.get("operating_margin") is None:
        derived["operating_margin"] = _safe_div(operating_income, revenue)
    if derived.get("net_margin") is None:
        derived["net_margin"] = _safe_div(net_income, revenue)
    if derived.get("operating_expense") is None and revenue is not None and operating_income is not None:
        derived["operating_expense"] = revenue - operating_income

    if derived.get("total_liabilities") is None and total_assets is not None and shareholders_equity is not None:
        derived["total_liabilities"] = total_assets - shareholders_equity
        total_liabilities = _safe_float(derived["total_liabilities"])
    if derived.get("total_debt") is None and total_debt is not None:
        derived["total_debt"] = total_debt

    if derived.get("working_capital") is None and current_assets is not None and current_liabilities is not None:
        derived["working_capital"] = current_assets - current_liabilities
    working_capital = _safe_float(derived.get("working_capital"))

    if derived.get("debt_to_equity") is None:
        derived["debt_to_equity"] = _safe_div(total_debt, shareholders_equity)
    if derived.get("debt_to_assets") is None:
        derived["debt_to_assets"] = _safe_div(total_liabilities, total_assets)
    if derived.get("current_ratio") is None:
        derived["current_ratio"] = _safe_div(current_assets, current_liabilities)
    if derived.get("working_capital_turnover") is None:
        derived["working_capital_turnover"] = _safe_div(revenue, working_capital)

    if derived.get("return_on_equity") is None:
        derived["return_on_equity"] = _safe_div(net_income, shareholders_equity)
    if derived.get("return_on_assets") is None:
        derived["return_on_assets"] = _safe_div(net_income, total_assets)
    if derived.get("return_on_invested_capital") is None:
        invested_capital = None
        if shareholders_equity is not None or total_debt is not None:
            invested_capital = (shareholders_equity or 0) + (total_debt or 0) - (cash or 0)
        derived["return_on_invested_capital"] = _safe_div(operating_income, invested_capital)

    if derived.get("interest_coverage") is None:
        derived["interest_coverage"] = _safe_div(ebit, abs(interest) if interest is not None else None)

    if derived.get("book_value_per_share") is None:
        derived["book_value_per_share"] = _safe_div(shareholders_equity, shares)
    if derived.get("earnings_per_share") is None:
        derived["earnings_per_share"] = _safe_div(net_income, shares)
    if derived.get("free_cash_flow_per_share") is None:
        derived["free_cash_flow_per_share"] = _safe_div(free_cash_flow, shares)
    if derived.get("free_cash_flow_yield") is None:
        derived["free_cash_flow_yield"] = _safe_div(free_cash_flow, market_cap)

    if derived.get("owner_earnings") is None and net_income is not None and depreciation is not None and capex_outflow is not None:
        derived["owner_earnings"] = net_income + depreciation - capex_outflow

    if derived.get("goodwill_and_intangible_assets") is None:
        if goodwill is not None or intangible_assets is not None:
            derived["goodwill_and_intangible_assets"] = (goodwill or 0) + (intangible_assets or 0)

    if derived.get("ebit") is None and ebit is not None:
        derived["ebit"] = ebit
    if derived.get("ebitda") is None and operating_income is not None and depreciation is not None:
        derived["ebitda"] = operating_income + depreciation
    if derived.get("enterprise_value") is None and market_cap is not None:
        derived["enterprise_value"] = market_cap + (total_debt or 0) - (cash or 0)

    enterprise_value = _safe_float(derived.get("enterprise_value"))
    ebitda = _safe_float(derived.get("ebitda")) if ebitda is None else ebitda
    if derived.get("enterprise_value_to_ebitda_ratio") is None:
        derived["enterprise_value_to_ebitda_ratio"] = _safe_div(enterprise_value, ebitda)
    if derived.get("enterprise_value_to_revenue_ratio") is None:
        derived["enterprise_value_to_revenue_ratio"] = _safe_div(enterprise_value, revenue)
    if derived.get("price_to_sales_ratio") is None:
        derived["price_to_sales_ratio"] = _safe_div(market_cap, revenue)
    if derived.get("price_to_book_ratio") is None:
        derived["price_to_book_ratio"] = _safe_div(market_cap, shareholders_equity)
    if derived.get("price_to_earnings_ratio") is None:
        derived["price_to_earnings_ratio"] = _safe_div(market_cap, net_income)

    return derived


def standardize_financial_metric_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a metric payload with formula-derived fields populated when possible."""
    return derive_financial_fields(dict(payload))


_ENRICHMENT_SKIP_KEYS: frozenset[str] = frozenset({
    "ticker", "report_period", "period", "currency", "calendar_date", "filing_type",
})

_VALUATION_RATIO_KEYS: tuple[str, ...] = (
    "price_to_earnings_ratio",
    "price_to_book_ratio",
    "price_to_sales_ratio",
    "enterprise_value_to_ebitda_ratio",
    "enterprise_value_to_revenue_ratio",
)


def enrich_metrics_from_line_items(
    metrics: dict[str, Any],
    line_items: list[dict[str, Any]] | None,
    market_cap: float | None = None,
) -> dict[str, Any]:
    """Fill null income-statement fields in metrics from line_items[0],
    inject market_cap, reset valuation ratios, then re-derive via
    standardize_financial_metric_payload. Returns a new dict."""
    enriched = dict(metrics)

    if line_items:
        li0 = line_items[0]
        for k, v in li0.items():
            if k not in _ENRICHMENT_SKIP_KEYS and v is not None and enriched.get(k) is None:
                enriched[k] = v

    if market_cap is not None:
        enriched["market_cap"] = market_cap

    # Reset valuation ratios so standardizer re-derives them from the now-correct base data
    for ratio in _VALUATION_RATIO_KEYS:
        enriched[ratio] = None

    return standardize_financial_metric_payload(enriched)


def standardize_line_items(items: Iterable[Any], requested_fields: Iterable[str] | None = None) -> list[LineItem]:
    """Materialize requested fields as None and add formula-derived metrics."""
    requested = tuple(requested_fields or ())
    standardized: list[LineItem] = []
    for item in items:
        row = derive_financial_fields(_model_to_dict(item))
        for field in requested:
            row.setdefault(field, None)
        standardized.append(LineItem(**row))
    return standardized
