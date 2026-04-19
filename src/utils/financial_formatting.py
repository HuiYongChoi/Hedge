"""Presentation-safe formatting for financial analysis text."""

from __future__ import annotations

import math
import re
from typing import Any


RATIO_LABEL_PATTERN = (
    r"D/E|Debt[-\s_/]*To[-\s_/]*Equity|Debt/Eq|debt_to_equity|"
    r"Current\s+Ratio|current_ratio|Quick\s+Ratio|quick_ratio|"
    r"Debt[-\s_/]*To[-\s_/]*Assets|debt_to_assets|"
    r"Liabilities[-\s_/]*To[-\s_/]*Assets|liabilities_to_assets|"
    r"Cash\s+Ratio|cash_ratio"
)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def format_x_ratio(value: Any, decimals: int = 2) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"
    return f"{number:.{decimals}f}x"


def format_percent(value: Any, decimals: int = 1) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"
    return f"{number:.{decimals}%}"


def format_money(value: Any, currency: str | None = None, decimals: int = 2) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"
    prefix = f"{currency} " if currency and currency.upper() not in {"USD", "$"} else "$"
    abs_number = abs(number)
    if abs_number >= 1_000_000_000:
        compact = f"{number / 1_000_000_000:.{decimals}f}B"
    elif abs_number >= 1_000_000:
        compact = f"{number / 1_000_000:.{decimals}f}M"
    elif abs_number >= 1_000:
        compact = f"{number / 1_000:.{decimals}f}K"
    else:
        compact = f"{number:.{decimals}f}"
    return f"{prefix}{compact}"


def format_korean_won_amount(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"

    sign = "-" if number < 0 else ""
    abs_number = abs(number)
    jo_unit = 1_000_000_000_000
    eok_unit = 100_000_000

    if abs_number >= jo_unit:
        jo = int(abs_number // jo_unit)
        eok = int((abs_number % jo_unit) // eok_unit)
        if eok:
            return f"{sign}{jo:,}조 {eok:,}억 원"
        return f"{sign}{jo:,}조 원"

    if abs_number >= eok_unit:
        return f"{sign}{int(abs_number // eok_unit):,}억 원"

    return f"{sign}{round(abs_number):,}원"


def format_period_note(period: Any, report_period: Any) -> str:
    period_text = str(period or "N/A").upper()
    report_text = str(report_period or "N/A")
    return f"{period_text}, Report Period {report_text}"


def _restore_lost_ratio_decimal(match: re.Match[str]) -> str:
    label = match.group("label")
    separator = match.group("separator")
    raw_number = match.group("number")
    unit = match.group("unit") or "x"

    if len(raw_number) == 3:
        number = int(raw_number) / 100
    elif len(raw_number) == 4 and raw_number.startswith("0"):
        number = int(raw_number) / 1000
    else:
        number = float(raw_number)
    return f"{label}{separator}{number:.2f}{unit.lower()}"


def _round_verbose_ratio(match: re.Match[str]) -> str:
    label = match.group("label")
    separator = match.group("separator")
    number = float(match.group("number"))
    unit = match.group("unit") or "x"
    return f"{label}{separator}{number:.2f}{unit.lower()}"


def _normalize_ratio_text(text: str) -> str:
    label = RATIO_LABEL_PATTERN
    lost_decimal_pattern = re.compile(
        rf"(?P<label>\b(?:{label})\b)(?P<separator>\s*(?:=|:|of)?\s*)"
        rf"(?P<number>\d{{3,4}})(?P<unit>\s*x\b)",
        flags=re.IGNORECASE,
    )
    verbose_decimal_pattern = re.compile(
        rf"(?P<label>\b(?:{label})\b)(?P<separator>\s*(?:=|:|of)?\s*)"
        rf"(?P<number>\d+\.\d{{3,}})(?P<unit>\s*x\b)",
        flags=re.IGNORECASE,
    )

    text = lost_decimal_pattern.sub(_restore_lost_ratio_decimal, text)
    return verbose_decimal_pattern.sub(_round_verbose_ratio, text)


def _normalize_graham_number_text(text: str) -> str:
    decimal_values = re.findall(
        r"Graham\s+Number\s*=\s*([0-9][0-9,]*\.[0-9]+)",
        text,
        flags=re.IGNORECASE,
    )
    for value in decimal_values:
        compact = re.sub(r"\D", "", value)
        if not compact:
            continue
        text = re.sub(
            rf"((?:Graham\s+Number|그레이엄\s*넘버)[^()\n]{{0,40}}\()\s*{re.escape(compact)}\s*(\))",
            rf"\g<1>{value}\2",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            rf"((?:Graham\s+Number|그레이엄\s*넘버)[^.;,\n]{{0,40}}?)\b{re.escape(compact)}\b",
            rf"\g<1>{value}",
            text,
            flags=re.IGNORECASE,
        )
    return text


def _normalize_financial_term_text(text: str) -> str:
    text = re.sub(r"현금으로\s*돌아오는\s*힘", "잉여현금흐름(FCF) 창출력", text)
    text = text.replace("영업현금흐름(FCF)", "잉여현금흐름(FCF)")
    text = re.sub(
        r"\bD/E\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*x\s*\(([^)]+)\)",
        r"Debt-To-Equity(부채비율) \1x (\2)",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bD/E\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*x\b",
        r"Debt-To-Equity(부채비율) \1x",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bDebt[-\s_/]*To[-\s_/]*Equity\b(?!\()",
        "Debt-To-Equity(부채비율)",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"(Debt-To-Equity\(부채비율\)\s+\d+(?:\.\d+)?x)\s*\(([^)]+)\)",
        r"\1 (\2)",
        text,
    )
    return text


def _normalize_korean_market_cap_text(text: str) -> str:
    market_cap_pattern = re.compile(
        r"(?P<label>시가\s*총액|시가총액|Market\s+Cap\(시가총액\))"
        r"(?P<separator>\s*[:：]?\s*)"
        r"(?:₩|KRW\s*)?"
        r"(?P<number>[0-9][0-9,]{8,})"
        r"\s*(?:원)?",
        flags=re.IGNORECASE,
    )

    def replace_market_cap(match: re.Match[str]) -> str:
        label = re.sub(r"\s+", "", match.group("label"))
        number = match.group("number").replace(",", "")
        return f"{label}: {format_korean_won_amount(number)}"

    return market_cap_pattern.sub(replace_market_cap, text)


def normalize_financial_language(text: str) -> str:
    """Repair common LLM readability errors in financial ratio prose."""
    if not isinstance(text, str):
        return text
    normalized = _normalize_ratio_text(text)
    normalized = _normalize_graham_number_text(normalized)
    normalized = _normalize_financial_term_text(normalized)
    return _normalize_korean_market_cap_text(normalized)
