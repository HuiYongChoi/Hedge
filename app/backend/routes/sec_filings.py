"""공시 원문 섹션 조회 (미국 SEC / 한국 DART / 일본 EDINET).

리포트의 '원문 추적' 근거를 사용자도 직접 확인할 수 있게 한다.
"""

from fastapi import APIRouter, Query

from src.tools.filings import detect_market, fetch_filing_sections

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
    payload["detected_market"] = detect_market(ticker)
    return payload
