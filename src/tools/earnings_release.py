"""실적 보도자료(경영진 직접 발언) 수집 — 미국 SEC 8-K Item 2.02.

왜 어닝콜 트랜스크립트가 아니라 8-K 인가
  어닝콜 Q&A 전문은 유료 API/유료 사이트에만 있어 안정적으로 못 쓴다(실측: 현재
  사용 중인 데이터 API 에 트랜스크립트 엔드포인트 없음 — 전부 404).
  대신 8-K Item 2.02("Results of Operations and Financial Condition")에 첨부되는
  EX-99.1 실적 보도자료는

    · 회사가 SEC 에 **직접 제출**한 공식 문서(법적 책임이 따른다)
    · CEO/CFO 인용문이 그대로 들어 있다
    · 다음 분기 Outlook(가이던스)이 들어 있다
    · EDGAR 에서 무료로 안정적으로 받을 수 있다

  잃는 것은 애널리스트 Q&A 공방뿐이고, "회사가 직접 한 말"이라는 그라운딩 원칙에는
  오히려 더 잘 맞는다(구두 발언보다 공식 제출 문서가 강하다).

한국·일본
  DART 에는 어닝콜/실적 보도자료에 해당하는 정기 공시가 없다. 대신 분기·사업보고서의
  '이사의 경영진단 및 분석의견'이 경영진 자신의 서술이라 이미 filings 파이프라인에서
  수집하고 있다. 일본도 有価証券報告書의 경영자 분석이 같은 역할을 한다.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from src.tools.sec_filings import (
    _ARCHIVE_URL,
    _SUBMISSIONS_URL,
    _http_get,
    get_cik_for_ticker,
    html_to_text,
)

_INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json"
_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, "EarningsRelease"]] = {}

#: 8-K 항목 2.02 = 경영성과 및 재무상태(=실적 발표). 이 항목이 있는 8-K 만 고른다.
_EARNINGS_ITEM = "2.02"

#: 본문(8-K 표지)이 아니라 첨부된 보도자료를 골라야 경영진 인용문이 나온다.
#: 표지는 보통 '{ticker}-{date}.htm', 보도자료는 그 외 가장 큰 htm 이다.
_SKIP_DOC_PATTERNS = (
    re.compile(r"^R\d+\.htm$", re.I),          # XBRL 뷰어 조각
    re.compile(r"index", re.I),
    re.compile(r"\.xsd$|\.xml$|\.jpg$|\.png$|\.zip$", re.I),
)


@dataclass
class ManagementQuote:
    speaker: str
    text: str


@dataclass
class EarningsRelease:
    ticker: str
    market: str = "US"
    company_name: Optional[str] = None
    filing_date: Optional[str] = None
    accession: Optional[str] = None
    source_url: Optional[str] = None
    text: str = ""                 # 발췌된 보도자료 본문
    char_count: int = 0            # 발췌 전 전체 길이
    truncated: bool = False
    quotes: list[ManagementQuote] = field(default_factory=list)
    outlook_text: str = ""         # Outlook/가이던스 구간
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "market": self.market,
            "company_name": self.company_name,
            "filing_date": self.filing_date,
            "accession": self.accession,
            "source_url": self.source_url,
            "text": self.text,
            "char_count": self.char_count,
            "truncated": self.truncated,
            "quotes": [{"speaker": q.speaker, "text": q.text} for q in self.quotes],
            "outlook_text": self.outlook_text,
            "error": self.error,
        }


#: `"…," said Dr. Lisa Su, AMD chair and CEO.` 형태의 인용을 뽑는다.
#: 보도자료의 경영진 코멘트는 거의 이 패턴을 따른다(실측 확인).
#: 화자 이름에는 마침표가 들어간다(Dr., Jr., A. B.). 마침표를 금지하면
#: "Dr. Lisa Su" 같은 인용이 통째로 누락된다(실측: AMD CEO 인용 미검출).
#: 그래서 이름은 '다음 쉼표까지'로 끊는다 — 쉼표 뒤는 직함이라 화자 식별에 불필요.
_QUOTE_RE = re.compile(
    r"[“\"]([^”\"]{40,600})[”\"]\s*,?\s*said\s+([^,\n]{2,70})",
    re.S,
)

_OUTLOOK_RE = re.compile(
    r"(?i)\b(outlook|guidance|current\s+expectations?\s+for)\b"
)


def extract_quotes(text: str, limit: int = 4) -> list[ManagementQuote]:
    """보도자료에서 경영진 직접 인용문을 뽑는다."""
    quotes: list[ManagementQuote] = []
    seen: set[str] = set()
    for match in _QUOTE_RE.finditer(text):
        body = re.sub(r"\s+", " ", match.group(1)).strip()
        speaker = re.sub(r"\s+", " ", match.group(2)).strip()
        key = body[:80]
        if key in seen:
            continue
        seen.add(key)
        quotes.append(ManagementQuote(speaker=speaker, text=body))
        if len(quotes) >= limit:
            break
    return quotes


def extract_outlook(text: str, budget: int = 1500) -> str:
    """Outlook(다음 분기 가이던스) 구간을 잘라낸다."""
    match = _OUTLOOK_RE.search(text)
    if not match:
        return ""
    start = match.start()
    return re.sub(r"\s+", " ", text[start:start + budget]).strip()


def _pick_press_release_doc(items: list[dict], cover_doc: Optional[str]) -> Optional[str]:
    """8-K 첨부 중 보도자료 문서를 고른다.

    표지(8-K 본문)에는 경영진 발언이 없고 "see Exhibit 99.1" 정도만 있다.
    실제 내용은 첨부 EX-99.1 이며, 보통 그 폴더에서 가장 큰 htm 파일이다.
    """
    candidates = []
    for item in items:
        name = str(item.get("name") or "")
        if not name.lower().endswith((".htm", ".html")):
            continue
        if cover_doc and name.lower() == cover_doc.lower():
            continue
        if any(pattern.search(name) for pattern in _SKIP_DOC_PATTERNS):
            continue
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        candidates.append((size, name))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def fetch_latest_earnings_release(
    ticker: str,
    budget: int = 6000,
    lookback_filings: int = 40,
) -> EarningsRelease:
    """최신 8-K Item 2.02(실적 발표)의 보도자료 원문을 가져온다.

    실패해도 예외를 던지지 않는다 — 원문은 부가 근거이므로 분석을 막으면 안 된다.
    """
    ticker_key = (ticker or "").strip().upper()
    cache_key = f"{ticker_key}:{budget}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = EarningsRelease(ticker=ticker_key)

    cik = get_cik_for_ticker(ticker_key)
    if cik is None:
        result.error = "SEC CIK not found (non-US listing — KR/JP 는 경영진단 섹션을 사용)"
        _cache[cache_key] = (time.time(), result)
        return result

    try:
        submissions = json.loads(_http_get(_SUBMISSIONS_URL.format(cik=cik)).decode("utf-8"))
        result.company_name = submissions.get("name")
        recent = submissions.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        items_col = recent.get("items", [""] * len(forms))

        index = None
        for i, form in enumerate(forms[:lookback_filings]):
            if form != "8-K":
                continue
            # Item 2.02 가 포함된 8-K 만 실적 발표다(인사·계약 8-K 제외).
            if _EARNINGS_ITEM not in (items_col[i] if i < len(items_col) else ""):
                continue
            index = i
            break

        if index is None:
            result.error = "No 8-K with Item 2.02 (earnings) in recent filings"
            _cache[cache_key] = (time.time(), result)
            return result

        accession = recent["accessionNumber"][index]
        cover_doc = recent.get("primaryDocument", [""] * len(forms))[index]
        acc_nodash = accession.replace("-", "")
        result.filing_date = recent["filingDate"][index]
        result.accession = accession

        listing = json.loads(
            _http_get(_INDEX_URL.format(cik=cik, acc=acc_nodash)).decode("utf-8")
        )
        doc = _pick_press_release_doc(
            listing.get("directory", {}).get("item", []), cover_doc
        )
        if not doc:
            result.error = "8-K found but no press-release exhibit could be located"
            _cache[cache_key] = (time.time(), result)
            return result

        result.source_url = _ARCHIVE_URL.format(cik=cik, acc=acc_nodash, doc=doc)
        raw = _http_get(result.source_url).decode("utf-8", errors="ignore")
        text = html_to_text(raw)

        result.char_count = len(text)
        result.truncated = len(text) > budget
        result.text = text[:budget].strip()
        result.quotes = extract_quotes(text)
        result.outlook_text = extract_outlook(text)
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    _cache[cache_key] = (time.time(), result)
    return result


def build_earnings_context(release: EarningsRelease) -> str:
    """LLM 프롬프트에 넣을 '경영진이 직접 한 말' 블록. 없으면 빈 문자열."""
    if not release.quotes and not release.outlook_text:
        return ""
    header = (
        f"[MANAGEMENT SAID — {release.company_name or release.ticker} "
        f"실적 보도자료(SEC 8-K Item 2.02), {release.filing_date}]\n"
        f"URL: {release.source_url}\n"
        "아래는 회사가 SEC 에 직접 제출한 실적 발표 원문이다. 경영진 발언을 인용할 때는 "
        "반드시 이 안에서만 가져와라. 여기에 없는 발언은 `제공된 자료에서 확인 불가` 로 표기하라.\n"
    )
    parts = [header]
    if release.quotes:
        # 원문은 영어다. 번역을 미리 붙여 두면 모델이 영어만 인용해도
        # 우리가 뒤에서 번역을 이어 붙일 수 있다(quote_translation 사전의 재료).
        from src.tools.quote_translation import with_korean_translation

        parts.append("\n--- 경영진 직접 인용 ---")
        quoted = [f'· "{quote.text}" — {quote.speaker}' for quote in release.quotes]
        parts.extend(with_korean_translation(quoted))
    if release.outlook_text:
        parts.append(f"\n--- 전망(Outlook) ---\n{release.outlook_text}")
    return "\n".join(parts)
