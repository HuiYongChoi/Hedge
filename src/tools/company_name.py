"""Resolve a stock ticker to its official company name.

Priority order:
  1. Korean tickers (*.KS / *.KQ / 6-digit codes) → DART corp_name via OpenDartReader
  2. yfinance longName (works for most US/global tickers)
  3. FMP /profile endpoint
  4. Fallback: return the normalized ticker itself

All results are cached in-process via @lru_cache so each ticker is fetched
at most once per process lifetime.  Call resolve_company_name.cache_clear()
in tests to reset between cases.
"""

from __future__ import annotations

import logging
import os
import re
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

_KR_SUFFIX_RE = re.compile(r"\.(KS|KQ|KP)$", re.IGNORECASE)
_KR_CODE_RE = re.compile(r"^\d{6}$")


def _is_korean_ticker(ticker: str) -> bool:
    return bool(_KR_SUFFIX_RE.search(ticker) or _KR_CODE_RE.match(ticker))


def _strip_kr_suffix(ticker: str) -> str:
    """005930.KS → '005930'"""
    return _KR_SUFFIX_RE.sub("", ticker)


# ──────────────────────────────────────────────────────────────────────────────
# Provider implementations
# ──────────────────────────────────────────────────────────────────────────────

def _resolve_dart(ticker: str) -> Optional[str]:
    """DART corp_name for Korean tickers via OpenDartReader."""
    stock_code = _strip_kr_suffix(ticker)
    try:
        from src.tools.dart_api import _get_dart  # noqa: PLC0415
        dart = _get_dart()
        if dart is None:
            return None
        info = dart.company(stock_code)
        if info and isinstance(info, dict) and info.get("status") == "000":
            name = info.get("corp_name") or info.get("corp_name_eng")
            if name and name.strip():
                return name.strip()
    except Exception as exc:
        logger.debug("DART corp_name 조회 실패 [%s]: %s", ticker, exc)
    return None


def _resolve_yfinance(ticker: str) -> Optional[str]:
    try:
        import yfinance as yf  # noqa: PLC0415
        info = yf.Ticker(ticker).info
        name = info.get("longName") or info.get("shortName")
        if name and name.strip():
            return name.strip()
    except Exception as exc:
        logger.debug("yfinance 회사명 조회 실패 [%s]: %s", ticker, exc)
    return None


def _resolve_fmp(ticker: str) -> Optional[str]:
    api_key = os.environ.get("FINANCIAL_DATASETS_API_KEY") or os.environ.get("FMP_API_KEY")
    if not api_key:
        return None
    try:
        import urllib.request, json as _json  # noqa: PLC0415, E401
        url = f"https://financialmodelingprep.com/api/v3/profile/{ticker}?apikey={api_key}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = _json.loads(resp.read())
        if data and isinstance(data, list) and data[0].get("companyName"):
            return data[0]["companyName"].strip()
    except Exception as exc:
        logger.debug("FMP 회사명 조회 실패 [%s]: %s", ticker, exc)
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=512)
def resolve_company_name(ticker: str, language: str = "ko") -> str:
    """Return the official company name for *ticker*.

    Falls back to the normalized ticker string if all providers fail.
    The *language* parameter is reserved for future locale-aware lookups;
    currently it has no effect on the resolution logic.
    """
    normalized = (ticker or "").strip().upper()
    if not normalized:
        return ticker

    if _is_korean_ticker(normalized):
        name = _resolve_dart(normalized)
        if name:
            return name

    name = _resolve_yfinance(normalized)
    if name:
        return name

    name = _resolve_fmp(normalized)
    if name:
        return name

    return normalized
