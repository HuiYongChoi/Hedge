"""공시 원문 섹션의 공용 타입 (미국 SEC / 한국 DART / 일본 EDINET 공통)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class FilingSection:
    """공시 원문에서 잘라낸 한 섹션."""

    item: str          # "1"(사업), "1A"(리스크), "7"(MD&A) — 시장 간 의미를 맞춘 키
    title: str
    text: str          # 발췌된 본문
    char_count: int    # 발췌 전 원본 섹션 길이 — 얼마나 잘렸는지 알려준다
    truncated: bool


@dataclass
class FilingSections:
    ticker: str
    market: str                      # "US" | "KR" | "JP"
    company_name: Optional[str] = None
    form: Optional[str] = None       # "10-K" / "사업보고서" / "有価証券報告書" 등
    filing_date: Optional[str] = None
    accession: Optional[str] = None  # SEC accession / DART rcept_no / EDINET docID
    source_url: Optional[str] = None
    cik: Optional[int] = None        # 미국 전용
    sections: list[FilingSection] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "market": self.market,
            "cik": self.cik,
            "company_name": self.company_name,
            "form": self.form,
            "filing_date": self.filing_date,
            "accession": self.accession,
            "source_url": self.source_url,
            "sections": [
                {
                    "item": s.item,
                    "title": s.title,
                    "text": s.text,
                    "char_count": s.char_count,
                    "truncated": s.truncated,
                }
                for s in self.sections
            ],
            "error": self.error,
        }
