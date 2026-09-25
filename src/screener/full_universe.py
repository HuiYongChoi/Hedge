"""전체 지수 스캔용 종목 목록 — S&P 500 전 종목, 코스피 전 종목(보통주).

고정 목록(universe.py)은 대형주 50개뿐이라, 지수 전체를 훑을 때는 스캔하는 시점의
구성 종목을 서버가 직접 받아 온다. 구성은 수시로 바뀌므로 코드에 박아 두지 않는다.

· S&P 500 — 위키백과 구성 종목 표(표 id "constituents").
· 코스피 — 네이버 증권(모바일 JSON → 시가총액 페이지) → KRX KIND 상장법인 목록 →
  pykrx 순으로 시도한다. 우선주는 뺀다.

받아 온 목록은 하루 동안 기억한다. 받지 못하면 빈 목록 대신 예외를 올려,
호출한 쪽이 '목록을 못 받았다'는 사실을 그대로 알리게 한다.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

from src.screener.universe import LARGE_CAP_UNIVERSE, UniverseEntry

logger = logging.getLogger(__name__)

SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
NAVER_KOSPI_URL = "https://finance.naver.com/sise/sise_market_sum.naver"
NAVER_MOBILE_KOSPI_URL = "https://m.stock.naver.com/api/stocks/marketValue/KOSPI"
KIND_CORP_LIST_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do"
#: 코스피 상장사는 900여 개(50개씩 19페이지 안팎). 사이트 구조가 바뀌어 끝을 못 찾아도
#: 무한히 돌지 않게 상한을 둔다.
NAVER_MAX_PAGES = 40
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

# 고정 목록에 있는 종목은 한글 이름을 그대로 쓴다.
_KNOWN_NAMES = {entry["ticker"]: entry["name"] for entry in LARGE_CAP_UNIVERSE}

_cache: dict[str, tuple[str, list[UniverseEntry]]] = {}


class UniverseFetchError(RuntimeError):
    """지수 구성 종목을 받아 오지 못했다."""


def parse_sp500(html: str) -> list[UniverseEntry]:
    """위키백과 S&P 500 표에서 (티커, 회사명)을 읽는다."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="constituents")
    if table is None:
        raise UniverseFetchError("S&P 500 구성 종목 표를 찾지 못했습니다")
    entries: list[UniverseEntry] = []
    seen: set[str] = set()
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue  # 머리글 행
        ticker = cells[0].get_text(strip=True).upper()
        name = cells[1].get_text(strip=True)
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        entries.append({"ticker": ticker, "name": _KNOWN_NAMES.get(ticker, name), "market": "US"})
    return entries


_NAVER_CODE = re.compile(r"code=([0-9A-Z]{6})")
_NAVER_LAST_PAGE = re.compile(r"page=(\d+)")


def parse_naver_kospi_page(html: str) -> tuple[list[UniverseEntry], int | None]:
    """네이버 시가총액 순위 한 페이지 → (보통주 목록, 마지막 페이지 번호)."""
    soup = BeautifulSoup(html, "html.parser")
    links = soup.select("table.type_2 a.tltle") or soup.select('a[href*="/item/main"][href*="code="]')
    entries: list[UniverseEntry] = []
    for link in links:
        match = _NAVER_CODE.search(link.get("href", ""))
        entry = _kr_entry(match.group(1), link.get_text(strip=True)) if match else None
        if entry:
            entries.append(entry)

    last_page = None
    last_link = soup.select_one("td.pgRR a")
    if last_link is not None:
        match = _NAVER_LAST_PAGE.search(last_link.get("href", ""))
        last_page = int(match.group(1)) if match else None
    return entries, last_page


def _get(url: str, **params) -> requests.Response:
    response = requests.get(url, params=params or None, headers=_HEADERS, timeout=15)
    response.raise_for_status()
    return response


def fetch_sp500() -> list[UniverseEntry]:
    entries = parse_sp500(_get(SP500_URL).text)
    if len(entries) < 400:  # 표가 잘렸거나 구조가 바뀌었다
        raise UniverseFetchError(f"S&P 500 구성 종목이 {len(entries)}개뿐입니다")
    return entries


def _kr_entry(code: str, name: str) -> UniverseEntry | None:
    """6자리 코드 → 보통주 항목. 우선주(끝자리 0 아님)·잘못된 코드는 None."""
    code = code.strip().zfill(6)
    # 보통주 코드는 숫자 6자리이고 끝자리가 0 이다(우선주는 5·7·9·K 등).
    if not (len(code) == 6 and code.isdigit() and code.endswith("0")):
        return None
    ticker = f"{code}.KS"
    return {"ticker": ticker, "name": _KNOWN_NAMES.get(ticker, name.strip()), "market": "KR"}


def _page_hint(text: str) -> str:
    """진단용 — 받은 페이지가 무엇이었는지 한 줄로."""
    title = re.search(r"<title[^>]*>(.*?)</title>", text or "", re.S | re.I)
    return f"{len(text or '')}자, 제목 '{title.group(1).strip()[:40] if title else '-'}'"


