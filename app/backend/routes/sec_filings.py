"""SEC 공시 원문 섹션 조회 — 리포트의 '원문 추적' 근거를 사용자도 직접 볼 수 있게 한다."""

from fastapi import APIRouter, Query

from src.tools.sec_filings import fetch_latest_filing_sections

router = APIRouter(prefix="/sec-filings", tags=["sec-filings"])


@router.get("/{ticker}")
def get_filing_sections(
    ticker: str,
    form: str = Query("10-K", pattern="^(10-K|10-Q)$"),
    budget: int = Query(6000, ge=500, le=40000),
    items: str = Query("1A,7"),
) -> dict:
    """최신 10-K/10-Q 의 Item 섹션 발췌.

    실패해도 200 으로 응답하고 error 필드로 알린다 — 원문은 부가 근거이므로
    화면이 이것 때문에 막히면 안 된다.
    """
    parsed_items = tuple(part.strip().upper() for part in items.split(",") if part.strip())
    filing = fetch_latest_filing_sections(
        ticker,
        form=form,
        items=parsed_items or ("1A", "7"),
        budget_per_section=budget,
    )
    return filing.to_dict()
