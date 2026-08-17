"""DART 사업보고서/분기보고서 원문 수집 + 섹션 파싱 (한국).

sec_filings.py 의 한국판. 같은 목적 — 에이전트가 "제공된 자료"만 근거로 쓰도록
실제 공시 원문을 프롬프트에 넣는다.

미국 10-K 와의 섹션 대응
  US Item 1  (Business)      ↔ KR II. 사업의 내용
  US Item 7  (MD&A)          ↔ KR IV. 이사의 경영진단 및 분석의견
  US Item 1A (Risk Factors)  ↔ 독립 섹션이 없어 '위험관리 및 파생거래'(사업위험)와
                                '재무·금융위험관리'(주석)를 합성해 만든다

설계 메모
- 외부 파서 의존성 없이 표준 라이브러리만 사용한다(sec_filings.py 와 동일 방침).
- document.xml API 는 ZIP(본문 + 감사보고서 등 첨부)을 돌려준다. 첫 파일이
  본문이라는 보장이 없어 '{rcept_no}.xml' 우선, 없으면 최대 크기 파일을 고른다.
- 기존 src/tools/dart_api.py 는 '재무제표' 용도라 서술 원문이 없다. 그래서 별도 모듈.
"""

from __future__ import annotations

import html
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
import zipfile
from typing import Optional

from src.tools.filing_types import FilingSection, FilingSections

_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
_DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml"
_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

_HTTP_TIMEOUT = 60
_CACHE_TTL = 6 * 60 * 60

_corp_code_cache: tuple[float, dict[str, str]] | None = None
_filing_cache: dict[str, tuple[float, FilingSections]] = {}

#: 정기공시에서 고를 보고서 종류
ANNUAL_REPORT = "사업보고서"
QUARTERLY_REPORTS = ("분기보고서", "반기보고서")


def _api_key() -> str:
    return (os.environ.get("DART_API_KEY") or "").strip()


def _http_get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "HyFin Research"})
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
        return response.read()


def normalize_kr_code(ticker: str) -> Optional[str]:
    """'005930.KS', '005930', '삼성전자(005930)' → '005930'."""
    match = re.search(r"\d{6}", ticker or "")
    return match.group(0) if match else None


def get_corp_code(stock_code: str) -> Optional[str]:
    """종목코드(6자리) → DART corp_code(8자리). 공식 매핑 ZIP 을 캐시해 쓴다."""
    global _corp_code_cache
    code = normalize_kr_code(stock_code)
    if not code or not _api_key():
        return None

    now = time.time()
    if _corp_code_cache is None or now - _corp_code_cache[0] > _CACHE_TTL:
        try:
            payload = _http_get(_CORP_CODE_URL, {"crtfc_key": _api_key()})
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                xml = archive.read(archive.namelist()[0]).decode("utf-8", errors="ignore")
            mapping: dict[str, str] = {}
            for block in re.finditer(r"<list>(.*?)</list>", xml, re.S):
                body = block.group(1)
                corp = re.search(r"<corp_code>\s*(\d+)\s*</corp_code>", body)
                stock = re.search(r"<stock_code>\s*(\d{6})\s*</stock_code>", body)
                if corp and stock:
                    mapping[stock.group(1)] = corp.group(1)
            _corp_code_cache = (now, mapping)
        except Exception:
            if _corp_code_cache is None:
                return None
    return _corp_code_cache[1].get(code)


def _read_main_document(archive: zipfile.ZipFile, rcept_no: str) -> str:
    """ZIP 안에서 '본문' XML 을 고른다.

    document.xml 은 본문 + 첨부(감사보고서·재무제표)를 함께 담는다. 첫 파일을
    그냥 읽으면 회사에 따라 첨부를 본문으로 오인한다(실측: 삼성전자는 첫 파일이
    본문이었지만 SK하이닉스·NAVER 는 첨부가 먼저였다).
    본문 파일명은 보통 '{rcept_no}.xml' 이고, 아니면 가장 큰 파일이 본문이다.
    """
    names = archive.namelist()
    if not names:
        return ""
    exact = f"{rcept_no}.xml"
    for name in names:
        if name.rsplit("/", 1)[-1].lower() == exact.lower():
            return archive.read(name).decode("utf-8", errors="ignore")
    largest = max(names, key=lambda n: archive.getinfo(n).file_size)
    return archive.read(largest).decode("utf-8", errors="ignore")


