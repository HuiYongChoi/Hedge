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

KOREAN_FIRST_TERM_REPLACEMENTS = [
    (r"Margin\s+Of\s+Safety\s*\(\s*안전마진\s*\)", "안전마진 (margin of safety)"),
    (r"Owner\s+Earnings\s*\(\s*소유자\s*이익\s*\)", "소유자 이익 (owner earnings)"),
    (r"Graham\s+Number\s*\(\s*그레이엄\s*넘버\s*\)", "그레이엄 넘버 (Graham Number)"),
    (r"Current\s+Ratio\s*\(\s*유동비율\s*\)", "유동비율 (current ratio)"),
    (r"Quick\s+Ratio\s*\(\s*당좌비율\s*\)", "당좌비율 (quick ratio)"),
    (r"Debt[-\s_/]*To[-\s_/]*Equity\s*\(\s*부채비율\s*\)", "부채비율 (debt-to-equity)"),
    (r"Operating\s+Margin\s*\(\s*영업이익률\s*\)", "영업이익률 (operating margin)"),
    (r"Return\s+On\s+Equity\s*\(\s*자기자본이익률\s*\)", "자기자본이익률 (return on equity)"),
    (r"Market\s+Cap\s*\(\s*시가총액\s*\)", "시가총액 (market cap)"),
    (r"Intrinsic\s+Value\s*\(\s*내재가치\s*\)", "내재가치 (intrinsic value)"),
    (r"Free\s+Cash\s+Flow\s+Yield\s*\(\s*(?:잉여현금흐름수익률|FCF\s*수익률)\s*\)", "FCF 수익률 (free cash flow yield)"),
]


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


def format_leverage_ratio(value: Any, decimals: int = 2) -> str:
    """Format leverage-style ratios (e.g., Debt-To-Equity) as a plain decimal.

    Avoids the misleading ``x`` suffix used by ``format_x_ratio`` because
    Debt/Equity is a proportion, not a multiplier — ``0.11`` is clearer than
    ``0.11x``.
    """
    number = _safe_float(value)
    if number is None:
        return "N/A"
    return f"{number:.{decimals}f}"


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


