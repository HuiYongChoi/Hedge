"""증권사 컨센서스 목표가 + 현재가 fetcher (FMP + yfinance)."""
from __future__ import annotations
import logging
import time
from dataclasses import dataclass
from typing import Optional
import requests

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/stable"
_FMP_KEY = "WnoeVdSBlKezrKNExH7jtXfEWXg8YrtE"

# In-memory cache: ticker → (timestamp, result)
_CACHE: dict[str, tuple[float, "AnalystTarget"]] = {}
_TTL_SECONDS = 6 * 3600  # 6 hours


@dataclass
class AnalystTarget:
    consensus: Optional[float]
    high: Optional[float]
    low: Optional[float]
    median: Optional[float]
    analyst_count: Optional[int]
    current_price: Optional[float]   # 현재 주가 (yfinance fallback)
    source: str  # "FMP" / "stub"


def _fetch_current_price_yfinance(ticker: str) -> Optional[float]:
    """yfinance로 현재가 fetch. 실패하면 None."""
    try:
        import yfinance as yf
        fast_info = yf.Ticker(ticker).fast_info
        price = getattr(fast_info, "last_price", None)
        if price and price > 0:
            return float(price)
    except Exception as e:
        logger.debug("yfinance price fetch failed for %s: %s", ticker, e)
    return None


def fetch_analyst_target(ticker: str) -> AnalystTarget:
    cached = _CACHE.get(ticker)
    now = time.time()
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    try:
        r_consensus = requests.get(
            f"{_FMP_BASE}/price-target-consensus",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        r_summary = requests.get(
            f"{_FMP_BASE}/price-target-summary",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        consensus_data = r_consensus.json()[0] if r_consensus.ok and r_consensus.json() else {}
        summary_data = r_summary.json()[0] if r_summary.ok and r_summary.json() else {}

        current_price = _fetch_current_price_yfinance(ticker)

        result = AnalystTarget(
            consensus=consensus_data.get("targetConsensus"),
            high=consensus_data.get("targetHigh"),
            low=consensus_data.get("targetLow"),
            median=consensus_data.get("targetMedian"),
            analyst_count=summary_data.get("lastQuarter") or summary_data.get("lastMonth"),
            current_price=current_price,
            source="FMP",
        )
    except Exception as e:
        logger.debug("analyst target fetch failed for %s: %s", ticker, e)
        current_price = _fetch_current_price_yfinance(ticker)
        result = AnalystTarget(None, None, None, None, None, current_price, source="stub")

    _CACHE[ticker] = (now, result)
    return result
