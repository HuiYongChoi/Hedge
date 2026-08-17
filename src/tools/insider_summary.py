"""내부자 거래·회사 발언을 '종목간 비교'가 쓸 수 있는 요약 수치로 압축한다.

종목분석은 원문 문단을 읽지만, 비교 화면은 종목을 나란히 놓는 표다. 표에 넣으려면
같은 단위로 줄어든 숫자가 필요하다. 그래서 여기서는 세 가지만 뽑는다.

    · 순매수 주식수 — 매수 합계에서 매도 합계를 뺀 값. 방향과 크기를 한 번에 준다.
    · 매수/매도 건수 — 한두 명의 대량 거래가 방향을 지배하는지 보기 위함.
    · 최근 실적 공시일 — 회사가 마지막으로 직접 실적을 밝힌 시점.

미국·한국 모두 '재량 거래'만 집계한다. 스톡 보상과 우리사주 인출은 경영진의
판단이 아니라 제도에 따른 이동이므로 신호로 세면 방향이 뒤집힌다.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

DEFAULT_LOOKBACK_DAYS = 180


def _iso(value: date) -> str:
    return value.strftime("%Y-%m-%d")


def build_insider_summary(
    ticker: str,
    end_date: Optional[str] = None,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> dict:
    """비교 표에 넣을 내부자 신호 요약. 실패해도 예외를 던지지 않는다."""
    from src.tools.api import get_insider_trades
    from src.tools.filings import detect_market

    end = end_date or _iso(date.today())
    try:
        start = _iso(date.fromisoformat(end) - timedelta(days=lookback_days))
    except ValueError:
        end = _iso(date.today())
        start = _iso(date.today() - timedelta(days=lookback_days))

    summary = {
        "ticker": (ticker or "").strip().upper(),
        "market": detect_market(ticker),
        "window_days": lookback_days,
        "start_date": start,
        "end_date": end,
        "net_shares": None,
        "buy_count": 0,
        "sell_count": 0,
        "buy_shares": 0.0,
        "sell_shares": 0.0,
        "distinct_insiders": 0,
        "latest_transaction_date": None,
        "has_data": False,
        "error": None,
    }

    try:
        trades = get_insider_trades(ticker, end_date=end, start_date=start) or []
    except Exception as exc:
        summary["error"] = f"{type(exc).__name__}: {exc}"
        return summary

    names: set[str] = set()
    for trade in trades:
        shares = getattr(trade, "transaction_shares", None)
        if shares is None:
            continue
        if shares > 0:
            summary["buy_count"] += 1
            summary["buy_shares"] += shares
        elif shares < 0:
            summary["sell_count"] += 1
            summary["sell_shares"] += abs(shares)
        else:
            continue
        name = (getattr(trade, "name", None) or "").strip()
        if name:
            names.add(name)
        when = (getattr(trade, "transaction_date", None) or "").strip()
        if when and (summary["latest_transaction_date"] or "") < when:
            summary["latest_transaction_date"] = when

    summary["distinct_insiders"] = len(names)
    if summary["buy_count"] or summary["sell_count"]:
        summary["net_shares"] = summary["buy_shares"] - summary["sell_shares"]
        summary["has_data"] = True
    return summary


def build_disclosure_summary(ticker: str) -> dict:
    """회사가 마지막으로 직접 실적을 밝힌 공시(미국 8-K Item 2.02 / 한국 영업(잠정)실적)."""
    from src.tools.filings import detect_market

    result = {
        "ticker": (ticker or "").strip().upper(),
        "title": None,
        "filing_date": None,
        "source_url": None,
        "has_data": False,
        "error": None,
    }
    try:
        if detect_market(ticker) == "KR":
            from src.tools.dart_earnings import fetch_latest_kr_earnings

            disclosure = fetch_latest_kr_earnings(ticker, budget=1200)
            result.update(
                title=disclosure.report_name,
                filing_date=disclosure.filing_date,
                source_url=disclosure.source_url,
                has_data=bool(disclosure.text),
                error=disclosure.error,
            )
        else:
            from src.tools.earnings_release import fetch_latest_earnings_release

            release = fetch_latest_earnings_release(ticker, budget=1200)
            result.update(
                title="실적 보도자료 (8-K Item 2.02)",
                filing_date=getattr(release, "filing_date", None),
                source_url=getattr(release, "source_url", None),
                has_data=bool(getattr(release, "text", "")),
                error=getattr(release, "error", None),
            )
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result
