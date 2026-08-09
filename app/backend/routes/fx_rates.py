"""환율 조회 — 달러/엔 표시 금액 옆에 원화를 병기하기 위한 최소 엔드포인트.

한국 투자자가 미국/일본 종목을 볼 때 $433.55 만으로는 체감이 안 되므로
화면에서 (약 ₩60만) 처럼 병기한다. 참고용 환산이라 실시간성보다 안정성이 중요해
짧은 메모리 캐시를 두고, 조회 실패 시 500 대신 rate=None 으로 응답해
프론트가 조용히 원화 병기만 생략하도록 한다.
"""

import time
from typing import Optional

from fastapi import APIRouter

router = APIRouter(prefix="/fx-rates", tags=["fx-rates"])

# yfinance 통화쌍 심볼 (base -> KRW)
_PAIR_SYMBOLS = {
    "USD": "KRW=X",
    "JPY": "JPYKRW=X",
}

_CACHE_TTL_SECONDS = 15 * 60
_cache: dict[str, tuple[float, Optional[float]]] = {}


def _fetch_rate(base: str) -> Optional[float]:
    symbol = _PAIR_SYMBOLS.get(base)
    if symbol is None:
        return None
    try:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        info = getattr(ticker, "fast_info", None)
        value = None
        if info is not None:
            value = getattr(info, "last_price", None) or (
                info.get("lastPrice") if hasattr(info, "get") else None
            )
        if value is None:
            history = ticker.history(period="5d")
            if history is not None and not history.empty:
                value = float(history["Close"].dropna().iloc[-1])
        if value is None:
            return None
        rate = float(value)
        return rate if rate > 0 else None
    except Exception:
        # 환율은 부가 정보다. 실패해도 분석 화면 전체를 막지 않는다.
        return None


@router.get("/{base}")
def get_fx_rate(base: str) -> dict:
    """1 <base> 가 몇 원인지 반환한다. 조회 실패 시 rate=None."""
    base_upper = (base or "").strip().upper()
    if base_upper == "KRW":
        return {"base": "KRW", "quote": "KRW", "rate": 1.0, "cached": False}
    if base_upper not in _PAIR_SYMBOLS:
        return {"base": base_upper, "quote": "KRW", "rate": None, "cached": False}

    now = time.time()
    cached = _cache.get(base_upper)
    if cached is not None and now - cached[0] < _CACHE_TTL_SECONDS:
        return {"base": base_upper, "quote": "KRW", "rate": cached[1], "cached": True}

    rate = _fetch_rate(base_upper)
    # 조회 실패 시 직전 성공값이 있으면 그대로 재사용한다(일시적 장애로 병기가 깜빡이지 않도록).
    if rate is None and cached is not None and cached[1] is not None:
        return {"base": base_upper, "quote": "KRW", "rate": cached[1], "cached": True}

    _cache[base_upper] = (now, rate)
    return {"base": base_upper, "quote": "KRW", "rate": rate, "cached": False}
