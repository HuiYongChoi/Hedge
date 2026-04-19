from fastapi import APIRouter, Query
import httpx
import asyncio
from typing import Optional

router = APIRouter(prefix="/ticker-search", tags=["ticker-search"])

FMP_API_KEY = "WnoeVdSBlKezrKNExH7jtXfEWXg8YrtE"
AV_API_KEY = "QCE8EC5Q5OP74PYD"

# Major exchanges to prioritize for US/global stocks
US_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "NMS", "NGM", "NCM", "NYQ", "ASE"}
KR_EXCHANGES = {"KSC", "KOE", "KSE"}

# Comprehensive Korean stock list (KOSPI / KOSDAQ)
KOREAN_STOCKS = [
    # KOSPI 대형주
    {"ticker": "005930.KS", "name": "삼성전자", "market": "KR"},
    {"ticker": "000660.KS", "name": "SK하이닉스", "market": "KR"},
    {"ticker": "373220.KS", "name": "LG에너지솔루션", "market": "KR"},
    {"ticker": "207940.KS", "name": "삼성바이오로직스", "market": "KR"},
    {"ticker": "005380.KS", "name": "현대자동차", "market": "KR"},
    {"ticker": "000270.KS", "name": "기아", "market": "KR"},
    {"ticker": "068270.KS", "name": "셀트리온", "market": "KR"},
    {"ticker": "005490.KS", "name": "POSCO홀딩스", "market": "KR"},
    {"ticker": "035420.KS", "name": "NAVER", "market": "KR"},
    {"ticker": "006400.KS", "name": "삼성SDI", "market": "KR"},
    {"ticker": "051910.KS", "name": "LG화학", "market": "KR"},
    {"ticker": "035720.KS", "name": "카카오", "market": "KR"},
    {"ticker": "066570.KS", "name": "LG전자", "market": "KR"},
    {"ticker": "105560.KS", "name": "KB금융", "market": "KR"},
    {"ticker": "055550.KS", "name": "신한지주", "market": "KR"},
    {"ticker": "086790.KS", "name": "하나금융지주", "market": "KR"},
    {"ticker": "316140.KS", "name": "우리금융지주", "market": "KR"},
    {"ticker": "012330.KS", "name": "현대모비스", "market": "KR"},
    {"ticker": "028260.KS", "name": "삼성물산", "market": "KR"},
    {"ticker": "096770.KS", "name": "SK이노베이션", "market": "KR"},
    {"ticker": "017670.KS", "name": "SK텔레콤", "market": "KR"},
    {"ticker": "030200.KS", "name": "KT", "market": "KR"},
    {"ticker": "032830.KS", "name": "삼성생명", "market": "KR"},
    {"ticker": "009540.KS", "name": "한국조선해양", "market": "KR"},
    {"ticker": "003550.KS", "name": "LG", "market": "KR"},
    {"ticker": "034730.KS", "name": "SK", "market": "KR"},
    {"ticker": "015760.KS", "name": "한국전력", "market": "KR"},
    {"ticker": "011200.KS", "name": "HMM", "market": "KR"},
    {"ticker": "010950.KS", "name": "S-Oil", "market": "KR"},
    {"ticker": "033780.KS", "name": "KT&G", "market": "KR"},
    {"ticker": "009150.KS", "name": "삼성전기", "market": "KR"},
    {"ticker": "034020.KS", "name": "두산에너빌리티", "market": "KR"},
    {"ticker": "012450.KS", "name": "한화에어로스페이스", "market": "KR"},
    {"ticker": "329180.KS", "name": "HD현대중공업", "market": "KR"},
    {"ticker": "003490.KS", "name": "대한항공", "market": "KR"},
    {"ticker": "086280.KS", "name": "현대글로비스", "market": "KR"},
    {"ticker": "003670.KS", "name": "포스코퓨처엠", "market": "KR"},
    {"ticker": "010130.KS", "name": "고려아연", "market": "KR"},
    {"ticker": "000810.KS", "name": "삼성화재", "market": "KR"},
    {"ticker": "001450.KS", "name": "현대해상", "market": "KR"},
    {"ticker": "005830.KS", "name": "DB손해보험", "market": "KR"},
    {"ticker": "000060.KS", "name": "메리츠화재", "market": "KR"},
    {"ticker": "003490.KS", "name": "대한항공", "market": "KR"},
    {"ticker": "020560.KS", "name": "아시아나항공", "market": "KR"},
    {"ticker": "071050.KS", "name": "한국금융지주", "market": "KR"},
    {"ticker": "006800.KS", "name": "미래에셋증권", "market": "KR"},
    {"ticker": "005940.KS", "name": "NH투자증권", "market": "KR"},
    {"ticker": "016360.KS", "name": "삼성증권", "market": "KR"},
    {"ticker": "211050.KQ", "name": "인카금융서비스", "market": "KR"},
    {"ticker": "024110.KS", "name": "IBK기업은행", "market": "KR"},
    {"ticker": "000720.KS", "name": "현대건설", "market": "KR"},
    {"ticker": "006360.KS", "name": "GS건설", "market": "KR"},
    {"ticker": "047040.KS", "name": "대우건설", "market": "KR"},
    {"ticker": "294870.KS", "name": "HDC현대산업개발", "market": "KR"},
    {"ticker": "009830.KS", "name": "한화솔루션", "market": "KR"},
    {"ticker": "000880.KS", "name": "한화", "market": "KR"},
    {"ticker": "004990.KS", "name": "롯데지주", "market": "KR"},
    {"ticker": "023530.KS", "name": "롯데쇼핑", "market": "KR"},
    {"ticker": "139480.KS", "name": "이마트", "market": "KR"},
    {"ticker": "007070.KS", "name": "GS리테일", "market": "KR"},
    {"ticker": "282330.KS", "name": "BGF리테일", "market": "KR"},
    {"ticker": "097950.KS", "name": "CJ제일제당", "market": "KR"},
    {"ticker": "271560.KS", "name": "오리온", "market": "KR"},
    {"ticker": "004370.KS", "name": "농심", "market": "KR"},
    {"ticker": "000080.KS", "name": "하이트진로", "market": "KR"},
    {"ticker": "005300.KS", "name": "롯데칠성음료", "market": "KR"},
    {"ticker": "011170.KS", "name": "롯데케미칼", "market": "KR"},
    {"ticker": "036460.KS", "name": "한국가스공사", "market": "KR"},
    {"ticker": "000120.KS", "name": "CJ대한통운", "market": "KR"},
    {"ticker": "047810.KS", "name": "한국항공우주", "market": "KR"},
    {"ticker": "034220.KS", "name": "LG디스플레이", "market": "KR"},
    {"ticker": "011070.KS", "name": "LG이노텍", "market": "KR"},
    {"ticker": "006260.KS", "name": "LS", "market": "KR"},
    {"ticker": "004800.KS", "name": "효성", "market": "KR"},
    {"ticker": "010620.KS", "name": "현대미포조선", "market": "KR"},
    {"ticker": "010140.KS", "name": "삼성중공업", "market": "KR"},
    {"ticker": "241560.KS", "name": "두산밥캣", "market": "KR"},
    {"ticker": "323410.KS", "name": "카카오뱅크", "market": "KR"},
    {"ticker": "377300.KS", "name": "카카오페이", "market": "KR"},
    {"ticker": "259960.KS", "name": "크래프톤", "market": "KR"},
    {"ticker": "036570.KS", "name": "엔씨소프트", "market": "KR"},
    {"ticker": "251270.KS", "name": "넷마블", "market": "KR"},
    {"ticker": "293490.KS", "name": "카카오게임즈", "market": "KR"},
    {"ticker": "180640.KS", "name": "한진칼", "market": "KR"},
    {"ticker": "030000.KS", "name": "제일기획", "market": "KR"},
    {"ticker": "004020.KS", "name": "현대제철", "market": "KR"},
    {"ticker": "001230.KS", "name": "동국제강", "market": "KR"},
    {"ticker": "103140.KS", "name": "풍산", "market": "KR"},
    {"ticker": "002380.KS", "name": "KCC", "market": "KR"},
    {"ticker": "010060.KS", "name": "OCI", "market": "KR"},
    {"ticker": "002020.KS", "name": "코오롱", "market": "KR"},
    {"ticker": "005180.KS", "name": "빙그레", "market": "KR"},
    {"ticker": "088980.KS", "name": "맥쿼리인프라", "market": "KR"},
    # KOSDAQ 주요 종목
    {"ticker": "247540.KQ", "name": "에코프로비엠", "market": "KR"},
    {"ticker": "086520.KQ", "name": "에코프로", "market": "KR"},
    {"ticker": "066970.KQ", "name": "엘앤에프", "market": "KR"},
    {"ticker": "039490.KQ", "name": "키움증권", "market": "KR"},
    {"ticker": "042700.KQ", "name": "한미반도체", "market": "KR"},
    {"ticker": "240810.KQ", "name": "원익IPS", "market": "KR"},
    {"ticker": "056190.KQ", "name": "에스에프에이", "market": "KR"},
    {"ticker": "039030.KQ", "name": "이오테크닉스", "market": "KR"},
    {"ticker": "089030.KQ", "name": "테크윙", "market": "KR"},
    {"ticker": "140860.KQ", "name": "파크시스템스", "market": "KR"},
    {"ticker": "036930.KQ", "name": "주성엔지니어링", "market": "KR"},
    {"ticker": "278280.KQ", "name": "천보", "market": "KR"},
    {"ticker": "336370.KQ", "name": "솔루스첨단소재", "market": "KR"},
    {"ticker": "225570.KQ", "name": "넥슨게임즈", "market": "KR"},
    {"ticker": "041510.KQ", "name": "에스엠", "market": "KR"},
    {"ticker": "035900.KQ", "name": "JYP엔터테인먼트", "market": "KR"},
    {"ticker": "122870.KQ", "name": "와이지엔터테인먼트", "market": "KR"},
    {"ticker": "263750.KQ", "name": "펄어비스", "market": "KR"},
    {"ticker": "357780.KQ", "name": "솔브레인", "market": "KR"},
    {"ticker": "018290.KQ", "name": "디와이파워", "market": "KR"},
    {"ticker": "214150.KQ", "name": "클래시스", "market": "KR"},
    {"ticker": "091990.KQ", "name": "셀트리온헬스케어", "market": "KR"},
    {"ticker": "196170.KQ", "name": "알테오젠", "market": "KR"},
    {"ticker": "145720.KQ", "name": "덴티움", "market": "KR"},
    {"ticker": "237690.KQ", "name": "에스티팜", "market": "KR"},
    {"ticker": "000145.KQ", "name": "하이트진로홀딩스", "market": "KR"},
    {"ticker": "031980.KQ", "name": "피에스케이홀딩스", "market": "KR"},
    {"ticker": "036490.KQ", "name": "SK머티리얼즈", "market": "KR"},
    {"ticker": "064350.KQ", "name": "현대로템", "market": "KR"},
]

