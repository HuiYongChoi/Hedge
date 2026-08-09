"""시장별 공시 원문 디스패처 (미국 SEC / 한국 DART / 일본 EDINET).

호출부(프롬프트 주입, API 라우트)는 이 모듈만 쓰면 되고, 티커가 어느 시장인지에
따라 알맞은 수집기를 고른다. 어떤 시장이든 실패는 예외가 아니라 error 필드로
알린다 — 원문은 부가 근거이므로 분석 자체를 막으면 안 된다.
"""

from __future__ import annotations

from src.tools.filing_types import FilingSections

#: 연간/분기 보고서를 시장별 실제 폼 이름으로 옮긴다.
_FORM_BY_MARKET = {
    "US": {"annual": "10-K", "quarterly": "10-Q"},
    "KR": {"annual": "annual", "quarterly": "quarterly"},
    "JP": {"annual": "annual", "quarterly": "quarterly"},
}

#: 시장별로 뽑을 섹션 기본값. 한국 보고서에는 미국 Item 1A 에 해당하는
#: 독립 리스크 섹션이 없어서 사업의 내용(1) + MD&A(7) 을 쓴다.
_DEFAULT_ITEMS = {
    "US": ("1A", "7"),
    "KR": ("1", "7"),
    "JP": ("1A", "7"),
}


def detect_market(ticker: str) -> str:
    """티커 → 시장. 기존 프론트엔드 판별 규칙과 같은 기준을 쓴다."""
    from src.tools.sec_filings import get_cik_for_ticker  # 지연 임포트(네트워크 모듈)

    value = (ticker or "").strip().upper()
    if not value:
        return "US"
    # 한국: 숫자 6자리 코드(005930, 005930.KS)
    if value.endswith((".KS", ".KQ")) or (value.isdigit() and len(value) == 6):
        return "KR"
    # 일본: .T 접미사 또는 숫자 4자리 코드
    if value.endswith(".T") or (value.isdigit() and len(value) == 4):
        return "JP"
    if any(char >= "가" and char <= "힣" for char in value):
        return "KR"
    return "US"


def fetch_filing_sections(
    ticker: str,
    period: str = "annual",
    items: tuple[str, ...] | None = None,
    budget_per_section: int = 6000,
) -> FilingSections:
    """티커의 최신 공시 원문 섹션. period 는 'annual' 또는 'quarterly'."""
    market = detect_market(ticker)
    resolved_items = items or _DEFAULT_ITEMS.get(market, ("1A", "7"))
    form = _FORM_BY_MARKET.get(market, {}).get(period, period)

    if market == "KR":
        from src.tools.dart_filings import fetch_latest_filing_sections as fetch_kr
        return fetch_kr(ticker, form=form, items=resolved_items, budget_per_section=budget_per_section)
    if market == "JP":
        from src.tools.edinet_filings import fetch_latest_filing_sections as fetch_jp
        return fetch_jp(ticker, form=form, items=resolved_items, budget_per_section=budget_per_section)

    from src.tools.sec_filings import fetch_latest_filing_sections as fetch_us
    return fetch_us(ticker, form=form, items=resolved_items, budget_per_section=budget_per_section)


def build_grounding_context(filing: FilingSections) -> str:
    """LLM 프롬프트에 넣을 원문 발췌 블록. 근거가 없으면 빈 문자열."""
    if not filing.sections:
        return ""
    source_label = {"US": "SEC", "KR": "DART", "JP": "EDINET"}.get(filing.market, filing.market)
    header = (
        f"[SEC FILING SOURCE TEXT — {source_label} · "
        f"{filing.company_name or filing.ticker} {filing.form or ''} "
        f"filed {filing.filing_date or 'N/A'}]\n"
        f"URL: {filing.source_url}\n"
        "아래는 실제 공시 원문 발췌다. 원문 인용·경영진 언급·리스크 서술은 "
        "반드시 이 텍스트 안에서만 가져와라. 여기에 없는 내용은 "
        "`제공된 자료에서 확인 불가` 로 표기하라.\n"
    )
    blocks = [header]
    for section in filing.sections:
        suffix = (
            f" (발췌 {len(section.text):,}자 / 원문 {section.char_count:,}자)"
            if section.truncated else ""
        )
        blocks.append(f"\n--- {section.title}{suffix} ---\n{section.text}")
    return "\n".join(blocks)
