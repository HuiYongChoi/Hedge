"""정기공시 목록 (한국 DART 사업·반기·분기보고서 / 미국 SEC 10-K·10-Q).

리포트 사이드바의 '사업보고서' 메뉴가 쓰는 목록이다. filings.py 는 원문 *본문*을
파싱해 프롬프트에 넣는 쪽이고, 이 모듈은 사용자가 눌러서 원문으로 건너갈 수 있는
*링크 목록*만 만든다 — 그래서 문서 다운로드·파싱을 하지 않고 목록 API 한 번으로 끝난다.

한국 쪽 질의 조건은 Investment Navigator 웹앱에서 검증된 것을 그대로 옮겼다.
  pblntf_ty=A      정기공시만 (사업·반기·분기보고서)
  last_reprt_at=Y  최종 보고서만 — 정정 전 판본이 섞여 같은 기수가 중복되는 것을 막는다
필터 없이 전체 공시를 받으면 100건당 정기공시가 1건꼴이라 페이지를 열 번 넘게
훑어야 한다. 이 저장소는 과거 DART 로부터 IP 차단을 당한 적이 있어 호출량을 키우지 않는다.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Optional

from src.tools.filings import detect_market

_DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
_DART_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"
_SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
_SEC_INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"

_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, "PeriodicFilingList"]] = {}

#: 한국 정기공시 중 목록에 실을 종류. DART 분류(pblntf_ty=A)를 신뢰하되 한 번 더 확인한다.
_KR_ANNUAL = "사업보고서"
_KR_QUARTERLY = ("분기보고서", "반기보고서")

#: 미국 정기공시. 외국계 발행인의 연차보고서(20-F/40-F)도 연간으로 취급한다.
_US_ANNUAL_FORMS = ("10-K", "20-F", "40-F")
_US_QUARTERLY_FORMS = ("10-Q",)


@dataclass
class PeriodicFiling:
    id: str                  # DART rcept_no / SEC accession
    title: str               # 화면에 그대로 쓰는 보고서 이름
    date: str                # 접수일 yyyy-mm-dd
    kind: str                # "annual" | "quarterly"
    form: str                # 사업보고서 / 반기보고서 / 10-K ...
    url: str


@dataclass
class PeriodicFilingList:
    ticker: str
    market: str
    supported: bool
    filings: list[PeriodicFiling] = field(default_factory=list)
    error: Optional[str] = None
    source: Optional[str] = None


def _normalize_date(text: str) -> str:
    """'20260310' → '2026-03-10'. 이미 하이픈이면 그대로."""
    digits = "".join(ch for ch in (text or "") if ch.isdigit())
    if len(digits) != 8:
        return (text or "").strip()
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"


def _window_start(months: int) -> float:
    """지금부터 months 개월 전 시각(초). 월 길이는 30.44일 평균으로 근사한다."""
    return time.time() - months * 30.44 * 86400


def _fetch_kr(ticker: str, months: int) -> PeriodicFilingList:
    from src.tools.dart_filings import _api_key, _http_get, get_corp_code, normalize_kr_code

    code = normalize_kr_code(ticker) or (ticker or "").strip().upper()
    result = PeriodicFilingList(ticker=code, market="KR", supported=True, source="dart")

    if not _api_key():
        result.error = "DART_API_KEY not configured"
        return result

    corp_code = get_corp_code(code)
    if not corp_code:
        result.error = "DART corp_code not found for ticker"
        return result

    try:
        listing = json.loads(_http_get(_DART_LIST_URL, {
            "crtfc_key": _api_key(),
            "corp_code": corp_code,
            "bgn_de": time.strftime("%Y%m%d", time.gmtime(_window_start(months))),
            "end_de": time.strftime("%Y%m%d", time.gmtime()),
            "pblntf_ty": "A",
            "last_reprt_at": "Y",
            "page_count": "100",
            "page_no": "1",
        }).decode("utf-8"))
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"
        return result

    status = listing.get("status")
    if status == "013":       # 조회된 데이터 없음 — 오류가 아니라 빈 목록이다
        return result
    if status != "000":
        result.error = f"DART list error: {status} {listing.get('message')}"
        return result

    seen: set[str] = set()
    for item in listing.get("list") or []:
        name = (item.get("report_nm") or "").strip()
        rcept_no = str(item.get("rcept_no") or "").strip()
        if not rcept_no or rcept_no in seen:
            continue
        if _KR_ANNUAL in name:
            kind, form = "annual", _KR_ANNUAL
        elif any(q in name for q in _KR_QUARTERLY):
            kind = "quarterly"
            form = next(q for q in _KR_QUARTERLY if q in name)
        else:
            continue
        seen.add(rcept_no)
        result.filings.append(PeriodicFiling(
            id=rcept_no,
            title=name,
            date=_normalize_date(item.get("rcept_dt") or ""),
            kind=kind,
            form=form,
            url=_DART_VIEWER_URL.format(rcept_no=rcept_no),
        ))

    result.filings.sort(key=lambda f: f.date, reverse=True)
    return result


def _fetch_us(ticker: str, months: int) -> PeriodicFilingList:
    from src.tools.sec_filings import _http_get, get_cik_for_ticker

    symbol = (ticker or "").strip().upper()
    result = PeriodicFilingList(ticker=symbol, market="US", supported=True, source="sec")

    cik = get_cik_for_ticker(symbol)
    if cik is None:
        result.error = "SEC CIK not found for ticker"
        return result

    try:
        submissions = json.loads(_http_get(_SEC_SUBMISSIONS_URL.format(cik=cik)).decode("utf-8"))
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"
        return result

    recent = (submissions.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accessions = recent.get("accessionNumber") or []
    documents = recent.get("primaryDocument") or []
    report_dates = recent.get("reportDate") or []
    cutoff = time.strftime("%Y-%m-%d", time.gmtime(_window_start(months)))

    for index, form in enumerate(forms):
        if index >= len(dates) or index >= len(accessions):
            continue
        if form in _US_ANNUAL_FORMS:
            kind = "annual"
        elif form in _US_QUARTERLY_FORMS:
            kind = "quarterly"
        else:
            continue
        filed = dates[index]
        if filed < cutoff:
            continue
        accession = accessions[index]
        document = documents[index] if index < len(documents) else ""
        # 목록에서 '어느 기간의 보고서인지'가 보이도록 결산기를 제목에 붙인다
        # (한국 쪽 '사업보고서 (2025.12)' 와 같은 읽는 방식).
        period = report_dates[index] if index < len(report_dates) else ""
        title = f"{form} ({period[:4]}.{period[5:7]})" if len(period) >= 7 else form
        result.filings.append(PeriodicFiling(
            id=accession,
            title=title,
            date=filed,
            kind=kind,
            form=form,
            url=_SEC_INDEX_URL.format(cik=cik, acc=accession.replace("-", ""), doc=document),
        ))

    result.filings.sort(key=lambda f: f.date, reverse=True)
    return result


def list_periodic_filings(
    ticker: str,
    months: int = 12,
    force_refresh: bool = False,
) -> PeriodicFilingList:
    """최근 months 개월의 연간·분기 정기공시 목록 (최신순).

    실패해도 예외를 던지지 않는다 — 부가 링크이므로 화면을 막으면 안 된다.
    """
    symbol = (ticker or "").strip().upper()
    market = detect_market(symbol)
    cache_key = f"{market}:{symbol}:{months}"

    now = time.time()
    cached = _cache.get(cache_key)
    if not force_refresh and cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    if market == "KR":
        result = _fetch_kr(symbol, months)
    elif market == "US":
        result = _fetch_us(symbol, months)
    else:
        # 일본(EDINET)은 목록 API 구독 조건이 달라 아직 붙이지 않았다.
        result = PeriodicFilingList(
            ticker=symbol, market=market, supported=False,
            error="Periodic filing list is not available for this market yet",
        )

    _cache[cache_key] = (now, result)
    return result