def _format_score_text(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"
    return f"{number:.1f}점"


def _format_user_friendly_percent(value: Any, emphasize_small_ratio: bool = False) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"

    scaled = number * 100
    if emphasize_small_ratio and abs(number) < 0.01:
        scaled = number * 10_000

    if math.isclose(scaled, round(scaled), abs_tol=0.05):
        return f"{int(round(scaled))}%"
    return f"{scaled:.1f}%"


def _format_human_amount(value: Any) -> str:
    number = _safe_float(value)
    if number is None:
        return "N/A"
    if abs(number) >= 100_000_000:
        return format_korean_won_amount(number)
    return f"{number:,.0f}"


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
    # Strip the misleading "x" suffix from Debt-To-Equity values; D/E is a proportion, not a multiplier.
    text = re.sub(
        r"\bD/E\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*x\s*\(([^)]+)\)",
        r"Debt-To-Equity(부채비율) \1 (\2)",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bD/E\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*x\b",
        r"Debt-To-Equity(부채비율) \1",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bDebt[-\s_/]*To[-\s_/]*Equity\b(?!\()",
        "Debt-To-Equity(부채비율)",
        text,
        flags=re.IGNORECASE,
    )
    # Remove residual 'x' suffix that may have been emitted directly after the localized label.
    text = re.sub(
        r"(Debt-To-Equity\(부채비율\)\s*[:=]?\s*)(\d+(?:\.\d+)?)\s*x\b",
        r"\1\2",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"(Debt-To-Equity\(부채비율\)\s+\d+(?:\.\d+)?)\s*\(([^)]+)\)",
        r"\1 (\2)",
        text,
    )
    return text


def _normalize_korean_first_financial_terms(text: str) -> str:
    normalized = text
    for pattern, replacement in KOREAN_FIRST_TERM_REPLACEMENTS:
        normalized = re.sub(pattern, replacement, normalized, flags=re.IGNORECASE)

    normalized = re.sub(
        r"\bGraham\s+Number\b\s*[:=]?\s*(\d+(?:\.\d+)?)",
        r"그레이엄 넘버 (Graham Number) \1",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bD/E\b\s*[:=]?\s*(\d+(?:\.\d+)?)\b",
        r"부채비율 (debt-to-equity) \1",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bCurrent\s+Ratio\b\s*[:=]?\s*(\d+(?:\.\d+)?)x\b",
        r"유동비율 (current ratio) \1x",
        normalized,
        flags=re.IGNORECASE,
    )
    return normalized


def _normalize_korean_market_cap_text(text: str) -> str:
    market_cap_pattern = re.compile(
        r"(?P<label>시가\s*총액|시가총액|Market\s+Cap\(시가총액\)|시가총액\s*\(market\s*cap\))"
        r"(?P<separator>\s*[:：]?\s*)"
        r"(?:₩|KRW\s*)?"
        r"(?P<number>(?:[0-9]{1,3}(?:,[0-9]{3}){2,}|[0-9]{9,})(?:\.\d+)?)"
        r"\s*(?:원)?",
        flags=re.IGNORECASE,
    )

    def replace_market_cap(match: re.Match[str]) -> str:
        label = re.sub(r"\s+", "", match.group("label"))
        raw_number = match.group("number")
        integer_digits = re.sub(r"\D", "", raw_number.split(".", 1)[0])
        if len(integer_digits) < 9:
            return match.group(0)
        number = raw_number.replace(",", "")
        return f"{label}: {format_korean_won_amount(number)}"

    return market_cap_pattern.sub(replace_market_cap, text)


def _normalize_machine_report_text(text: str) -> str:
    normalized = re.sub(
        r"\bmoat_strong\s*=\s*(?P<flag>true|false)\s*,\s*moat_score\s*=\s*(?P<score>-?\d+(?:\.\d+)?)",
        lambda match: (
            f"해자 경쟁력 {'강함' if match.group('flag').lower() == 'true' else '약함'}, "
            f"해자 점수 {_format_score_text(match.group('score'))}"
        ),
        text,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bmoat_strong\s*=\s*(true|false)",
        lambda match: f"해자 경쟁력 {'강함' if match.group(1).lower() == 'true' else '약함'}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bpredictability_score\s*=\s*(?P<score>-?\d+(?:\.\d+)?)\s*,\s*flags\.predictable\s*=\s*(?P<flag>true|false)",
        lambda match: (
            f"예측가능성 {'높음' if match.group('flag').lower() == 'true' else '낮음'}, "
            f"예측가능성 점수 {_format_score_text(match.group('score'))}"
        ),
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bflags\.predictable\s*=\s*(true|false)",
        lambda match: f"예측가능성 {'높음' if match.group(1).lower() == 'true' else '낮음'}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bmoat_score\s*=\s*(-?\d+(?:\.\d+)?)",
        lambda match: f"해자 점수 {_format_score_text(match.group(1))}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bpredictability_score\s*=\s*(-?\d+(?:\.\d+)?)",
        lambda match: f"예측가능성 점수 {_format_score_text(match.group(1))}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bvaluation_score\s*=\s*(-?\d+(?:\.\d+)?)",
        lambda match: f"밸류에이션 점수 {_format_score_text(match.group(1))}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bfcf_yield\s*=\s*(-?\d+(?:\.\d+)?)",
        lambda match: f"FCF 수익률 {_format_user_friendly_percent(match.group(1), emphasize_small_ratio=True)}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\bmargin_of_safety_vs_fair_value\s*=\s*(-?\d+(?:\.\d+)?)",
        lambda match: f"적정가 대비 {_format_user_friendly_percent(match.group(1))}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"\breasonable_value\s*=\s*(-?\d+(?:\.\d+)?)",
        lambda match: f"적정가 추정치 {_format_human_amount(match.group(1))}",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\s{2,}", " ", normalized)
    normalized = re.sub(r"\s+,", ",", normalized)
    normalized = re.sub(r",\s*,", ", ", normalized)
    return normalized.strip(" ,")


def normalize_financial_language(text: str) -> str:
    """Repair common LLM readability errors in financial ratio prose."""
    if not isinstance(text, str):
        return text
    normalized = _normalize_ratio_text(text)
    normalized = _normalize_graham_number_text(normalized)
    normalized = _normalize_financial_term_text(normalized)
    normalized = _normalize_korean_first_financial_terms(normalized)
    normalized = _normalize_machine_report_text(normalized)
    return _normalize_korean_market_cap_text(normalized)