_KOREAN_LISTING_CACHE: Optional[list[dict]] = None


def _is_korean(text: str) -> bool:
    return any('\uAC00' <= c <= '\uD7A3' for c in text)


def _is_ticker_pattern(text: str) -> bool:
    """6자리 숫자는 한국 종목코드 패턴"""
    return text.isdigit() and len(text) <= 6


def _suffix_for_pykrx_market(market_code: str) -> Optional[str]:
    normalized = (market_code or "").upper()
    if normalized in {"STK", "KOSPI"}:
        return ".KS"
    if normalized in {"KSQ", "KOSDAQ"}:
        return ".KQ"
    return None


def _to_korean_search_result(code: str, name: str, market_code: str = "") -> Optional[dict]:
    cleaned_code = str(code or "").strip()
    cleaned_name = str(name or "").strip()
    if not cleaned_code or not cleaned_name:
        return None

    suffix = _suffix_for_pykrx_market(market_code)
    ticker = f"{cleaned_code}{suffix}" if suffix and not cleaned_code.endswith((".KS", ".KQ")) else cleaned_code
    return {"ticker": ticker, "name": cleaned_name, "market": "KR"}


def _get_korean_listing_cache() -> list[dict]:
    """Load the current pykrx listed-stock table once, then serve Korean autocomplete locally."""
    global _KOREAN_LISTING_CACHE
    if _KOREAN_LISTING_CACHE is not None:
        return _KOREAN_LISTING_CACHE

    listing: list[dict] = []
    try:
        from pykrx import stock

        frame = stock.krx.StockTicker().listed
        for code, row in frame.iterrows():
            result = _to_korean_search_result(
                code=str(code),
                name=str(row.get("종목", "")),
                market_code=str(row.get("시장", "")),
            )
            if result:
                listing.append(result)
    except Exception:
        listing = []

    _KOREAN_LISTING_CACHE = listing
    return listing


