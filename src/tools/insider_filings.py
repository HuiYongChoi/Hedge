"""내부자 거래(SEC Form 4) 수집 — 외부 데이터 API가 비어 있을 때의 1차 원천.

배경(실측)
    앱은 8개 에이전트(피터 린치·마이클 버리·드러켄밀러·필 피셔·멍거·탈레브·성장·센티먼트)가
    내부자 거래를 근거로 쓰는데, 외부 데이터 API가 **전 종목 0건**을 돌려주고 있었다.
    실패가 아니라 '빈 배열'이라 조용히 "데이터 부재 → 중립"으로 처리되어 아무도 몰랐다.
    같은 시점 SEC 에는 AMD 한 종목만 Form 4 가 626건 있었다.

Form 4 는 임원·이사가 자사주를 사고팔 때 2영업일 내 제출하는 공시다. XML 이 구조화돼
있어 파싱이 안정적이고, EDGAR 에서 무료로 받을 수 있다.

부호 규약(중요)
    에이전트는 `transaction_shares < 0` 을 매도(bearish)로 본다(sentiment.py).
    Form 4 의 acquiredDisposedCode 가 'D'(처분)면 음수, 'A'(취득)면 양수로 맞춘다.
"""

from __future__ import annotations

import html
import json
import re
import time
from typing import Optional

from src.data.models import InsiderTrade
from src.tools.sec_filings import _http_get, get_cik_for_ticker

_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
_INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json"
_DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"

_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, list[InsiderTrade]]] = {}

#: Form 4 는 건당 1개 문서라 여러 건을 받아야 의미가 생긴다. 다만 한 건마다
#: HTTP 요청이 필요하므로 상한을 둔다(626건을 다 받으면 비현실적).
#: 최악 케이스(내부자 재량거래가 드문 종목)의 소요시간을 묶기 위한 상한.
#: 20 → 최대 60회 요청 ≈ 9초. 실측: 상한 40이면 MSFT 가 18초 걸렸다.
DEFAULT_MAX_FILINGS = 20

#: 거래 코드. P=공개시장 매수, S=공개시장 매도, A=수여(보상), M=옵션행사,
#: F=세금 원천징수, G=증여.
#:
#: **재량거래(P/S)만 시그널이다.** 나머지는 보상 일정에 따른 기계적 거래라
#: '내부자 매수'로 세면 안 된다. 실측(2026-08 기준):
#:   NVDA 13건 → A 11 + G 2 = 재량거래 0건. 그대로 세면 '내부자 매수 11건'이라는
#:              거짓 강세 신호가 만들어진다(전부 스톡 어워드).
#:   AMD  23건 → M 11 + F 9 + 재량 3건(전부 매도).
_DISCRETIONARY_CODES = {"P", "S"}

#: 재량거래는 드물어서, 걸러내려면 더 많은 공시를 훑어야 한다.
_DISCRETIONARY_SCAN_MULTIPLIER = 3

#: 신호 판단에 충분한 거래 수. 이만큼 모이면 더 훑지 않는다.
#: (공시 1건마다 HTTP 요청이 들어가 전수 스캔은 15초 이상 걸린다 — 실측)
ENOUGH_TRADES = 30