def xml_to_text(raw_xml: str) -> str:
    """공시 XML → 평문. 표준 라이브러리만 사용한다."""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw_xml)
    # 블록 종료 태그를 줄바꿈으로 — 섹션 제목이 줄 단위로 잡히게 한다
    text = re.sub(r"(?i)<br\s*/?>|</P>|</TD>|</TR>|</TITLE>|</SECTION-?\d?>", " \n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


#: 대제목은 ASCII 로마숫자(I, II, III…)로 매겨진다. 본문 안 표 제목은 전각(Ⅰ,Ⅱ)을 쓰므로
#: ASCII 만 잡으면 소제목 오탐을 피할 수 있다(실측 확인).
_KR_HEADING_RE = re.compile(
    r"(?m)^\s*(I{1,3}|IV|VI{0,3}|V|IX|XI{0,2}|X)\s*[.．]\s*(.{2,40})$"
)

#: 우리가 뽑을 섹션 — 미국 Item 과 같은 키로 맞춰 프롬프트 형식을 통일한다.
_KR_SECTION_SPECS = (
    ("1", "사업의 내용", re.compile(r"사업의\s*내용")),
    ("7", "이사의 경영진단 및 분석의견 (MD&A)", re.compile(r"이사의\s*경영진단")),
)

#: 한국 사업보고서에는 미국 Item 1A 같은 '독립 리스크 섹션'이 없다. 대신 위험 서술이
#: 두 군데로 흩어져 있어(실측: 삼성전자·SK하이닉스·NAVER·현대차 공통) 이를 모아
#: Item 1A 에 해당하는 섹션을 합성한다.
#:   - 사업의 내용 안 "5. 위험관리 및 파생거래"  → 사업/시장 위험
#:   - 재무제표 주석 "재무위험관리 / 금융위험관리" → 환·이자율·신용·유동성 위험
_KR_RISK_HEADING_RE = re.compile(
    r"(?m)^\s*\d{1,2}\s*[.．]\s*.{0,40}?(?:위험관리|리스크\s*관리)"
)
#: 같은 레벨(숫자) 소제목 또는 상위 로마숫자 제목이 나오면 그 소절은 끝난다.
_KR_SUBHEADING_RE = re.compile(r"(?m)^\s*\d{1,2}\s*[.．]\s*\S")
_KR_MIN_RISK_BLOCK = 300

#: 미국은 위임장(DEF 14A)으로 경영진 보상을 받아오지만, 한국은 별도 위임장 공시가 없고
#: 사업보고서 'VIII. 임원 및 직원 등에 관한 사항' 안의 보수 표가 그 역할을 한다.
#: 목차에는 '임원의 보수'가 나오지만 '보수총액'은 본문 표에만 나오므로 이를 기준점으로 쓴다.
_KR_COMP_ANCHOR_RE = re.compile(r"보수\s*총액|1인당\s*평균\s*보수액?")
_KR_MIN_COMP_CHARS = 500


def extract_kr_risk_section(text: str, budget: int = 6000) -> Optional[FilingSection]:
    """흩어진 위험 서술을 모아 미국 Item 1A 에 대응하는 섹션을 합성한다.

    같은 내용이 '(연결)'과 별도재무제표 주석에 두 번 실리는 경우가 많아, 앞부분이
    겹치는 블록은 한 번만 담는다.
    """
    bounds = sorted({m.start() for m in _KR_SUBHEADING_RE.finditer(text)}
                    | {m.start() for m in _KR_HEADING_RE.finditer(text)})

    blocks: list[str] = []
    seen_prefixes: set[str] = set()
    total_chars = 0
    for match in _KR_RISK_HEADING_RE.finditer(text):
        start = match.start()
        end = next((b for b in bounds if b > start), len(text))
        if end - start < _KR_MIN_RISK_BLOCK:
            continue
        block = text[start:end].strip()
        # 연결/별도 중복 제거: 제목 뒤 본문 앞부분이 같으면 같은 내용으로 본다
        body_head = re.sub(r"\s+", "", block)[:160]
        if body_head in seen_prefixes:
            continue
        seen_prefixes.add(body_head)
        blocks.append(block)
        total_chars += len(block)

    if not blocks:
        return None

    merged = "\n\n".join(blocks)
    return FilingSection(
        item="1A",
        title="위험관리 (사업위험 + 재무위험 통합)",
        text=merged[:budget].strip(),
        char_count=total_chars,
        truncated=len(merged) > budget,
    )


def extract_kr_compensation(text: str, budget: int = 4000) -> Optional[FilingSection]:
    """사업보고서에서 임원 보수 표를 잘라낸다(미국 DEF 14A 보상 섹션에 대응).

    보수 표는 '임원 및 직원 등에 관한 사항' 섹션 뒤쪽에 있어서 섹션 머리부터
    자르면 직원 현황만 담기고 정작 보수는 잘려나간다. 그래서 표 자체를 가리키는
    '보수총액'을 기준점으로 잡고 그 앞뒤를 취한다.
    """
    match = _KR_COMP_ANCHOR_RE.search(text)
    if match is None:
        return None
    start = max(0, match.start() - 400)
    body = text[start:start + budget].strip()
    if len(body) < _KR_MIN_COMP_CHARS:
        return None
    return FilingSection(
        item="COMP",
        title="임원 보수 (이사·감사 보수현황)",
        text=body,
        char_count=len(body),
        truncated=len(text) - start > budget,
    )


def extract_kr_sections(
    text: str,
    items: tuple[str, ...] = ("1A", "1", "7"),
    budget_per_section: int = 6000,
) -> list[FilingSection]:
    """대제목 경계로 섹션을 잘라낸다."""
    sections: list[FilingSection] = []
    # 보수 표는 대제목 경계가 아니라 표 자체를 기준으로 잡으므로 먼저 처리한다.
    if "COMP" in items:
        compensation = extract_kr_compensation(text, budget=min(budget_per_section, 4000))
        if compensation is not None:
            sections.append(compensation)

    headings = [(m.start(), m.group(2).strip()) for m in _KR_HEADING_RE.finditer(text)]
    if not headings:
        return sections
    starts = [pos for pos, _ in headings]

    if "1A" in items:
        risk = extract_kr_risk_section(text, budget=budget_per_section)
        if risk is not None:
            sections.append(risk)
    for item, title, pattern in _KR_SECTION_SPECS:
        if item not in items:
            continue
        best_pos, best_len = None, 0
        for pos, heading_title in headings:
            if not pattern.search(heading_title):
                continue
            nxt = next((p for p in starts if p > pos), len(text))
            if nxt - pos > best_len:
                best_pos, best_len = pos, nxt - pos
        if best_pos is None or best_len < 2000:
            continue
        body = text[best_pos:best_pos + best_len].strip()
        sections.append(FilingSection(
            item=item,
            title=title,
            text=body[:budget_per_section].strip(),
            char_count=len(body),
            truncated=len(body) > budget_per_section,
        ))
    return sections


def fetch_latest_filing_sections(
    ticker: str,
    form: str = "annual",
    items: tuple[str, ...] = ("1A", "1", "7"),
    budget_per_section: int = 6000,
) -> FilingSections:
    """최신 사업보고서(annual) 또는 분기/반기보고서(quarterly)의 섹션을 추출한다.

    실패해도 예외를 던지지 않는다 — 원문은 부가 근거이므로 분석을 막으면 안 된다.
    """
    code = normalize_kr_code(ticker) or (ticker or "").strip().upper()
    cache_key = f"KR:{code}:{form}:{','.join(items)}:{budget_per_section}"
    cached = _filing_cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = FilingSections(
        ticker=code, market="KR", cik=None, company_name=None, form=None,
        filing_date=None, accession=None, source_url=None,
    )

    if not _api_key():
        result.error = "DART_API_KEY not configured"
        _filing_cache[cache_key] = (time.time(), result)
        return result

    corp_code = get_corp_code(code)
    if not corp_code:
        result.error = "DART corp_code not found for ticker (not a KR listing?)"
        _filing_cache[cache_key] = (time.time(), result)
        return result

    try:
        listing = json.loads(_http_get(_LIST_URL, {
            "crtfc_key": _api_key(),
            "corp_code": corp_code,
            "bgn_de": time.strftime("%Y%m%d", time.gmtime(time.time() - 400 * 86400)),
            "pblntf_ty": "A",     # 정기공시
            "page_count": "20",
        }).decode("utf-8"))
        if listing.get("status") != "000":
            result.error = f"DART list error: {listing.get('status')} {listing.get('message')}"
            _filing_cache[cache_key] = (time.time(), result)
            return result

        wanted = (ANNUAL_REPORT,) if form == "annual" else QUARTERLY_REPORTS
        entry = next(
            (item for item in (listing.get("list") or [])
             if any(name in item.get("report_nm", "") for name in wanted)),
            None,
        )
        if entry is None:
            result.error = f"No {form} report found in recent DART filings"
            _filing_cache[cache_key] = (time.time(), result)
            return result

        rcept_no = entry["rcept_no"]
        result.company_name = entry.get("corp_name")
        result.form = entry.get("report_nm", "").strip()
        result.filing_date = entry.get("rcept_dt")
        result.accession = rcept_no
        result.source_url = _VIEWER_URL.format(rcept_no=rcept_no)

        payload = _http_get(_DOCUMENT_URL, {"crtfc_key": _api_key(), "rcept_no": rcept_no})
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            raw = _read_main_document(archive, rcept_no)
        text = xml_to_text(raw)
        result.sections = extract_kr_sections(text, items=items, budget_per_section=budget_per_section)
        if not result.sections:
            result.error = "Filing fetched but no sections could be located"
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    _filing_cache[cache_key] = (time.time(), result)
    return result
