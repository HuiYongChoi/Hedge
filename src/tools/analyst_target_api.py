"""증권사 컨센서스 목표가 + 현재가 + 기본 펀더멘털 fetcher (FMP + yfinance)."""
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
    trailing_pe: Optional[float]     # TTM P/E (yfinance info)
    trailing_eps: Optional[float]    # TTM EPS (yfinance info)
    forward_eps: Optional[float]     # Next-year EPS estimate (yfinance info)
    forward_pe: Optional[float]      # Next-year P/E (yfinance info)
    source: str  # "FMP" / "stub"


def _fetch_yfinance_data(ticker: str) -> dict:
    """yfinance로 현재가 + 기본 펀더멘털(PE/EPS) fetch. 실패하면 빈 dict."""
    out: dict = {}
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)

        # 현재가: fast_info (빠르고 안정적)
        price = getattr(t.fast_info, "last_price", None)
        if price and float(price) > 0:
            out["current_price"] = float(price)

        # 펀더멘털: info dict (TTM/forward PE, EPS)
        info = t.info or {}
        mapping = [
            ("trailingPE",  "trailing_pe"),
            ("forwardPE",   "forward_pe"),
            ("trailingEps", "trailing_eps"),
            ("forwardEps",  "forward_eps"),
        ]
        for src_key, dst_key in mapping:
            val = info.get(src_key)
            if val is not None and isinstance(val, (int, float)) and float(val) > 0:
                out[dst_key] = float(val)
    except Exception as e:
        logger.debug("yfinance data fetch failed for %s: %s", ticker, e)
    return out


def fetch_analyst_target(ticker: str) -> AnalystTarget:
    cached = _CACHE.get(ticker)
    now = time.time()
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    # 1) FMP consensus + summary
    consensus_data: dict = {}
    summary_data: dict = {}
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
    except Exception as e:
        logger.debug("FMP fetch failed for %s: %s", ticker, e)

    # 2) yfinance: current price + fundamentals
    yf_data = _fetch_yfinance_data(ticker)

    result = AnalystTarget(
        consensus=consensus_data.get("targetConsensus"),
        high=consensus_data.get("targetHigh"),
        low=consensus_data.get("targetLow"),
        median=consensus_data.get("targetMedian"),
        analyst_count=summary_data.get("lastQuarter") or summary_data.get("lastMonth"),
        current_price=yf_data.get("current_price"),
        trailing_pe=yf_data.get("trailing_pe"),
        trailing_eps=yf_data.get("trailing_eps"),
        forward_eps=yf_data.get("forward_eps"),
        forward_pe=yf_data.get("forward_pe"),
        source="FMP" if consensus_data else "stub",
    )

    _CACHE[ticker] = (now, result)
    return result
