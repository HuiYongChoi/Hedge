"""한국 내부자 거래 — DART 임원·주요주주 특정증권등 소유상황보고서.

미국 Form 4 의 한국판이다. 임원·주요주주는 자사주 보유가 변동하면 보고해야 한다.

왜 요약 API 만으로는 안 되는가 (실측)
    elestock.json 은 증감 수량만 주고 **변동 사유를 주지 않는다**. 사유는 개별 공시
    원문의 '세부변동내역' 표에만 있다. 사유를 안 보면 보상 지급을 매수로 오독한다:

        SK하이닉스 곽노정 사장 +5,878주  → 실제 사유 `자사주상여금(+)`  (매수 아님)
        SK하이닉스 주영표 +304주        → 259주는 `기타(+) 우리사주조합 인출`,
                                          실제 장내매수는 45주뿐

    미국 Form 4 에서 스톡 어워드(A)·증여(G)를 걸러낸 것과 같은 이유로, 여기서도
    장내/장외/시간외 매매만 신호로 쓴다.

원문에서만 얻을 수 있는 것
    · 보고사유 (장내매수/장내매도/자사주상여금/기타…)
    · 변동일  — 접수일(rcept_dt)과 다르다. 여명구 건은 접수 08-11, 실제 거래 08-04.
    · 취득/처분 단가

정정공시
    같은 거래가 원공시와 정정공시로 두 번 나온다(삼성전자 박태훈 1건이 4건으로).
    (보고자, 변동일, 사유)로 중복을 제거하고, 최신 접수분을 우선한다.
"""

from __future__ import annotations

import io
import json
import re
import time
import urllib.parse
import urllib.request
import zipfile
from typing import Optional

from src.data.models import InsiderTrade

_ELESTOCK_URL = "https://opendart.fss.or.kr/api/elestock.json"
_DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml"
_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

_HTTP_TIMEOUT = 30
_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, list[InsiderTrade]]] = {}

#: 공시 1건마다 HTTP 요청이 든다. 삼성전자는 3,395건이라 전수 조회는 불가능하다.
DEFAULT_MAX_FILINGS = 25
#: 충분한 표본이 모이면 조기 종료한다(미국 경로와 같은 기준).
ENOUGH_TRADES = 30
DEFAULT_LIMIT = 40

#: 세부변동내역 한 행: `장내매도(-) 2026년 08월 04일 보통주 9,805 -95 9,710 259,750( 원)`
_ROW_RE = re.compile(
    r"([가-힣A-Za-z0-9·]{2,20})\(([+-])\)\s*"
    r"(\d{4})\s*[년.\-]\s*(\d{1,2})\s*[월.\-]\s*(\d{1,2})\s*일?\s*"
    r"(\S+)\s+"                 # 특정증권등의 종류(보통주 등)
    r"(?:[\d,]+|-)\s+"          # 변동 전
    r"(-?[\d,]+)\s+"            # 증감  ← 신호
    r"(?:[\d,]+|-)\s+"          # 변동 후
    r"([\d,]+|-)"               # 취득/처분 단가
)

#: 재량 거래로 볼 사유. '주식매수선택권행사'가 '매수'를 포함하므로 접두사를 요구한다.
_DISCRETIONARY_RE = re.compile(r"(?:장내|장외|시간외|블록딜|대량)\s*매(?:수|도)")
#: 보상·자본거래·신분변동 등 재량이 아닌 사유.
_MECHANICAL_RE = re.compile(
    r"선택권|상여|배당|증자|감자|상속|증여|우리사주|기타|무상|출자|전환|교환|"
    r"합병|분할|신규|선임|퇴임|스톡|공모|청약|대여|담보|신탁"
)

_AMENDMENT_RE = re.compile(r"정\s*정\s*신\s*고")


def _api_key() -> str:
    import os

    return (os.environ.get("DART_API_KEY") or "").strip()


def _to_float(value: object) -> Optional[float]:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    if not text or text in ("-", "--"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _http_get(url: str, params: dict) -> bytes:
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "HyFin Research"},
    )
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
        return response.read()


def is_discretionary(reason: str) -> bool:
    """장내·장외·시간외 매매만 재량 거래로 본다.

    보상 지급(자사주상여금)·우리사주 인출·옵션 행사는 임원의 판단이 아니라
    제도에 따른 이동이므로 매수/매도 신호로 세면 안 된다.
    """
    text = (reason or "").strip()
    if not text or _MECHANICAL_RE.search(text):
        return False
    return bool(_DISCRETIONARY_RE.search(text))


