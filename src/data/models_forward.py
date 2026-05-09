"""Forward-looking valuation models.

Forward metrics intentionally live outside ``src.data.models`` so the existing
trailing ``FinancialMetrics`` contract stays untouched.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


SourceKind = Literal["actual", "consensus", "guidance", "llm_extracted"]
ConfidenceKind = Literal["high", "medium", "low"]


class QuarterlyEPS(BaseModel):
    period: str
    fiscal_period_end: date
    eps: float
    source: SourceKind
    provider: str
    as_of: date
    analyst_count: int | None = None
    dispersion: float | None = None

    @field_validator("period", "provider")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("analyst_count")
    @classmethod
    def _analyst_count_non_negative(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("analyst_count must be non-negative")
        return value

    @field_validator("dispersion")
    @classmethod
    def _dispersion_non_negative(cls, value: float | None) -> float | None:
        if value is not None and value < 0:
            raise ValueError("dispersion must be non-negative")
        return value


class ForwardMetrics(BaseModel):
    ticker: str
    as_of_date: date
    current_price: float
    forward_eps_ttm: float
    forward_pe: float | None
    composition: list[QuarterlyEPS] = Field(default_factory=list)
    confidence: ConfidenceKind
    notes: list[str] = Field(default_factory=list)

    model_config = {"extra": "allow"}

    @field_validator("ticker")
    @classmethod
    def _ticker_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("ticker must not be blank")
        return value

    @field_validator("current_price")
    @classmethod
    def _current_price_positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("current_price must be positive")
        return value

    @model_validator(mode="after")
    def _validate_composition(self) -> "ForwardMetrics":
        if len(self.composition) != 4:
            raise ValueError("composition must contain exactly 4 quarters")

        fiscal_ends = [q.fiscal_period_end for q in self.composition]
        if fiscal_ends != sorted(fiscal_ends):
            raise ValueError("composition must be sorted by fiscal_period_end")

        eps_sum = sum(q.eps for q in self.composition)
        if abs(eps_sum - self.forward_eps_ttm) > 1e-6:
            raise ValueError("forward_eps_ttm must equal the sum of composition EPS")

        if self.forward_eps_ttm <= 0 and self.forward_pe is not None:
            raise ValueError("forward_pe must be None when forward_eps_ttm is non-positive")
        if self.forward_eps_ttm > 0 and self.forward_pe is not None and self.forward_pe <= 0:
            raise ValueError("forward_pe must be positive when defined")
        return self


class ForwardMetricsResponse(BaseModel):
    forward_metrics: ForwardMetrics | None = None
