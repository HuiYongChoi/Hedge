"""내부자 신호·회사 발언 요약 (종목간 비교용).

종목분석은 에이전트가 원문을 읽지만, 비교 화면은 에이전트를 돌리지 않고
숫자만 나란히 놓는다. 그래서 같은 근거를 표에 넣을 수 있는 형태로 제공한다.
"""

from fastapi import APIRouter, Query

from src.tools.insider_summary import build_disclosure_summary, build_insider_summary

router = APIRouter(prefix="/insider-signals", tags=["insider-signals"])


@router.get("/{ticker}")
def get_insider_signals(
    ticker: str,
    lookback_days: int = Query(180, ge=30, le=1095),
    end_date: str = Query("", description="비우면 오늘"),
) -> dict:
    """재량 내부자 거래 요약 + 최근 실적 공시.

    실패해도 200 으로 응답하고 error 필드로 알린다 — 부가 근거이므로
    비교 화면이 이것 때문에 막히면 안 된다.
    """
    insider = build_insider_summary(
        ticker, end_date=end_date.strip() or None, lookback_days=lookback_days,
    )
    return {**insider, "disclosure": build_disclosure_summary(ticker)}