def _search_korean_code_with_pykrx(query: str) -> list[dict]:
    if not query.isdigit() or len(query) != 6:
        return []

    try:
        from pykrx import stock

        name = stock.get_market_ticker_name(query)
        market_code = stock.krx.get_stock_ticekr_market(query)
        result = _to_korean_search_result(query, name, market_code)
        return [result] if result else []
    except Exception:
        return []


async def _search_yfinance(query: str) -> list[dict]:
    """yfinance Search API 호출 (비동기)"""
    try:
        import yfinance as yf
        loop = asyncio.get_event_loop()
        def _sync_search():
            s = yf.Search(query, max_results=10, enable_fuzzy_query=False)
            return s.quotes
        quotes = await loop.run_in_executor(None, _sync_search)
        results = []
        for q in quotes:
            symbol = q.get("symbol", "")
            name = q.get("longname") or q.get("shortname") or ""
            exchange = q.get("exchange", "")
            quote_type = q.get("quoteType", "")
            if quote_type not in ("EQUITY", "ETF"):
                continue
            # 시장 구분
            if exchange in KR_EXCHANGES or symbol.endswith(".KS") or symbol.endswith(".KQ"):
                market = "KR"
            elif exchange in US_EXCHANGES or not ("." in symbol):
                market = "US"
            else:
                market = "GLOBAL"
            results.append({"ticker": symbol, "name": name, "market": market})
        return results
    except Exception:
        return []


