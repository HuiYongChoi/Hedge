"""Hankyung Consensus metadata provider.

1차 구현: 리포트 메타데이터 조회만. PDF 파싱 + LLM EPS 추출은 v3 범위.
실패 시 빈 리스트 반환.

v3 TODO: consensus.hankyung.com 리포트 목록 → 최근 PDF URL 추출
         → LLM으로 다음 분기 EPS 컨센서스 추출 → QuarterlyEPS 반환.
"""
from __future__ import annotations

import logging
from datetime import date

from src.data.models_forward import QuarterlyEPS

logger = logging.getLogger(__name__)


class HankyungMetaProvider:
    name = "HankyungConsensus"

    def fetch_quarterly_eps_estimates(
        self,
        ticker: str,
        as_of_date: date,
        num_quarters: int = 4,
    ) -> list[QuarterlyEPS]:
        # v3 TODO: fetch https://consensus.hankyung.com/apps.analysis/analysis.list
        # filter by ticker, download latest PDF, extract EPS via LLM.
        logger.info("HankyungMetaProvider: not yet implemented for %s; skipping", ticker)
        return []
