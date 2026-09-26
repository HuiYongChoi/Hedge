"""종목 하나의 과거 시점 검증 — 그때 공개돼 있던 재무제표와 그날 주가로 판정을 다시 내 본다.

스캐너가 쓰는 무료 데이터(재무 지표·시가총액)는 모두 '오늘 값'이라 과거로 되돌릴 수 없다.
그래서 이 검증은 과거 시점이 보장되는 원천만 쓴다.

· 미국 — SEC companyfacts 에서 제출일(filed)이 검증일 이전인 사실만 남긴 연간 재무제표.
· 한국 — DART 사업보고서(검증일 전년도. 사업보고서는 3월 말까지 제출된다).
· 주가 — 과거 종가. 시가총액은 그날 종가 × 재무제표의 주식 수.

검증일은 최근 5년의 매년 4월 15일(한·미 모두 연간 보고서 제출 뒤)이다. 각 검증일마다
· 우량 — 스캐너와 같은 기준(수익성·성장·재무건전성, 둘 이상 강함·약함 없음).
· 싼가 — 간이 가치평가. 스캐너의 8개 모델 중 과거 재무제표만으로 재현되는 DCF·오너어닝
  2개(스캐너 가중치 23%·22%)만 쓴다. 나머지 모델(EV 배수·PBR 밴드·RIM 등)은 과거 시점의
  시장 배수·추정치가 필요해 빠진다. 따라서 괴리율은 스캐너 값과 다를 수 있다.
그리고 그 뒤 3·6·12개월 수익률을 같은 기간 지수 수익률과 비교한다.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Callable, Optional

from src.screener import sector
from src.screener.track_record import BENCHMARKS, close_on_or_before, forward_return

logger = logging.getLogger(__name__)

YEARS_BACK = 5
CHECK_MONTH_DAY = (4, 15)
RETURN_HORIZONS: tuple[tuple[str, int], ...] = (("3m", 91), ("6m", 182), ("12m", 365))
#: 스캐너와 같은 문턱(src/screener/quality_buy.py).
BUY_GAP = 0.15
WATCH_GAP = -0.10
#: 스캐너 가치평가의 두 모델 가중치(src/agents/valuation.py base_weights).
DCF_WEIGHT, OWNER_WEIGHT = 0.23, 0.22

PriceFn = Callable[[str, str, str], list]


def check_dates(today: date, years: int = YEARS_BACK) -> list[date]:
    """검증일 목록 — 최근 years 년의 4월 15일 중 오늘보다 3개월 이상 지난 날."""
    month, day = CHECK_MONTH_DAY
    dates = [date(today.year - k, month, day) for k in range(years, -1, -1)]
    return [d for d in dates if d + timedelta(days=RETURN_HORIZONS[0][1]) <= today][-years:]


# ── 재무 지표 → 스캐너와 같은 우량 판정 ─────────────────────────────────────


def _ratio(num, den) -> Optional[float]:
    if num is None or den is None or den == 0:
        return None
    return num / den


def _growth(curr, prev) -> Optional[float]:
    if curr is None or prev is None or prev <= 0:
        return None
    return curr / prev - 1


def _axis(checks: list[tuple[Optional[float], float]]) -> str:
    """(값, 문턱) 가운데 문턱을 넘는 항목 수로 강·보통·약을 정한다(에이전트와 같은 규칙)."""
    score = sum(1 for value, threshold in checks if value is not None and value > threshold)
    return "bullish" if score >= 2 else "bearish" if score == 0 else "neutral"


def quality_from_financials(fin: dict) -> dict:
    """펀더멘털 에이전트(src/agents/fundamentals.py)와 같은 문턱으로 세 항목을 판정한다."""
    revenue, net_income = fin.get("revenue"), fin.get("net_income")
    equity = fin.get("shareholders_equity")
    roe = _ratio(net_income, equity) if equity and equity > 0 else None
    net_margin = _ratio(net_income, revenue)
    op_margin = _ratio(fin.get("operating_income"), revenue)
    revenue_growth = _growth(revenue, fin.get("revenue_prev"))
    earnings_growth = _growth(net_income, fin.get("net_income_prev"))
    book_growth = _growth(equity, fin.get("shareholders_equity_prev"))
    current_ratio = _ratio(fin.get("current_assets"), fin.get("current_liabilities"))
    debt_to_equity = _ratio(fin.get("total_debt"), equity) if equity and equity > 0 else None
    shares = fin.get("outstanding_shares")
    fcf = fin.get("free_cash_flow")
    fcf_per_share = _ratio(fcf, shares)
    eps = fin.get("earnings_per_share") or _ratio(net_income, shares)

    health_checks = [
        current_ratio is not None and current_ratio > 1.5,
        debt_to_equity is not None and debt_to_equity < 0.5,
        fcf_per_share is not None and eps is not None and fcf_per_share > eps * 0.8,
    ]
    health_score = sum(health_checks)
    axes = {
        "profitability": _axis([(roe, 0.15), (net_margin, 0.20), (op_margin, 0.15)]),
        "growth": _axis([(revenue_growth, 0.10), (earnings_growth, 0.10), (book_growth, 0.10)]),
        "financial_health": "bullish" if health_score >= 2 else "bearish" if health_score == 0 else "neutral",
    }
    bullish = sum(1 for s in axes.values() if s == "bullish")
    bearish = sum(1 for s in axes.values() if s == "bearish")
    return {
        **axes,
        "bullish": bullish,
        "bearish": bearish,
        "passed": bullish >= 2 and bearish == 0,
        "metrics": {
            "roe": roe, "net_margin": net_margin, "operating_margin": op_margin,
            "revenue_growth": revenue_growth, "earnings_growth": earnings_growth, "book_value_growth": book_growth,
            "current_ratio": current_ratio, "debt_to_equity": debt_to_equity,
        },
    }


def simple_intrinsic_value(fin: dict) -> Optional[float]:
    """DCF·오너어닝 두 모델의 가중평균 적정가(회사 전체 가치). 계산할 수 없으면 None."""
    from src.agents.valuation import calculate_intrinsic_value, calculate_owner_earnings_value

    growth = _growth(fin.get("revenue"), fin.get("revenue_prev"))
    growth = 0.05 if growth is None else max(0.0, min(growth, 0.15))
    fcf = fin.get("free_cash_flow")
    dcf = calculate_intrinsic_value(fcf, growth_rate=growth) if fcf else 0
    owner = calculate_owner_earnings_value(
        net_income=fin.get("net_income"),
        depreciation=fin.get("depreciation_and_amortization") or 0,
        capex=abs(fin.get("capital_expenditure") or 0),
        working_capital_change=0,
        growth_rate=growth,
    )
    parts = [(v, w) for v, w in ((dcf, DCF_WEIGHT), (owner, OWNER_WEIGHT)) if v and v > 0]
    if not parts:
        return None
    return sum(v * w for v, w in parts) / sum(w for _, w in parts)


def verdict_for(quality: dict, gap: Optional[float], financial: bool) -> str:
    if financial:
        return "financial"
    if not quality["passed"]:
        return "not_quality"
    if gap is None:
        return "quality_no_value"
    if gap > BUY_GAP:
        return "buy"
    if gap < WATCH_GAP:
        return "quality_expensive"
    return "watch"


# ── 과거 시점 재무제표 ───────────────────────────────────────────────────────

#: 연간(1년 구간) 값으로 읽는 항목 — 손익·현금흐름과 가중평균 주식 수.
_SEC_FLOW = ("revenue", "operating_income", "net_income", "earnings_per_share", "operating_cash_flow",
             "capital_expenditure", "depreciation_and_amortization", "outstanding_shares")
#: 회계연도 말 시점 값으로 읽는 항목 — 재무상태표.
_SEC_INSTANT = ("shareholders_equity", "current_assets", "current_liabilities", "short_term_debt", "long_term_debt")
_ANNUAL_FORMS = ("10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A")


def _number(value) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _filed_by(fact: dict, cutoff: str) -> bool:
    return str(fact.get("filed") or "9999")[:10] <= cutoff


def annual_flow_values(facts: list[dict], cutoff: str) -> dict[str, float]:
    """회계연도 말일 → 연간 값. cutoff 이전에 제출된 연간 보고서의 1년 구간 값 중 가장 늦게 낸 것.

    SEC 가 붙이는 frame 표시는 '가장 최근 제출분'에 달려 과거 시점으로 자르면 사라지므로 쓰지 않는다.
    """
    by_end: dict[str, tuple[str, float]] = {}
    for fact in facts:
        start, end, value = fact.get("start"), fact.get("end"), _number(fact.get("val"))
        if not start or not end or value is None or fact.get("form") not in _ANNUAL_FORMS or not _filed_by(fact, cutoff):
            continue
        try:
            days = (date.fromisoformat(str(end)[:10]) - date.fromisoformat(str(start)[:10])).days
        except ValueError:
            continue
        if not 350 <= days <= 380:
            continue
        filed = str(fact.get("filed") or "")
        key = str(end)[:10]
        if key not in by_end or filed > by_end[key][0]:
            by_end[key] = (filed, value)
    return {end: value for end, (_, value) in by_end.items()}


def instant_value(facts: list[dict], period_end: str, cutoff: str) -> Optional[float]:
    """period_end 시점의 재무상태표 값(cutoff 이전 제출분 중 가장 늦게 낸 것)."""
    best: Optional[tuple[str, float]] = None
    for fact in facts:
        value = _number(fact.get("val"))
        if value is None or str(fact.get("end") or "")[:10] != period_end or not _filed_by(fact, cutoff):
            continue
        filed = str(fact.get("filed") or "")
        if best is None or filed > best[0]:
            best = (filed, value)
    return best[1] if best else None


def sec_financials_as_of(companyfacts: dict, as_of: date, candidates: Callable[[dict, str], list[dict]]) -> Optional[dict]:
    """as_of 에 공개돼 있던 가장 최근 연간 재무제표와 그 전년도 값."""
    cutoff = as_of.isoformat()
    flows = {field: annual_flow_values(candidates(companyfacts, field), cutoff) for field in _SEC_FLOW}
    anchor = flows["revenue"] or flows["net_income"]
    if not anchor:
        return None
    period_end = max(anchor)
    earlier = [end for end in anchor if end < period_end and
               300 <= (date.fromisoformat(period_end) - date.fromisoformat(end)).days <= 430]
    prev_end = max(earlier) if earlier else None

    fin: dict = {field: flows[field].get(period_end) for field in _SEC_FLOW}
    for field in _SEC_INSTANT:
        fin[field] = instant_value(candidates(companyfacts, field), period_end, cutoff)
    fin["revenue_prev"] = flows["revenue"].get(prev_end) if prev_end else None
    fin["net_income_prev"] = flows["net_income"].get(prev_end) if prev_end else None
    fin["shareholders_equity_prev"] = (
        instant_value(candidates(companyfacts, "shareholders_equity"), prev_end, cutoff) if prev_end else None
    )
    debt = [fin.get("short_term_debt"), fin.get("long_term_debt")]
    fin["total_debt"] = sum(d or 0 for d in debt) if any(d is not None for d in debt) else None
    if fin.get("operating_cash_flow") is not None and fin.get("capital_expenditure") is not None:
        fin["free_cash_flow"] = fin["operating_cash_flow"] - abs(fin["capital_expenditure"])
    fin["report_period"] = period_end
    return fin


def us_financials_as_of(ticker: str, as_of: date) -> Optional[dict]:
    from src.tools import api

    companyfacts = api._fetch_sec_companyfacts(ticker)
    if not companyfacts:
        return None
    return sec_financials_as_of(companyfacts, as_of, api._sec_fact_candidates)


def kr_financials_as_of(ticker: str, as_of: date) -> Optional[dict]:
    from src.tools import dart_api

    corp_code = dart_api._get_corp_code(ticker.split(".")[0])
    if not corp_code:
        return None
    # 4월 15일 기준 — 전년도 사업보고서는 3월 말까지 제출돼 있다.
    fiscal_year = as_of.year - 1 if as_of >= date(as_of.year, 4, 1) else as_of.year - 2
    curr = dart_api._extract_financials(dart_api._fetch_dart_fs(corp_code, fiscal_year))
    if not curr or curr.get("revenue") is None:
        return None
    prev = dart_api._extract_financials(dart_api._fetch_dart_fs(corp_code, fiscal_year - 1)) or {}
    fin = dict(curr)
    fin["revenue_prev"] = curr.get("revenue_prev") or prev.get("revenue")
    fin["net_income_prev"] = curr.get("net_income_prev") or prev.get("net_income")
    fin["shareholders_equity_prev"] = prev.get("shareholders_equity")
    fin["report_period"] = f"{fiscal_year}-12-31"
    return fin


def financials_as_of(ticker: str, market: str, as_of: date) -> Optional[dict]:
    try:
        return (kr_financials_as_of if market == "KR" else us_financials_as_of)(ticker, as_of)
    except Exception as exc:  # 한 검증일의 실패가 전체를 멈추면 안 된다
        logger.debug("point-in-time financials failed for %s @ %s: %s", ticker, as_of, exc)
        return None


# ── 검증 실행 ────────────────────────────────────────────────────────────────


def check_history(
    ticker: str,
    market: str,
    today: date,
    *,
    industry: Optional[str] = None,
    financials_fn: Optional[Callable[[str, str, date], Optional[dict]]] = None,
    price_fn: Optional[PriceFn] = None,
) -> dict:
    """최근 5년 검증일마다 판정을 다시 내고, 그 뒤 수익률을 지수와 비교한다."""
    if price_fn is None:
        from src.tools.api import free_sources_only, get_prices

        def price_fn(t, start, end):
            with free_sources_only():
                return get_prices(t, start, end)

    financials_fn = financials_fn or financials_as_of
    dates = check_dates(today)
    financial = sector.is_financial_misfit(industry)
    bench = BENCHMARKS.get(market, "SPY")
    start = (dates[0] - timedelta(days=14)).isoformat() if dates else today.isoformat()
    stock_prices = price_fn(ticker, start, today.isoformat()) or []
    bench_prices = price_fn(bench, start, today.isoformat()) or []

    checkpoints = []
    for as_of in dates:
        row: dict = {"as_of": as_of.isoformat(), "verdict": None, "note": None}
        fin = financials_fn(ticker, market, as_of)
        close = close_on_or_before(stock_prices, as_of)
        if not fin:
            row["note"] = "그 시점의 재무제표를 찾지 못함"
            checkpoints.append(row)
            continue
        quality = quality_from_financials(fin)
        shares = fin.get("outstanding_shares")
        market_cap = close * shares if close and shares else None
        value = simple_intrinsic_value(fin) if market_cap else None
        gap = value / market_cap - 1 if value and market_cap else None
        row.update({
            "report_period": fin.get("report_period"),
            "price": close,
            "gap": gap,
            "quality": {k: quality[k] for k in ("profitability", "growth", "financial_health", "passed")},
            "metrics": quality["metrics"],
            "verdict": verdict_for(quality, gap, financial),
            "returns": {},
        })
        if close is None:
            row["note"] = "그날 주가를 찾지 못함"
        for name, days in RETURN_HORIZONS:
            if as_of + timedelta(days=days) > today:
                continue
            ret = forward_return(stock_prices, as_of, days)
            bench_ret = forward_return(bench_prices, as_of, days)
            row["returns"][name] = {
                "return": ret,
                "benchmark": bench_ret,
                "excess": ret - bench_ret if ret is not None and bench_ret is not None else None,
            }
        checkpoints.append(row)

    buys = [c for c in checkpoints if c.get("verdict") == "buy" and (c.get("returns") or {}).get("12m")]
    excess_12m = [c["returns"]["12m"]["excess"] for c in buys if c["returns"]["12m"]["excess"] is not None]
    return {
        "ticker": ticker,
        "market": market,
        "benchmark": bench,
        "method": "point_in_time_simple",
        "checkpoints": checkpoints,
        "buy_summary": {
            "n": len(excess_12m),
            "avg_excess_12m": sum(excess_12m) / len(excess_12m) if excess_12m else None,
            "beat_rate_12m": sum(1 for x in excess_12m if x > 0) / len(excess_12m) if excess_12m else None,
        },
    }
