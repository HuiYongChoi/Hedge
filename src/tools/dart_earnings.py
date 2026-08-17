"""한국 실적 공시 — DART '연결재무제표기준 영업(잠정)실적(공정공시)'.

미국 8-K Item 2.02(실적 보도자료)의 한국 대응이다. 회사가 분기 실적을 확정 전에
공정공시로 먼저 알리는 문서로, 실적 수치와 전년/전분기 대비 증감, 그리고 회사가
직접 쓴 설명이 들어 있다.

미국과 다른 점
    미국 보도자료에는 CEO/CFO 인용문("…," said …)이 관례적으로 들어가지만,
    한국 공정공시는 표 중심이라 인용문이 거의 없다. 그래서 인용문 추출 대신
    **회사가 쓴 실적 설명 본문**을 그대로 근거로 넘긴다.
"""

from __future__ import annotations

import io
import json
import re
import time
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from typing import Optional

_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
_DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml"
_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

_HTTP_TIMEOUT = 60
_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, "KrEarningsDisclosure"]] = {}

#: 거래소공시(I) 중 실적 공시를 고르는 표현.
_EARNINGS_NAME_RE = re.compile(r"영업\s*\(?잠정\)?\s*실적|손익구조\s*\d+%|매출액또는손익구조")


@dataclass
class KrEarningsDisclosure:
    ticker: str
    company_name: Optional[str] = None
    report_name: Optional[str] = None
    filing_date: Optional[str] = None
    accession: Optional[str] = None
    source_url: Optional[str] = None
    text: str = ""
    char_count: int = 0
    truncated: bool = False
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "company_name": self.company_name,
            "report_name": self.report_name,
            "filing_date": self.filing_date,
            "accession": self.accession,
            "source_url": self.source_url,
            "text": self.text,
            "char_count": self.char_count,
            "truncated": self.truncated,
            "error": self.error,
        }


def _api_key() -> str:
    import os

    return (os.environ.get("DART_API_KEY") or "").strip()


def _http_get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "HyFin Research"})
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
        return response.read()


def fetch_latest_kr_earnings(ticker: str, budget: int = 4000) -> KrEarningsDisclosure:
    """최신 영업(잠정)실적 공정공시 원문을 가져온다. 실패해도 예외를 던지지 않는다."""
    from src.tools.dart_filings import (
        _read_main_document,
        get_corp_code,
        normalize_kr_code,
        xml_to_text,
    )

    code = normalize_kr_code(ticker)
    cache_key = f"KR-EARN:{code}:{budget}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = KrEarningsDisclosure(ticker=(ticker or "").strip().upper())
    if not code or not _api_key():
        result.error = "DART_API_KEY not configured or not a KR ticker"
        _cache[cache_key] = (time.time(), result)
        return result

    try:
        corp_code = get_corp_code(code)
        if not corp_code:
            result.error = "DART corp_code not found"
            _cache[cache_key] = (time.time(), result)
            return result

        listing = json.loads(_http_get(_LIST_URL, {
            "crtfc_key": _api_key(),
            "corp_code": corp_code,
            "bgn_de": time.strftime("%Y%m%d", time.gmtime(time.time() - 400 * 86400)),
            "pblntf_ty": "I",        # 거래소공시 — 실적 공정공시가 여기 들어간다
            "page_count": "100",
        }).decode("utf-8"))
        if listing.get("status") != "000":
            result.error = f"DART list error: {listing.get('status')}"
            _cache[cache_key] = (time.time(), result)
            return result

        # 최신순으로 훑되 정정공시([기재정정])보다 원공시를 우선한다.
        rows = listing.get("list") or []
        candidates = [r for r in rows if _EARNINGS_NAME_RE.search(r.get("report_nm", ""))]
        entry = next((r for r in candidates if "정정" not in r.get("report_nm", "")), None)
        entry = entry or (candidates[0] if candidates else None)
        if entry is None:
            result.error = "No earnings disclosure found in recent filings"
            _cache[cache_key] = (time.time(), result)
            return result

        rcept_no = entry["rcept_no"]
        result.company_name = entry.get("corp_name")
        result.report_name = (entry.get("report_nm") or "").strip()
        result.filing_date = entry.get("rcept_dt")
        result.accession = rcept_no
        result.source_url = _VIEWER_URL.format(rcept_no=rcept_no)

        payload = _http_get(_DOCUMENT_URL, {"crtfc_key": _api_key(), "rcept_no": rcept_no})
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            raw = _read_main_document(archive, rcept_no)
        text = xml_to_text(raw)
        result.char_count = len(text)
        result.truncated = len(text) > budget
        result.text = text[:budget].strip()
        if not result.text:
            result.error = "Disclosure fetched but text was empty"
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    _cache[cache_key] = (time.time(), result)
    return result


def build_kr_earnings_context(disclosure: KrEarningsDisclosure) -> str:
    """LLM 프롬프트에 넣을 '회사가 직접 알린 실적' 블록. 없으면 빈 문자열."""
    if not disclosure.text:
        return ""
    return (
        f"[MANAGEMENT SAID — {disclosure.company_name or disclosure.ticker} "
        f"{disclosure.report_name or '실적 공시'}, {disclosure.filing_date}]\n"
        f"URL: {disclosure.source_url}\n"
        "아래는 회사가 금융감독원에 직접 제출한 실적 공시 원문이다. 실적·전망을 "
        "언급할 때는 이 안의 내용만 쓰고, 없는 수치는 `제공된 자료에서 확인 불가` 로 표기하라.\n"
        f"\n{disclosure.text}"
    )
