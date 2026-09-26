"""전체 지수 스캔용 종목 목록 — S&P 500 전 종목, 코스피 전 종목(보통주).

고정 목록(universe.py)은 대형주 50개뿐이라, 지수 전체를 훑을 때는 스캔하는 시점의
구성 종목을 서버가 직접 받아 온다. 구성은 수시로 바뀌므로 코드에 박아 두지 않는다.

· S&P 500 — 위키백과 구성 종목 표(표 id "constituents"). GICS 세부 업종도 함께 읽는다.
· 코스피 — 네이버 금융 시가총액 순위(코스피, 페이지당 50종목). 우선주는 뺀다.

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
        entry: UniverseEntry = {"ticker": ticker, "name": _KNOWN_NAMES.get(ticker, name), "market": "US"}
        # 셋째·넷째 칸이 GICS 섹터·세부 업종이다 — 섹터 표시와 금융업 판별에 쓴다.
        if len(cells) > 2 and (sector_name := cells[2].get_text(strip=True)):
            entry["sector"] = sector_name
        if len(cells) > 3 and (industry := cells[3].get_text(strip=True)):
            entry["industry"] = industry
        entries.append(entry)
    return entries


_NAVER_CODE = re.compile(r"code=([0-9A-Z]{6})")
_NAVER_LAST_PAGE = re.compile(r"page=(\d+)")


def parse_naver_kospi_page(html: str) -> tuple[list[UniverseEntry], int | None]:
    """네이버 시가총액 순위 한 페이지 → (보통주 목록, 마지막 페이지 번호)."""
    soup = BeautifulSoup(html, "html.parser")
    entries: list[UniverseEntry] = []
    for link in soup.select("table.type_2 a.tltle"):
        match = _NAVER_CODE.search(link.get("href", ""))
        if not match:
            continue
        code = match.group(1)
        # 보통주 코드는 숫자 6자리이고 끝자리가 0 이다(우선주는 5·7·9·K 등).
        if not (code.isdigit() and code.endswith("0")):
            continue
        ticker = f"{code}.KS"
        entries.append({"ticker": ticker, "name": _KNOWN_NAMES.get(ticker, link.get_text(strip=True)), "market": "KR"})

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


def fetch_kospi() -> list[UniverseEntry]:
    entries: list[UniverseEntry] = []
    seen: set[str] = set()
    page, last_page = 1, None
    while page <= (last_page or NAVER_MAX_PAGES):
        response = _get(NAVER_KOSPI_URL, sosok=0, page=page)
        response.encoding = "euc-kr"
        rows, found_last = parse_naver_kospi_page(response.text)
        last_page = last_page or found_last
        if not rows and last_page is None:
            break
        for entry in rows:
            if entry["ticker"] not in seen:
                seen.add(entry["ticker"])
                entries.append(entry)
        page += 1
        time.sleep(0.2)  # 사이트에 부담을 주지 않게
    if len(entries) < 300:
        raise UniverseFetchError(f"코스피 종목이 {len(entries)}개뿐입니다")
    return entries


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
