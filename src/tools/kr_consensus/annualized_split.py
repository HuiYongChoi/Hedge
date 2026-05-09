"""Helper: split an annual consensus EPS estimate into individual quarter estimates.

Design note: uses simple equal-weight distribution (계절성 가중 분배는 v3 범위).
"""
from __future__ import annotations

from datetime import date


def split_annual_to_next_quarter(
    annual_eps: float,
    realized_quarters_in_year: list[float],
    as_of: date,
    fiscal_year: int,
) -> tuple[float, int] | None:
    """Return (next_quarter_eps, remaining_quarters) or None if fiscal year is exhausted.

    Parameters
    ----------
    annual_eps:
        Full-year consensus EPS estimate for ``fiscal_year``.
    realized_quarters_in_year:
        Already-reported single-quarter EPS values that belong to ``fiscal_year``.
        Must contain at most 3 values (if all 4 are known the year is done).
    as_of:
        The reference date.  Used only to guard against past-fiscal-year calls.
    fiscal_year:
        The calendar fiscal year the estimate belongs to (e.g. 2026).

    Returns
    -------
    (next_quarter_eps, remaining_quarters) where remaining_quarters is the number
    of unreported quarters, or None when the year has no remaining quarters.
    """
    remaining = 4 - len(realized_quarters_in_year)
    if remaining <= 0:
        return None

    residual = annual_eps - sum(realized_quarters_in_year)
    next_q_eps = residual / remaining
    return next_q_eps, remaining


def next_quarter_end(fiscal_year: int, realized_quarters_in_year: list) -> date | None:
    """Return the fiscal_period_end date for the next unreported quarter."""
    next_q_num = len(realized_quarters_in_year) + 1
    if next_q_num > 4:
        return None
    month = next_q_num * 3
    day = 31 if month in (3, 12) else 30
    return date(fiscal_year, month, day)
