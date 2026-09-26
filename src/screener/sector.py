"""금융업(은행·보험·증권) 판별 — 스캐너의 판정 모델이 맞지 않는 업종을 가려낸다.

은행·보험·증권사는 예금·보험료·고객 자산이 부채와 현금흐름에 섞여 있어, 현금흐름
할인(DCF)·오너어닝·EV 배수로 적정가를 내거나 유동비율·부채비율로 재무건전성을
판정하면 결과가 크게 틀어진다(예: 보험사는 보험료 유입 때문에 적정가가 부풀려진다).
그래서 이 업종은 매수·관심 후보에 섞지 않고 따로 보여 준다.

업종 이름은 두 곳에서 온다.
· S&P 500 전체 스캔 — 위키백과 구성 종목 표의 GICS 세부 업종(추가 조회 없음).
· 그 밖의 종목 — yfinance 의 industry.
결제망(비자·마스터카드), 거래소·데이터, 보험 중개처럼 대차대조표로 돈을 벌지 않는
금융 업종은 일반 모델이 맞으므로 포함하지 않는다.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# 업종 이름(소문자)에 들어 있으면 모델이 맞지 않는 금융업으로 본다.
# GICS 예: "Diversified Banks", "Regional Banks", "Property & Casualty Insurance",
#          "Investment Banking & Brokerage", "Consumer Finance"
# yfinance 예: "Banks - Regional", "Insurance - Life", "Capital Markets"
_MISFIT_KEYWORDS = ("bank", "insurance", "reinsurance", "capital markets", "consumer finance", "mortgage", "thrifts")
_FIT_EXCEPTIONS = ("insurance brokers",)

# 성공한 조회만 기억한다 — 일시적 실패(None)는 다음 스캔에서 다시 시도한다.
_industry_cache: dict[str, str] = {}


def is_financial_misfit(industry: str | None) -> bool:
    """판정 모델이 맞지 않는 금융업(은행·보험·증권·여신)인가."""
    if not industry:
        return False
    name = industry.lower()
    if any(exception in name for exception in _FIT_EXCEPTIONS):
        return False
    return any(keyword in name for keyword in _MISFIT_KEYWORDS)


def lookup_industry(ticker: str) -> str | None:
    """yfinance 로 업종 이름을 조회한다. 실패하면 None(판별하지 않음)."""
    if ticker in _industry_cache:
        return _industry_cache[ticker]
    try:
        import yfinance as yf

        industry = (yf.Ticker(ticker).info or {}).get("industry") or None
    except Exception as exc:  # 조회 실패가 스캔을 멈추면 안 된다
        logger.debug("industry lookup failed for %s: %s", ticker, exc)
        return None
    if industry:
        _industry_cache[ticker] = industry
    return industry
