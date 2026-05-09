"""Analyst consensus estimate providers.

This module isolates the "where do we get next-quarter EPS estimates from"
concern behind an `EstimateProvider` protocol so the splicing logic in
`forward_metrics.py` does not care about source-specific quirks.

Implementation order (Codex):
1. FMPEstimateProvider   — highest priority for US tickers (FMP free tier
   exposes /api/v3/analyst-estimates/{symbol}?period=quarter).
2. YFinanceEstimateProvider — fallback for US/global; uses
   yfinance.Ticker(t).earnings_estimate / .eps_trend.
3. KrFnGuideProvider     — stub for Korean tickers (paid source); leave a
   TODO and return [] for now.
4. LLMEstimateProvider   — last-resort fallback; pulls guidance text from
   DART filings + recent news, asks the LLM to extract a single
   next-quarter EPS estimate. Confidence is always "low".

Routing is the caller's job (see forward_metrics.resolve_provider_chain).

Each provider MUST:
- never raise; on error log at WARNING and return [].
- return at most `num_quarters` items, sorted ascending by fiscal_period_end.
- normalize to *adjusted diluted* EPS where the source distinguishes; record
  the canonical `provider` string for traceability.
"""
from __future__ import annotations

import logging
import os
from datetime import date
from typing import Protocol

# IMPORTANT: when this skeleton is moved into src/tools/, change the import
# path below to `from src.data.models_forward import QuarterlyEPS`.
from .models_forward import QuarterlyEPS  # type: ignore[import-not-found]

logger = logging.getLogger(__name__)


class EstimateProvider(Protocol):
    name: str

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]: ...


# ---------------------------------------------------------------------------
# FMP (Financial Modeling Prep) — primary US provider
# ---------------------------------------------------------------------------
class FMPEstimateProvider:
    name = "FMP"

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or os.environ.get("FMP_API_KEY")

    def fetch_quarterly_eps_estimates(
        self, ticker: str, as_of_date: date, num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        # TODO(codex): GET https://financialmodelingprep.com/api/v3/analyst-estimates/{ticker}
        #              ?period=quarter&apikey={self._api_key}
        # - Filter to entries with date > as_of_date.
        # - Map estimatedEpsAvg → eps, numberAnalystEstimatedEps → analyst_count,
        #   estimatedEpsHigh/Low → dispersion (use stdev approximation if needed).
        # - source="consensus", provider=self.name.
        # - Return at most num_quarters, sorted ascending by date.
        # - On HTTP/parse error: logger.warning(...) and return [].
        raise NotImplementedError


# ---------------------------------------------------------------------------
# yfinance — fallback US/global provider
# ---------------------------------------------------------------------------
class YFinanceEstimateProvider:
    name = "YFinance"

    def fetch_quarterly_eps_estimates(
        self, ticker: str, as_of_date: date, num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        # TODO(codex): import yfinance only inside the function (heavy import).
        # - tk = yfinance.Ticker(ticker); df = tk.earnings_estimate
        #   (Pandas DataFrame indexed by period like '0q', '+1q', '0y', '+1y')
        # - Map '+1q' row → next quarter estimate; eps = avg, analyst_count = numberOfAnalysts.
        # - Use tk.calendar to derive fiscal_period_end if available.
        # - source="consensus", provider=self.name. Return [] on any failure.
        raise NotImplementedError


# ---------------------------------------------------------------------------
# 한국 — 1차에선 stub. 추후 에프앤가이드/와이즈에프엔 유료 어댑터로 교체.
# ---------------------------------------------------------------------------
class KrFnGuideProvider:
    name = "KrFnGuide"

    def fetch_quarterly_eps_estimates(
        self, ticker: str, as_of_date: date, num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        # TODO(codex): leave as stub for v1 PR. Just return [] and log at INFO.
        logger.info("KrFnGuideProvider not implemented; falling through for %s", ticker)
        return []


# ---------------------------------------------------------------------------
# LLM 폴백 — 가이던스/뉴스에서 추정치 추출
# ---------------------------------------------------------------------------
class LLMEstimateProvider:
    name = "LLM-fallback"

    def fetch_quarterly_eps_estimates(
        self, ticker: str, as_of_date: date, num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        # TODO(codex): use src/utils/llm.py + DART filings (for KR) or recent
        # company_news (for US). Prompt the LLM to extract a single
        # next-quarter EPS estimate with a confidence score.
        # - source="llm_extracted", provider=self.name.
        # - analyst_count=None, dispersion=None.
        # - Return [] if no usable estimate could be extracted.
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Public chain helper
# ---------------------------------------------------------------------------
def default_provider_chain(ticker: str) -> list[EstimateProvider]:
    """Return providers in priority order for the given ticker.

    Korean tickers (e.g., "005930.KS") prefer KrFnGuide → LLM.
    Everything else prefers FMP → YFinance → LLM.
    """
    # TODO(codex): import _is_korean_ticker from src.tools.api to avoid duplicating logic.
    if ticker.endswith((".KS", ".KQ")):
        return [KrFnGuideProvider(), LLMEstimateProvider()]
    return [FMPEstimateProvider(), YFinanceEstimateProvider(), LLMEstimateProvider()]