async def _search_fmp(query: str) -> list[dict]:
    """FMP stable/search-name API 호출"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://financialmodelingprep.com/stable/search-name",
                params={"query": query, "limit": 10, "apikey": FMP_API_KEY},
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            if not isinstance(data, list):
                return []
            results = []
            for item in data:
                symbol = item.get("symbol", "")
                name = item.get("name", "")
                exchange = item.get("exchange", "")
                if not symbol or not name:
                    continue
                if symbol.endswith(".KS") or symbol.endswith(".KQ") or exchange in ("KSC", "KOE"):
                    market = "KR"
                elif exchange in ("NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "XNYS", "XNAS"):
                    market = "US"
                else:
                    market = "GLOBAL"
                results.append({"ticker": symbol, "name": name, "market": market})
            return results
    except Exception:
        return []


async def _search_alphavantage(query: str) -> list[dict]:
    """AlphaVantage SYMBOL_SEARCH API 호출"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://www.alphavantage.co/query",
                params={"function": "SYMBOL_SEARCH", "keywords": query, "apikey": AV_API_KEY},
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            matches = data.get("bestMatches", [])
            results = []
            for m in matches:
                symbol = m.get("1. symbol", "")
                name = m.get("2. name", "")
                region = m.get("4. region", "")
                match_type = m.get("3. type", "")
                if match_type not in ("Equity", "ETF"):
                    continue
                if region == "South Korea":
                    market = "KR"
                elif region == "United States":
                    market = "US"
                else:
                    market = "GLOBAL"
                results.append({"ticker": symbol, "name": name, "market": market})
            return results
    except Exception:
        return []


def _search_korean_static(query: str) -> list[dict]:
    """한국 종목 정적 리스트에서 검색 (이름 포함 검색)"""
    q = query.strip()
    results = []
    for stock in KOREAN_STOCKS:
        if q in stock["name"] or stock["ticker"].startswith(q):
            results.append(stock)
    return results


def _search_korean_listing(query: str) -> list[dict]:
    """Search the pykrx listed-stock cache so Korean autocomplete is not limited to a hand-written list."""
    q = query.strip()
    if not q:
        return []

    results = []
    for stock in _get_korean_listing_cache():
        ticker = stock["ticker"]
        code = ticker.split(".")[0]
        if q in stock["name"] or ticker.startswith(q) or code.startswith(q):
            results.append(stock)

    if not results:
        results.extend(_search_korean_code_with_pykrx(q))
    return results


def _deduplicate(results: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for r in results:
        key = r["ticker"].upper()
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


@router.get("")
async def ticker_search(q: str = Query(..., min_length=1, max_length=50)):
    q = q.strip()
    if not q:
        return []

    # 한글 입력 또는 한국 종목코드(숫자 6자리) → 정적 한국 리스트 검색
    if _is_korean(q) or _is_ticker_pattern(q):
        static_results = _search_korean_static(q)
        dynamic_results = _search_korean_listing(q)
        return _deduplicate(static_results + dynamic_results)[:10]

    # 영문 입력: yfinance + FMP 병렬 호출, AV는 결과 부족 시
    yf_task = asyncio.create_task(_search_yfinance(q))
    fmp_task = asyncio.create_task(_search_fmp(q))
    yf_results, fmp_results = await asyncio.gather(yf_task, fmp_task)

    combined = yf_results + fmp_results
    unique = _deduplicate(combined)

    # US 우선 정렬: US → KR → GLOBAL
    def sort_key(r: dict):
        m = r.get("market", "")
        return (0 if m == "US" else 1 if m == "KR" else 2)

    unique.sort(key=sort_key)

    # 결과가 3개 미만이면 AlphaVantage 추가 호출
    if len(unique) < 3:
        av_results = await _search_alphavantage(q)
        combined2 = unique + av_results
        unique = _deduplicate(combined2)
        unique.sort(key=sort_key)

    return unique[:10]
