"""SEC EDGAR 원문(10-K/10-Q) 수집 + 섹션 파싱.

목적: 에이전트가 "제공된 자료"만 근거로 쓰도록(SOURCE GROUNDING) 실제 공시 원문을
프롬프트에 넣어주기 위한 파이프라인. 원문이 없으면 모델은 자기 기억으로 서술을
채우게 되고, 그게 근거 없는 문장이 나오던 근본 원인이었다.

설계 메모
- 외부 파서 의존성(bs4 등) 없이 표준 라이브러리만 사용한다. 서버 배포 시 새 패키지
  설치가 필요 없도록 하기 위함.
- SEC 는 User-Agent 에 연락처를 요구한다. 없으면 403.
- 10-K 원문은 40만자를 넘는다. 전문을 프롬프트에 넣을 수 없으므로 섹션별로
  잘라 예산(char budget) 안에서 발췌한다.
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

SEC_USER_AGENT = "HyFin Research admin@hyfin.duckdns.org"
_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
_ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"

_HTTP_TIMEOUT = 30
_CACHE_TTL = 6 * 60 * 60  # 공시는 분기 단위로 갱신되므로 길게 잡아도 안전하다

_ticker_map_cache: tuple[float, dict[str, int]] | None = None
_filing_cache: dict[str, tuple[float, "FilingSections"]] = {}


@dataclass
class FilingSection:
    """공시 원문에서 잘라낸 한 섹션."""

    item: str          # "1A", "7" 등
    title: str         # "Risk Factors"
    text: str          # 발췌된 본문
    char_count: int    # 원본 섹션 전체 길이(발췌 전) — 얼마나 잘렸는지 알려준다
    truncated: bool


@dataclass
class FilingSections:
    ticker: str
    cik: Optional[int]
    company_name: Optional[str]
    form: Optional[str]           # "10-K" / "10-Q"
    filing_date: Optional[str]
    accession: Optional[str]
    source_url: Optional[str]
    sections: list[FilingSection] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
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


def _http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={
        "User-Agent": SEC_USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Accept": "*/*",
    })
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
        payload = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            import gzip
            payload = gzip.decompress(payload)
        return payload


def get_cik_for_ticker(ticker: str) -> Optional[int]:
    """티커 → CIK. SEC 의 공식 매핑 파일을 캐시해 쓴다."""
    global _ticker_map_cache
    key = (ticker or "").strip().upper()
    if not key:
        return None

    now = time.time()
    if _ticker_map_cache is None or now - _ticker_map_cache[0] > _CACHE_TTL:
        try:
            raw = json.loads(_http_get(_TICKER_MAP_URL).decode("utf-8"))
            mapping = {
                str(row["ticker"]).upper(): int(row["cik_str"])
                for row in raw.values()
                if row.get("ticker") and row.get("cik_str") is not None
            }
            _ticker_map_cache = (now, mapping)
        except Exception:
            if _ticker_map_cache is None:
                return None
    return _ticker_map_cache[1].get(key)


def html_to_text(raw_html: str) -> str:
    """공시 HTML → 평문. 표준 라이브러리만 사용한다."""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw_html)
    # 블록 종료 태그는 줄바꿈으로 — 헤딩이 줄 단위로 잡히게 한다
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</h[1-6]>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


# 헤딩 후보. 긴 번호(1A/1B/1C/7A)를 먼저 시도해야 "Item 1C"가 "Item 1"로 잘리지 않는다.
_ITEM_RE = re.compile(r"(?i)\bitem\s+(1A|1B|1C|7A|1|2|3|5|7|8)\b\s*[.\-–—:]")

# 본문 헤딩이 아니라 다른 섹션을 가리키는 상호참조. 이것들을 헤딩으로 세면
# 엉뚱한 위치를 섹션 시작으로 잡는다. 단, 진짜 헤딩 앞에 흔히 오는 "PART I"
# (쉼표 없음)은 제외하면 안 되므로 쉼표가 붙은 경우만 걸러낸다.
_XREF_RE = re.compile(
    r"(?i)(?:"
    r"(?:see|refer to|set forth in|described in|included in|under|captions?)\s*[,\"“]?\s*$"
    r"|part\s+[ivx\d]+\s*,\s*[“\"]?\s*$"
    r"|[“\"]\s*$"
    r")"
)

_SECTION_TITLES = {
    "1": "Business",
    "1A": "Risk Factors",
    "7": "Management's Discussion and Analysis (MD&A)",
}


def _heading_candidates(text: str) -> list[tuple[int, str]]:
    return [
        (m.start(), m.group(1).upper())
        for m in _ITEM_RE.finditer(text)
        if not _XREF_RE.search(text[max(0, m.start() - 30):m.start()])
    ]


def extract_item_sections(
    text: str,
    items: tuple[str, ...] = ("1", "1A", "7"),
    budget_per_section: int = 12000,
) -> list[FilingSection]:
    """Item 별 본문을 잘라낸다.

    같은 Item 번호는 목차와 본문에 모두 등장한다. 목차 항목들은 서로 몇십 자
    간격으로 붙어 있으므로, '다음 헤딩까지의 간격이 가장 큰' 등장을 본문으로 본다.
    """
    candidates = _heading_candidates(text)
    if not candidates:
        return []
    starts = [pos for pos, _ in candidates]

    sections: list[FilingSection] = []
    for item in items:
        best_pos, best_len = None, 0
        for pos, num in candidates:
            if num != item:
                continue
            nxt = next((p for p in starts if p > pos), len(text))
            if nxt - pos > best_len:
                best_pos, best_len = pos, nxt - pos
        # 목차 줄만 잡힌 경우(수백 자)는 본문이 아니다
        if best_pos is None or best_len < 2000:
            continue
        body = text[best_pos:best_pos + best_len].strip()
        truncated = len(body) > budget_per_section
        sections.append(FilingSection(
            item=item,
            title=_SECTION_TITLES.get(item, f"Item {item}"),
            text=body[:budget_per_section].strip(),
            char_count=len(body),
            truncated=truncated,
        ))
    return sections


def fetch_latest_filing_sections(
    ticker: str,
    form: str = "10-K",
    items: tuple[str, ...] = ("1", "1A", "7"),
    budget_per_section: int = 12000,
) -> FilingSections:
    """최신 10-K(또는 10-Q)를 받아 지정한 Item 섹션들을 추출한다.

    실패해도 예외를 던지지 않는다 — 원문은 부가 근거이고, 없으면 기존 지표 기반
    분석으로 진행해야 하기 때문이다(error 필드로만 알린다).
    """
    ticker_key = (ticker or "").strip().upper()
    cache_key = f"{ticker_key}:{form}:{','.join(items)}:{budget_per_section}"
    cached = _filing_cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = FilingSections(
        ticker=ticker_key, cik=None, company_name=None, form=None,
        filing_date=None, accession=None, source_url=None,
    )

    cik = get_cik_for_ticker(ticker_key)
    if cik is None:
        result.error = "SEC CIK not found for ticker (non-US listing?)"
        _filing_cache[cache_key] = (time.time(), result)
        return result
    result.cik = cik

    try:
        submissions = json.loads(_http_get(_SUBMISSIONS_URL.format(cik=cik)).decode("utf-8"))
        result.company_name = submissions.get("name")
        recent = submissions.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        index = next((i for i, f in enumerate(forms) if f == form), None)
        if index is None:
            result.error = f"No {form} found in recent filings"
            _filing_cache[cache_key] = (time.time(), result)
            return result

        accession = recent["accessionNumber"][index]
        document = recent["primaryDocument"][index]
        result.form = form
        result.filing_date = recent["filingDate"][index]
        result.accession = accession
        result.source_url = _ARCHIVE_URL.format(
            cik=cik, acc=accession.replace("-", ""), doc=document,
        )

        raw = _http_get(result.source_url).decode("utf-8", errors="ignore")
        text = html_to_text(raw)
        result.sections = extract_item_sections(text, items=items, budget_per_section=budget_per_section)
        if not result.sections:
            result.error = "Filing fetched but no Item sections could be located"
    except Exception as exc:  # 네트워크/포맷 변화 등 — 분석 자체를 막지 않는다
        result.error = f"{type(exc).__name__}: {exc}"

    _filing_cache[cache_key] = (time.time(), result)
    return result


def build_grounding_context(filing: FilingSections, language: str = "ko") -> str:
    """LLM 프롬프트에 넣을 원문 발췌 블록. 근거가 없으면 빈 문자열."""
    if not filing.sections:
        return ""
    header = (
        f"[SEC FILING SOURCE TEXT — {filing.company_name or filing.ticker} "
        f"{filing.form} filed {filing.filing_date}]\n"
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
        blocks.append(
            f"\n--- Item {section.item}. {section.title}{suffix} ---\n{section.text}"
        )
    return "\n".join(blocks)
