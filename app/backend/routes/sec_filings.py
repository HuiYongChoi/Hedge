"""공시 원문 섹션 조회 (미국 SEC / 한국 DART / 일본 EDINET).

리포트의 '원문 추적' 근거를 사용자도 직접 확인할 수 있게 한다.
"""

from fastapi import APIRouter, Query

from src.tools.filings import detect_market, fetch_filing_sections, is_japan_enabled
from src.tools.periodic_filings import list_periodic_filings

router = APIRouter(prefix="/sec-filings", tags=["sec-filings"])


@router.get("/{ticker}")
def get_filing_sections(
    ticker: str,
    period: str = Query("annual", pattern="^(annual|quarterly)$"),
    budget: int = Query(6000, ge=500, le=40000),
    items: str = Query("", description="비우면 시장별 기본 섹션"),
) -> dict:
    """최신 연간/분기 보고서의 섹션 발췌.

    실패해도 200 으로 응답하고 error 필드로 알린다 — 원문은 부가 근거이므로
    화면이 이것 때문에 막히면 안 된다.
    """
    parsed = tuple(part.strip().upper() for part in items.split(",") if part.strip())
    filing = fetch_filing_sections(
        ticker,
        period=period,
        items=parsed or None,
        budget_per_section=budget,
    )
    payload = filing.to_dict()
    market = detect_market(ticker)
    payload["detected_market"] = market
    # 일본은 구독키가 있을 때만 지원 대상으로 표시한다.
    payload["supported"] = market != "JP" or is_japan_enabled()
    return payload


@router.get("/{ticker}/periodic")
def get_periodic_filings(
    ticker: str,
    months: int = Query(12, ge=1, le=60),
    refresh: bool = False,
) -> dict:
    """최근 N개월의 연간·분기 정기공시 목록 (사이드바 '사업보고서' 메뉴).

    원문 본문을 받지 않고 목록만 만든다. 여기도 실패를 200 + error 로 알린다.
    """
    listing = list_periodic_filings(ticker, months=months, force_refresh=refresh)
    return {
        "ticker": listing.ticker,
        "market": listing.market,
        "supported": listing.supported,
        "months": months,
        "source": listing.source,
        "error": listing.error,
        "filings": [
            {
                "id": f.id,
                "title": f.title,
                "date": f.date,
                "kind": f.kind,
                "form": f.form,
                "url": f.url,
            }
            for f in listing.filings
        ],
    }