def _text(xml: str, tag: str) -> Optional[str]:
    match = re.search(rf"<{tag}>(.*?)</{tag}>", xml, re.S)
    if not match:
        return None
    value = re.sub(r"<[^>]+>", " ", match.group(1))
    # &amp; 같은 엔티티를 풀지 않으면 직함이 'SVP, GC &amp; Corporate Secretary'로 깨져 보인다.
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def _num(xml: str, tag: str) -> Optional[float]:
    raw = _text(xml, tag)
    if raw is None:
        return None
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def parse_form4(
    xml: str,
    ticker: str,
    filing_date: str,
    discretionary_only: bool = True,
) -> list[InsiderTrade]:
    """Form 4 XML → InsiderTrade 목록.

    한 건의 Form 4 에 여러 거래(nonDerivativeTransaction)가 담길 수 있어 모두 뽑는다.
    discretionary_only=True 면 공개시장 매수/매도(P/S)만 남긴다 — 스톡 어워드나
    옵션 행사를 '내부자 매수'로 세면 없는 강세 신호가 만들어지기 때문이다.
    """
    owner = _text(xml, "rptOwnerName")
    officer_title = _text(xml, "officerTitle")
    is_director_raw = _text(xml, "isDirector")
    is_director = is_director_raw in ("1", "true", "True")
    issuer = _text(xml, "issuerName")

    title = officer_title or ("Director" if is_director else None)

    trades: list[InsiderTrade] = []
    for block in re.findall(
        r"<nonDerivativeTransaction>(.*?)</nonDerivativeTransaction>", xml, re.S
    ):
        code = _text(block, "transactionCode")
        shares = _num(block, "transactionShares")
        price = _num(block, "transactionPricePerShare")
        disposed = _text(block, "transactionAcquiredDisposedCode")
        if shares is None:
            continue
        # 보상성 거래(A 수여 · M 옵션행사 · F 세금원천징수 · G 증여)는 내부자의
        # 판단이 아니라 일정에 따른 것이라 매수/매도 신호로 쓰면 안 된다.
        if discretionary_only and code not in _DISCRETIONARY_CODES:
            continue

        # 에이전트 규약에 맞춘다: 처분(D)은 음수, 취득(A)은 양수.
        signed_shares = -abs(shares) if disposed == "D" else abs(shares)
        value = abs(shares) * price if price is not None else None

        trades.append(InsiderTrade(
            ticker=ticker,
            issuer=issuer,
            name=owner,
            title=title,
            is_board_director=is_director,
            transaction_date=_text(block, "transactionDate"),
            transaction_shares=signed_shares,
            transaction_price_per_share=price,
            transaction_value=(-value if (value is not None and disposed == "D") else value),
            shares_owned_before_transaction=None,
            shares_owned_after_transaction=_num(block, "sharesOwnedFollowingTransaction"),
            # 거래 코드를 남겨 화면·프롬프트에서 성격을 구분할 수 있게 한다.
            security_title=f"{_text(block, 'securityTitle') or ''} [{code or '?'}]".strip(),
            filing_date=filing_date,
        ))
    return trades


def fetch_insider_trades_from_sec(
    ticker: str,
    end_date: Optional[str] = None,
    start_date: Optional[str] = None,
    max_filings: int = DEFAULT_MAX_FILINGS,
    discretionary_only: bool = True,
) -> list[InsiderTrade]:
    """SEC Form 4 에서 내부자 거래를 받아온다.

    실패해도 예외를 던지지 않는다 — 이 데이터가 없다고 분석이 멈추면 안 된다.
    미국 상장이 아니면 빈 목록(한국·일본은 별도 경로).
    """
    ticker_key = (ticker or "").strip().upper()
    cache_key = f"{ticker_key}:{start_date or ''}:{end_date or ''}:{max_filings}:{discretionary_only}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    trades: list[InsiderTrade] = []
    try:
        cik = get_cik_for_ticker(ticker_key)
        if cik is None:
            _cache[cache_key] = (time.time(), trades)
            return trades

        submissions = json.loads(_http_get(_SUBMISSIONS_URL.format(cik=cik)).decode("utf-8"))
        recent = submissions.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        primary = recent.get("primaryDocument", [])

        # 재량거래만 남길 경우 대부분이 걸러지므로 더 많은 공시를 훑어야 한다.
        scan_limit = max_filings * _DISCRETIONARY_SCAN_MULTIPLIER if discretionary_only else max_filings
        picked = 0
        for i, form in enumerate(forms):
            if picked >= scan_limit:
                break
            if form != "4":
                continue
            filing_date = dates[i] if i < len(dates) else ""
            # 기간 필터 — 오래된 공시까지 받아오지 않는다.
            if end_date and filing_date and filing_date > end_date:
                continue
            if start_date and filing_date and filing_date < start_date:
                break  # recent 는 최신순이라 더 볼 필요 없다

            acc = accessions[i].replace("-", "")
            doc = primary[i] if i < len(primary) else ""
            # primaryDocument 는 'xslF345X06/wk-form4_….xml' 처럼 스타일시트 경로가
            # 앞에 붙는다. 그 경로는 사람이 보는 HTML 렌더용이고, 원본 XML 은
            # 같은 파일명을 디렉터리 없이 받아야 한다.
            raw_name = doc.rsplit("/", 1)[-1]
            if not raw_name.lower().endswith(".xml"):
                continue

            try:
                xml = _http_get(
                    _DOC_URL.format(cik=cik, acc=acc, doc=raw_name)
                ).decode("utf-8", errors="ignore")
            except Exception:
                continue

            trades.extend(parse_form4(xml, ticker_key, filing_date, discretionary_only))
            picked += 1
            # 판단에 충분하면 조기 종료 — 활발한 종목에서 수백 건을 다 받을 이유가 없다.
            if len(trades) >= ENOUGH_TRADES:
                break
    except Exception:
        # 내부자 거래는 부가 근거다. 어떤 실패도 분석을 막지 않는다.
        pass

    _cache[cache_key] = (time.time(), trades)
    return trades