def parse_detail_rows(text: str) -> list[dict]:
    """공시 원문의 '세부변동내역' 표에서 재량 거래 행만 뽑는다.

    합계 행은 사유 표기가 없어 정규식에 걸리지 않으므로 자연히 제외된다.
    """
    rows: list[dict] = []
    for match in _ROW_RE.finditer(text or ""):
        reason, sign, year, month, day, kind, change, price = match.groups()
        if not is_discretionary(reason):
            continue
        shares = _to_float(change)
        if shares is None or shares == 0:
            continue
        # 사유의 (+)/(-) 를 부호의 최종 근거로 삼는다. 증감 값에 부호가 빠진 공시가 있다.
        shares = -abs(shares) if sign == "-" else abs(shares)
        rows.append({
            "reason": reason,
            "date": f"{year}-{int(month):02d}-{int(day):02d}",
            "kind": kind,
            "shares": shares,
            "price": _to_float(price),
        })
    return rows


def _fetch_document_text(rcept_no: str) -> str:
    payload = _http_get(_DOCUMENT_URL, {"crtfc_key": _api_key(), "rcept_no": rcept_no})
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        if not names:
            return ""
        raw = archive.read(max(names, key=lambda n: archive.getinfo(n).file_size))
    text = re.sub(r"<[^>]+>", " ", raw.decode("utf-8", errors="ignore"))
    return re.sub(r"\s+", " ", text)


def fetch_insider_trades_from_dart(
    ticker: str,
    end_date: Optional[str] = None,
    start_date: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
    max_filings: int = DEFAULT_MAX_FILINGS,
) -> list[InsiderTrade]:
    """DART 임원·주요주주 소유상황보고에서 재량 내부자 거래를 가져온다.

    실패해도 예외를 던지지 않는다 — 이 데이터가 없다고 분석이 멈추면 안 된다.
    """
    from src.tools.dart_filings import get_corp_code, normalize_kr_code

    code = normalize_kr_code(ticker)
    cache_key = f"KR:{code}:{start_date or ''}:{end_date or ''}:{limit}:{max_filings}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    trades: list[InsiderTrade] = []
    if not code or not _api_key():
        _cache[cache_key] = (time.time(), trades)
        return trades

    try:
        corp_code = get_corp_code(code)
        if not corp_code:
            _cache[cache_key] = (time.time(), trades)
            return trades

        payload = json.loads(_http_get(
            _ELESTOCK_URL, {"crtfc_key": _api_key(), "corp_code": corp_code},
        ).decode("utf-8"))
        if payload.get("status") != "000":
            _cache[cache_key] = (time.time(), trades)
            return trades

        ticker_key = (ticker or "").strip().upper()
        seen: set[tuple] = set()
        scanned = 0
        # DART 는 오래된 순으로 주므로 최신부터 보도록 뒤집는다.
        for row in reversed(payload.get("list") or []):
            if len(trades) >= min(limit, ENOUGH_TRADES) or scanned >= max_filings:
                break
            filed = (row.get("rcept_dt") or "").strip()
            if end_date and filed and filed > end_date:
                continue

            scanned += 1
            try:
                text = _fetch_document_text(row.get("rcept_no", ""))
            except Exception:
                continue
            is_amendment = bool(_AMENDMENT_RE.search(text))

            for detail in parse_detail_rows(text):
                # 실제 변동일 기준으로 기간을 거른다(접수일과 최대 수 주 차이가 난다).
                if end_date and detail["date"] > end_date:
                    continue
                if start_date and detail["date"] < start_date:
                    continue
                reporter = (row.get("repror") or "").strip()
                # 정정공시는 같은 거래를 다시 신고한다. 최신 접수분을 먼저 보므로
                # 먼저 만난 쪽(정정본)을 남기고 뒤의 원공시를 버린다.
                key = (reporter, detail["date"], detail["reason"], detail["kind"])
                if key in seen:
                    continue
                seen.add(key)

                registered = (row.get("isu_exctv_rgist_at") or "").strip()
                position = (row.get("isu_exctv_ofcps") or "").strip()
                title_parts = [p for p in (position, registered) if p and p != "-"]
                price = detail["price"]
                trades.append(InsiderTrade(
                    ticker=ticker_key,
                    issuer=(row.get("corp_name") or "").strip() or None,
                    name=reporter or None,
                    title=" · ".join(title_parts) or None,
                    is_board_director=bool(registered) and "비등기" not in registered,
                    transaction_date=detail["date"],
                    transaction_shares=detail["shares"],
                    transaction_price_per_share=price,
                    transaction_value=(detail["shares"] * price) if price else None,
                    shares_owned_before_transaction=None,
                    shares_owned_after_transaction=_to_float(row.get("sp_stock_lmp_cnt")),
                    security_title=(
                        f"{detail['kind']} [{detail['reason']}]"
                        + ("(정정)" if is_amendment else "")
                    ),
                    filing_date=filed,
                ))
    except Exception:
        pass

    _cache[cache_key] = (time.time(), trades)
    return trades
