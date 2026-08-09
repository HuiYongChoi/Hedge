"""EDINET 有価証券報告書 원문 수집 + 섹션 파싱 (일본).

주의: EDINET API v2 는 **구독키(Subscription-Key)** 가 있어야 동작한다.
키 없이 호출하면 401 `Access denied due to invalid subscription key` 가 돌아온다.
키를 EDINET_API_KEY 환경변수에 넣으면 이 모듈이 자동으로 활성화된다.
키가 없으면 조용히 원문 없이 진행한다(분석 자체는 막지 않는다).

발급 방법은 docs/filings/EDINET_SETUP.md 참고.

섹션 대응
  US Item 1  (Business) ↔ JP 第一部 第2 事業の状況 / 事業の内容
  US Item 1A (Risk)     ↔ JP 事業等のリスク
  US Item 7  (MD&A)     ↔ JP 経営者による財政状態、経営成績及びキャッシュ・フローの状況の分析 (MD&A)
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

_DOCUMENTS_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"
_DOCUMENT_URL = "https://api.edinet-fsa.go.jp/api/v2/documents/{doc_id}"
_VIEWER_URL = "https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100{doc_id}"

_HTTP_TIMEOUT = 60
_CACHE_TTL = 6 * 60 * 60
_filing_cache: dict[str, tuple[float, FilingSections]] = {}

#: 有価証券報告書=120, 四半期報告書/半期報告書=140 (EDINET docTypeCode)
ANNUAL_DOC_TYPE = "120"
QUARTERLY_DOC_TYPES = ("140", "160")


def _api_key() -> str:
    return (os.environ.get("EDINET_API_KEY") or "").strip()


def is_configured() -> bool:
    return bool(_api_key())


def _http_get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={
        "User-Agent": "HyFin Research",
        "Ocp-Apim-Subscription-Key": _api_key(),
    })
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
        return response.read()


def normalize_jp_code(ticker: str) -> Optional[str]:
    """'7203.T', '7203' → '7203'. EDINET 은 5자리 증권코드(말미 0)를 쓴다."""
    match = re.search(r"\d{4}", ticker or "")
    return match.group(0) if match else None


def html_to_text(raw: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</td>|</tr>|</h[1-6]>", " \n", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text).replace("\xa0", " ").replace("　", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


#: 일본 보고서의 절 제목. 미국 Item 키에 맞춰 통일한다.
_JP_SECTION_SPECS = (
    ("1", "事業の内容 (Business)", re.compile(r"事業の内容")),
    ("1A", "事業等のリスク (Risk Factors)", re.compile(r"事業等のリスク")),
    ("7", "経営者による分析 (MD&A)", re.compile(r"経営者による(?:財政状態|経営成績)")),
)

_JP_HEADING_RE = re.compile(r"(?m)^\s*(?:第\s*\d+\s*[部節]?\s*)?[\d０-９]{0,2}\s*[.．、]?\s*(.{2,50})$")


def extract_jp_sections(
    text: str,
    items: tuple[str, ...] = ("1A", "7"),
    budget_per_section: int = 6000,
) -> list[FilingSection]:
    """절 제목 위치를 찾아 다음 제목 직전까지를 섹션으로 삼는다."""
    anchors: list[int] = []
    for _, _, pattern in _JP_SECTION_SPECS:
        anchors.extend(m.start() for m in pattern.finditer(text))
    # 섹션 경계 후보: 우리가 아는 절 제목들 + 문서 끝
    anchors = sorted(set(anchors))
    if not anchors:
        return []

    sections: list[FilingSection] = []
    for item, title, pattern in _JP_SECTION_SPECS:
        if item not in items:
            continue
        best_pos, best_len = None, 0
        for match in pattern.finditer(text):
            pos = match.start()
            nxt = next((a for a in anchors if a > pos), len(text))
            if nxt - pos > best_len:
                best_pos, best_len = pos, nxt - pos
        if best_pos is None or best_len < 1500:
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
    items: tuple[str, ...] = ("1A", "7"),
    budget_per_section: int = 6000,
    lookback_days: int = 400,
) -> FilingSections:
    """최신 有価証券報告書(annual) 또는 四半期報告書(quarterly)의 섹션을 추출한다.

    EDINET 은 티커 직접 조회가 없어 날짜별 제출목록을 훑어 증권코드로 찾는다.
    구독키가 없으면 곧바로 error 를 담아 반환한다(분석은 계속된다).
    """
    code = normalize_jp_code(ticker) or (ticker or "").strip().upper()
    cache_key = f"JP:{code}:{form}:{','.join(items)}:{budget_per_section}"
    cached = _filing_cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = FilingSections(ticker=code, market="JP")

    if not _api_key():
        result.error = "EDINET_API_KEY not configured (see docs/filings/EDINET_SETUP.md)"
        _filing_cache[cache_key] = (time.time(), result)
        return result

    wanted_types = (ANNUAL_DOC_TYPE,) if form == "annual" else QUARTERLY_DOC_TYPES
    sec_code5 = f"{code}0"  # EDINET secCode 는 5자리(끝에 0)

    try:
        target = None
        # 제출목록을 최근 날짜부터 거슬러 훑는다. 유가증권보고서는 결산 후 3개월 내 제출.
        for days_ago in range(0, lookback_days, 1):
            day = time.strftime("%Y-%m-%d", time.gmtime(time.time() - days_ago * 86400))
            try:
                listing = json.loads(_http_get(_DOCUMENTS_URL, {"date": day, "type": "2"}).decode("utf-8"))
            except Exception:
                continue
            for entry in listing.get("results") or []:
                if entry.get("secCode") != sec_code5:
                    continue
                if entry.get("docTypeCode") not in wanted_types:
                    continue
                target = entry
                break
            if target:
                break

        if target is None:
            result.error = f"No {form} filing found for secCode {sec_code5} in last {lookback_days} days"
            _filing_cache[cache_key] = (time.time(), result)
            return result

        doc_id = target["docID"]
        result.company_name = target.get("filerName")
        result.form = target.get("docDescription")
        result.filing_date = (target.get("submitDateTime") or "")[:10]
        result.accession = doc_id
        result.source_url = _VIEWER_URL.format(doc_id=doc_id)

        # type=5 는 제출本文(HTML) ZIP
        payload = _http_get(_DOCUMENT_URL.format(doc_id=doc_id), {"type": "5"})
        chunks: list[str] = []
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            for name in archive.namelist():
                if name.lower().endswith((".htm", ".html")):
                    chunks.append(archive.read(name).decode("utf-8", errors="ignore"))
        text = html_to_text("\n".join(chunks))
        result.sections = extract_jp_sections(text, items=items, budget_per_section=budget_per_section)
        if not result.sections:
            result.error = "Filing fetched but no sections could be located"
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    _filing_cache[cache_key] = (time.time(), result)
    return result
