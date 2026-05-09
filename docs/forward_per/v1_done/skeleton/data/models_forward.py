"""Forward-looking valuation models.

This module defines pydantic models for "forward TTM EPS" — a synthetic EPS
formed by splicing the most recent 3 quarters of *actual* reported EPS with the
next 1 quarter of *consensus estimate* EPS — and the resulting forward P/E.

Design intent:
- Kept in a separate module from `models.py` so that the existing
  `FinancialMetrics` (trailing-only) flow is not perturbed.
- Each composing quarter carries its own `source` and `provider`, so analyst
  agents can disclose in their reports which portion is forecast vs. actual.
- `confidence` is the single field most agents will use to decide whether to
  weight forward PER at all — see DESIGN.md §2.4.

Codex: implement field validators where helpful (e.g., composition length == 4
when forward_eps_ttm is non-null). Keep this file Pydantic-v2 compatible to
match the rest of `src/data/models.py`.
"""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


SourceKind = Literal["actual", "consensus", "guidance", "llm_extracted"]


class QuarterlyEPS(BaseModel):
    period: str                       # "2026Q1"
    fiscal_period_end: date
    eps: float
    source: SourceKind
    provider: str                     # "FMP", "YFinance", "DART", "LLM-fallback", ...
    as_of: date
    analyst_count: int | None = None
    dispersion: float | None = None   # standard deviation of estimates, if available


class ForwardMetrics(BaseModel):
    ticker: str
    as_of_date: date
    current_price: float
    forward_eps_ttm: float
    forward_pe: float | None         # None when forward_eps_ttm <= 0
    composition: list[QuarterlyEPS] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"]
    notes: list[str] = Field(default_factory=list)

    # Allow adapter-specific fields without breaking parsing.
    model_config = {"extra": "allow"}


class ForwardMetricsResponse(BaseModel):
    forward_metrics: ForwardMetrics | None = None
