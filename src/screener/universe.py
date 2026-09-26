"""매수 후보 스캔의 대상 — 한국·미국 대형주 고정 목록.

'우량주 중에서 고른다'가 출발점이라 후보를 시가총액 상위 대형주로 묶어 둔다.
목록을 고정하면 매번 같은 기준으로 비교할 수 있고, 스캔 시간도 예측된다.
종목을 바꿀 때는 여기만 고치면 된다.
"""

from __future__ import annotations

from typing import NotRequired, TypedDict


class UniverseEntry(TypedDict):
    ticker: str
    name: str
    market: str  # "KR" | "US"
    #: 섹터·업종 이름(S&P 500 전체 목록의 GICS 섹터·세부 업종). 없으면 스캔할 때 조회한다.
    sector: NotRequired[str]
    industry: NotRequired[str]


# 코스피 시가총액 상위(우선주·지주사 중복 최소화).
_KR: list[tuple[str, str]] = [
    ("005930.KS", "삼성전자"),
    ("000660.KS", "SK하이닉스"),
    ("373220.KS", "LG에너지솔루션"),
    ("207940.KS", "삼성바이오로직스"),
    ("005380.KS", "현대차"),
    ("000270.KS", "기아"),
    ("068270.KS", "셀트리온"),
    ("105560.KS", "KB금융"),
    ("055550.KS", "신한지주"),
    ("086790.KS", "하나금융지주"),
    ("035420.KS", "NAVER"),
    ("035720.KS", "카카오"),
    ("012330.KS", "현대모비스"),
    ("005490.KS", "POSCO홀딩스"),
    ("028260.KS", "삼성물산"),
    ("032830.KS", "삼성생명"),
    ("012450.KS", "한화에어로스페이스"),
    ("329180.KS", "HD현대중공업"),
    ("051910.KS", "LG화학"),
    ("006400.KS", "삼성SDI"),
    ("066570.KS", "LG전자"),
    ("009150.KS", "삼성전기"),
    ("033780.KS", "KT&G"),
    ("017670.KS", "SK텔레콤"),
    ("003550.KS", "LG"),
]

# S&P 500 시가총액 상위(클래스 주식 중복 제외).
_US: list[tuple[str, str]] = [
    ("AAPL", "애플"),
    ("MSFT", "마이크로소프트"),
    ("NVDA", "엔비디아"),
    ("AMZN", "아마존"),
    ("GOOGL", "알파벳"),
    ("META", "메타"),
    ("AVGO", "브로드컴"),
    ("TSLA", "테슬라"),
    ("LLY", "일라이 릴리"),
    ("JPM", "JP모건"),
    ("V", "비자"),
    ("MA", "마스터카드"),
    ("UNH", "유나이티드헬스"),
    ("XOM", "엑슨모빌"),
    ("JNJ", "존슨앤드존슨"),
    ("PG", "P&G"),
    ("HD", "홈디포"),
    ("COST", "코스트코"),
    ("ABBV", "애브비"),
    ("MRK", "머크"),
    ("WMT", "월마트"),
    ("KO", "코카콜라"),
    ("PEP", "펩시코"),
    ("ORCL", "오라클"),
    ("MCD", "맥도날드"),
]

LARGE_CAP_UNIVERSE: list[UniverseEntry] = [
    {"ticker": t, "name": n, "market": "KR"} for t, n in _KR
] + [
    {"ticker": t, "name": n, "market": "US"} for t, n in _US
]


def universe_for(market: str | None = None) -> list[UniverseEntry]:
    """시장 필터('KR'/'US', 없으면 전체)를 적용한 대상 목록."""
    code = (market or "ALL").upper()
    if code == "ALL":
        return list(LARGE_CAP_UNIVERSE)
    return [entry for entry in LARGE_CAP_UNIVERSE if entry["market"] == code]
