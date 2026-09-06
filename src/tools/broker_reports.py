"""증권사별 종목분석 리포트 수집 (네이버 금융 리서치).

Price Compass의 증권사 목표가 카드를 눌렀을 때 해당 증권사가 실제로 낸
리포트를 열어보기 위한 소스다. 네이버 리서치는 itemCode 기준으로 종목별
리포트 목록을 제공하고, 각 리포트 상세 페이지에 목표가·투자의견·본문 요약과
원본 PDF 링크가 함께 실려 있다.

한국 종목(.KS/.KQ/6자리 코드)에만 적용된다. 해외 종목은 동일한 무료 소스가
없어 빈 목록을 돌려준다.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_NAVER_RESEARCH_LIST_URL = "https://finance.naver.com/research/company_list.naver"
_NAVER_RESEARCH_READ_URL = "https://finance.naver.com/research/company_read.naver"
_HEADERS = {"User-Agent": "Mozilla/5.0"}

# 목록/상세 각각 in-memory 캐시. 리포트는 하루 단위로 올라오므로 6시간이면 충분하다.
_TTL_SECONDS = 6 * 3600
_LIST_CACHE: dict[str, tuple[float, "BrokerReportIndex"]] = {}
_DETAIL_CACHE: dict[str, tuple[float, "BrokerReportDetail"]] = {}

# 목록 페이지 1장당 30건. 3장이면 대략 6~9개월치로, 컨센서스에 잡히는
# 증권사 대부분의 최신 리포트를 포함한다.
_DEFAULT_PAGES = 3

_OPINION_TO_SIGNAL = {
    "매수": "BUY", "적극매수": "BUY", "강력매수": "BUY", "buy": "BUY",
    "strongbuy": "BUY", "outperform": "BUY", "overweight": "BUY",
    "중립": "HOLD", "보유": "HOLD", "hold": "HOLD", "marketperform": "HOLD",
    "neutral": "NEUTRAL",
    "매도": "SELL", "sell": "SELL", "underperform": "SELL", "underweight": "SELL",
}


@dataclass
class BrokerReport:
    """목록 한 줄 — 상세 조회 없이 카드에 바로 보여줄 수 있는 최소 정보."""
    id: str                       # 네이버 nid
    broker: str                   # 증권사 표기 그대로
    broker_key: str               # 매칭용 정규화 이름
    title: str
    published_date: str           # yyyy-mm-dd
    detail_url: str
    pdf_url: Optional[str] = None


@dataclass
class BrokerReportIndex:
    ticker: str
    item_code: str
    list_url: str
    reports: list[BrokerReport] = field(default_factory=list)
    source: str = "naver-research"


@dataclass
class BrokerReportDetail:
    id: str
    broker: str
    title: str
    published_date: str
    target_price: Optional[float]
    opinion: Optional[str]
    signal: Optional[str]
    body: list[str]
    detail_url: str
    pdf_url: Optional[str] = None
    views: Optional[int] = None
    source: str = "naver-research"


def is_supported_ticker(ticker: str) -> bool:
    """네이버 리서치가 커버하는 한국 종목인지."""
    t = (ticker or "").strip().upper()
    code = t.split(".")[0]
    return t.endswith(".KS") or t.endswith(".KQ") or (code.isdigit() and len(code) == 6)


def krx_code(ticker: str) -> str:
    return (ticker or "").strip().upper().split(".")[0]


def normalize_broker(name: str) -> str:
    """증권사 이름 매칭용 키.

    FnGuide 컨센서스 표기와 네이버 리서치 표기가 미묘하게 다를 수 있어
    (예: 'IBK투자증권' vs 'IBK 투자증권') 공백·법인 접미사·'증권'류 토큰을
    떼어낸 축약형으로 비교한다.
    """
    if not name:
        return ""
    stripped = name.replace("주식회사", "").replace("(주)", "").replace("（주）", "")
    stripped = re.sub(r"[\s()（）·.]", "", stripped)
    key = stripped
    for token in ("금융투자", "투자증권", "증권", "홀딩스"):
        key = key.replace(token, "")
    return key.upper() or stripped.upper()


def _parse_money(text: str) -> Optional[float]:
    if not text:
        return None
    cleaned = re.sub(r"[^\d.]", "", text)
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return value if value > 0 else None


def _parse_int(text: str) -> Optional[int]:
    value = _parse_money(text)
    return int(value) if value is not None else None


def _normalize_date(text: str) -> str:
    """'26.08.26' / '2026.08.26' → '2026-08-26'."""
    digits = re.findall(r"\d+", text or "")
    if len(digits) < 3:
        return ""
    y, m, d = digits[0], digits[1], digits[2]
    if len(y) == 2:
        y = f"20{y}"
    return f"{y}-{int(m):02d}-{int(d):02d}"


def _opinion_to_signal(opinion: Optional[str]) -> Optional[str]:
    if not opinion:
        return None
    key = re.sub(r"[\s.]", "", opinion).lower()
    return _OPINION_TO_SIGNAL.get(key)


def _get(url: str, params: dict) -> Optional[str]:
    try:
        response = requests.get(url, params=params, timeout=8, headers=_HEADERS)
    except Exception as e:  # noqa: BLE001 — 네트워크 실패는 조용히 빈 결과로
        logger.debug("naver research fetch failed (%s): %s", url, e)
        return None
    if not response.ok:
        return None
    # 네이버 금융 리서치는 EUC-KR. requests의 추정 인코딩은 자주 틀린다.
    response.encoding = "euc-kr"
    return response.text


def _list_url(code: str, page: int = 1) -> str:
    return f"{_NAVER_RESEARCH_LIST_URL}?searchType=itemCode&itemCode={code}&page={page}"


def _detail_url(code: str, nid: str) -> str:
    return f"{_NAVER_RESEARCH_READ_URL}?nid={nid}&page=1&searchType=itemCode&itemCode={code}"


def _parse_list_page(html: str, code: str) -> list[BrokerReport]:
    soup = BeautifulSoup(html, "html.parser")
    reports: list[BrokerReport] = []
    for table in soup.find_all("table", class_="type_1"):
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if len(cells) < 5:
                continue
            read_link = tr.find("a", href=re.compile(r"company_read\.naver\?nid=\d+"))
            if not read_link:
                continue
            nid_match = re.search(r"nid=(\d+)", read_link.get("href", ""))
            if not nid_match:
                continue
            title = read_link.get_text(" ", strip=True)
            broker = cells[2].get_text(" ", strip=True)
            published = _normalize_date(cells[4].get_text(" ", strip=True))
            pdf_link = tr.find("a", href=re.compile(r"\.pdf$", re.I))
            if not title or not broker:
                continue
            reports.append(BrokerReport(
                id=nid_match.group(1),
                broker=broker,
                broker_key=normalize_broker(broker),
                title=title,
                published_date=published,
                detail_url=_detail_url(code, nid_match.group(1)),
                pdf_url=pdf_link.get("href") if pdf_link else None,
            ))
    return reports


def fetch_broker_reports(
    ticker: str,
    pages: int = _DEFAULT_PAGES,
    force_refresh: bool = False,
) -> BrokerReportIndex:
    """종목의 증권사 리포트 목록 (최신순)."""
    code = krx_code(ticker)
    index = BrokerReportIndex(ticker=ticker.upper(), item_code=code, list_url=_list_url(code))
    if not is_supported_ticker(ticker):
        index.source = "unsupported-market"
        return index

    cache_key = f"{code}:{pages}"
    now = time.time()
    cached = _LIST_CACHE.get(cache_key)
    if not force_refresh and cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    seen: set[str] = set()
    for page in range(1, max(1, pages) + 1):
        html = _get(_NAVER_RESEARCH_LIST_URL, {
            "searchType": "itemCode",
            "itemCode": code,
            "page": page,
        })
        if not html:
            break
        page_reports = _parse_list_page(html, code)
        if not page_reports:
            break
        for report in page_reports:
            if report.id in seen:
                continue
            seen.add(report.id)
            index.reports.append(report)

    index.reports.sort(key=lambda r: r.published_date, reverse=True)
    if index.reports:
        _LIST_CACHE[cache_key] = (now, index)
    return index


def _parse_detail(html: str, nid: str, code: str) -> Optional[BrokerReportDetail]:
    soup = BeautifulSoup(html, "html.parser")
    subject = soup.find("th", class_="view_sbj")
    if not subject:
        return None

    source_line = subject.find("p", class_="source")
    broker, published, views = "", "", None
    if source_line:
        parts = [p.strip() for p in source_line.get_text("|", strip=True).split("|") if p.strip()]
        if parts:
            broker = parts[0]
        if len(parts) > 1:
            published = _normalize_date(parts[1])
        if len(parts) > 2:
            views = _parse_int(parts[2])
        source_line.extract()
    stock_name = subject.find("em")
    if stock_name:
        stock_name.extract()
    title = subject.get_text(" ", strip=True)

    target_price, opinion = None, None
    info = soup.find("div", class_="view_info_1")
    if info:
        money = info.find("em", class_="money")
        if money:
            target_price = _parse_money(money.get_text(" ", strip=True))
        coment = info.find("em", class_="coment")
        if coment:
            opinion = coment.get_text(" ", strip=True) or None

    body: list[str] = []
    content = soup.find("td", class_="view_cnt")
    if content:
        for br in content.find_all("br"):
            br.replace_with("\n")
        for paragraph in content.find_all("p"):
            for line in paragraph.get_text("\n", strip=True).split("\n"):
                line = line.strip()
                if line:
                    body.append(line)

    pdf_url = None
    pdf_link = soup.find("a", href=re.compile(r"\.pdf(\?.*)?$", re.I))
    if pdf_link:
        pdf_url = pdf_link.get("href")

    return BrokerReportDetail(
        id=nid,
        broker=broker,
        title=title,
        published_date=published,
        target_price=target_price,
        opinion=opinion,
        signal=_opinion_to_signal(opinion),
        body=body,
        detail_url=_detail_url(code, nid),
        pdf_url=pdf_url,
        views=views,
    )


def fetch_broker_report_detail(
    ticker: str,
    nid: str,
    force_refresh: bool = False,
) -> Optional[BrokerReportDetail]:
    """리포트 본문 (목표가·투자의견·요약 문단·PDF 링크)."""
    if not is_supported_ticker(ticker) or not str(nid).isdigit():
        return None

    code = krx_code(ticker)
    cache_key = f"{code}:{nid}"
    now = time.time()
    cached = _DETAIL_CACHE.get(cache_key)
    if not force_refresh and cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    html = _get(_NAVER_RESEARCH_READ_URL, {
        "nid": nid,
        "page": 1,
        "searchType": "itemCode",
        "itemCode": code,
    })
    if not html:
        return None

    detail = _parse_detail(html, str(nid), code)
    if detail:
        _DETAIL_CACHE[cache_key] = (now, detail)
    return detail