def _kospi_from_naver_mobile() -> list[UniverseEntry]:
    """네이버 증권 모바일 JSON(시가총액 순, 페이지당 100)."""
    entries: list[UniverseEntry] = []
    for page in range(1, NAVER_MAX_PAGES + 1):
        data = _get(NAVER_MOBILE_KOSPI_URL, page=page, pageSize=100).json()
        stocks = data.get("stocks") or []
        for item in stocks:
            # ETF·ETN 은 빼고 주식만(구분 필드가 없으면 코드로만 거른다).
            if item.get("stockEndType") not in (None, "stock"):
                continue
            entry = _kr_entry(str(item.get("itemCode", "")), str(item.get("stockName", "")))
            if entry:
                entries.append(entry)
        total = data.get("totalCount")
        if not stocks or (isinstance(total, int) and page * 100 >= total):
            break
        time.sleep(0.2)  # 사이트에 부담을 주지 않게
    return entries


def _kospi_from_naver_desktop() -> list[UniverseEntry]:
    """네이버 금융 시가총액 순위 페이지(페이지당 50)."""
    entries: list[UniverseEntry] = []
    page, last_page = 1, None
    while page <= (last_page or NAVER_MAX_PAGES):
        response = _get(NAVER_KOSPI_URL, sosok=0, page=page)
        response.encoding = "euc-kr"
        rows, found_last = parse_naver_kospi_page(response.text)
        if page == 1 and not rows:
            raise UniverseFetchError(f"종목 표 없음({_page_hint(response.text)})")
        last_page = last_page or found_last
        if not rows:
            break
        entries.extend(rows)
        page += 1
        time.sleep(0.2)
    return entries


def parse_kind_corp_list(html: str) -> list[UniverseEntry]:
    """KRX KIND 상장법인 목록(유가증권시장) — 회사명 첫 칸, 6자리 종목코드 칸."""
    soup = BeautifulSoup(html, "html.parser")
    entries: list[UniverseEntry] = []
    for row in soup.find_all("tr"):
        cells = [cell.get_text(strip=True) for cell in row.find_all("td")]
        if len(cells) < 2:
            continue
        code = next((c for c in cells[1:] if re.fullmatch(r"\d{1,6}", c)), None)
        entry = _kr_entry(code, cells[0]) if code else None
        if entry:
            entries.append(entry)
    return entries


def _kospi_from_kind() -> list[UniverseEntry]:
    response = _get(KIND_CORP_LIST_URL, method="download", marketType="stockMkt")
    response.encoding = "euc-kr"
    entries = parse_kind_corp_list(response.text)
    if not entries:
        raise UniverseFetchError(f"종목 표 없음({_page_hint(response.text)})")
    return entries


def _kospi_from_pykrx() -> list[UniverseEntry]:
    from pykrx import stock  # 서버에 있을 때만

    return [
        entry for code in stock.get_market_ticker_list(market="KOSPI")
        if (entry := _kr_entry(code, stock.get_market_ticker_name(code)))
    ]


_KOSPI_SOURCES = (
    ("네이버 모바일", _kospi_from_naver_mobile),
    ("네이버 시가총액", _kospi_from_naver_desktop),
    ("KRX KIND", _kospi_from_kind),
    ("pykrx", _kospi_from_pykrx),
)


def fetch_kospi() -> list[UniverseEntry]:
    """여러 출처를 차례로 시도해 처음으로 충분한 목록을 준 곳을 쓴다.

    한 곳의 페이지 구조가 바뀌어도 스캔이 막히지 않게 하고, 모두 실패하면
    출처마다 무엇을 받았는지 알려 원인을 바로 찾게 한다.
    """
    failures: list[str] = []
    for label, source in _KOSPI_SOURCES:
        try:
            found = source()
        except Exception as exc:
            failures.append(f"{label}: {exc}")
            continue
        entries = list({e["ticker"]: e for e in found}.values())  # 중복 제거, 순서 유지
        if len(entries) >= 300:
            return entries
        failures.append(f"{label}: {len(entries)}개뿐")
    raise UniverseFetchError("코스피 종목 목록을 받지 못했습니다 — " + " / ".join(failures))


_FETCHERS = {"SP500": fetch_sp500, "KOSPI": fetch_kospi}


def full_universe(index: str) -> list[UniverseEntry]:
    """지수 전체 구성 종목. 같은 날에는 한 번만 받아 온다."""
    code = index.upper()
    if code not in _FETCHERS:
        raise ValueError(f"지원하지 않는 지수: {index}")
    today = date.today().isoformat()
    cached = _cache.get(code)
    if cached and cached[0] == today:
        return list(cached[1])
    try:
        entries = _FETCHERS[code]()
    except UniverseFetchError:
        raise
    except Exception as exc:  # 네트워크·파싱 오류를 한 가지 이름으로 알린다
        logger.warning("%s 구성 종목 조회 실패: %s", code, exc)
        raise UniverseFetchError(f"{code} 구성 종목을 받아 오지 못했습니다: {exc}") from exc
    _cache[code] = (today, entries)
    return list(entries)
