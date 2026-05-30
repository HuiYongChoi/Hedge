"""Context-aware growth-trend reading for financial series.

Agents historically scored growth with a single endpoint-to-endpoint CAGR or a
single latest year-over-year number. Both misread deep cyclicals (e.g. memory
chips): an endpoint CAGR reads ~flat when both endpoints happen to sit on
cyclical peaks, while a bare latest-YoY explodes off a depressed base year. The
helper here reads the *whole* series — long-run trend, recent momentum, cycle
position, consistency, and loss years — and returns a 0..3 strength score plus
a human-readable label.

Series are expected newest -> oldest, matching how the line-item APIs return
them.
"""
from __future__ import annotations


def _cagr(latest: float, oldest: float, periods: int) -> float | None:
    if latest and latest > 0 and oldest and oldest > 0 and periods > 0:
        return (latest / oldest) ** (1 / periods) - 1
    return None


def assess_trend(
    values,
    *,
    noun: str = "EPS",
    strong: float = 0.08,
    moderate: float = 0.04,
    slight: float = 0.01,
) -> tuple[int, str]:
    """Read the full-series context of a financial metric.

    Args:
        values: series newest -> oldest.
        noun: label noun used in the returned string (e.g. "EPS", "revenue").
        strong/moderate/slight: per-year CAGR cutoffs for the *steady* (non-cyclical)
            path, so each investor keeps their own growth bar (Druckenmiller ~8%,
            Phil Fisher ~20%, Lynch ~15%, Cathie ~100%). The cyclical path scores by
            cycle position and is philosophy-agnostic.

    Returns:
        (points, label) where points is an int in 0..3.
    """
    vals = [v for v in values if v is not None]
    if len(vals) < 2:
        return 0, f"Not enough {noun} data points to read a trend."

    latest = vals[0]
    prior = vals[1]
    oldest = vals[-1]
    peak = max(vals)
    trough = min(vals)
    steps = len(vals) - 1
    chrono = list(reversed(vals))  # oldest -> newest
    up_years = sum(1 for i in range(1, len(chrono)) if chrono[i] > chrono[i - 1])

    has_loss = any(v <= 0 for v in vals)
    recovering = latest > prior
    yoy = (latest - prior) / abs(prior) if prior not in (0, None) else None
    pct_of_peak = latest / peak if peak > 0 else None
    # "Cyclical" = a loss year in the window, or a deep peak-to-trough swing.
    cyclical = has_loss or (peak > 0 and trough < 0.5 * peak)

    if cyclical:
        if latest <= 0:
            return 0, f"{noun} still negative — cyclical trough not yet cleared"
        near_peak = pct_of_peak is not None and pct_of_peak >= 0.85
        if recovering and pct_of_peak is not None and pct_of_peak >= 0.999:
            return 3, f"Cyclical {noun} at a fresh cycle high ({up_years}/{steps} yrs up)"
        if recovering and near_peak:
            return 3, (
                f"Cyclical {noun} recovered to {pct_of_peak:.0%} of the prior peak "
                f"({up_years}/{steps} yrs up)"
            )
        if recovering:
            tail = f" to {pct_of_peak:.0%} of the prior peak" if pct_of_peak is not None else ""
            return 2, f"Cyclical {noun} recovering off the trough{tail}"
        if yoy is not None:
            return 1, f"Cyclical {noun} easing back ({yoy:+.1%} YoY) after a rebound"
        return 1, f"Cyclical {noun} easing back after a rebound"

    # Steady (no loss, contained swings): combine the multi-year trend with
    # recent momentum and consistency so a single strong endpoint can't carry
    # the score on its own.
    cagr = _cagr(latest, oldest, steps)
    if cagr is None:
        return 1, f"{noun} positive but trend unclear"
    mostly_up = up_years >= max(1, steps - 1)
    if cagr > strong and (yoy is None or yoy > 0) and mostly_up:
        return 3, f"Strong, consistent {noun} growth: {cagr:.1%} CAGR/yr ({up_years}/{steps} yrs up)"
    if cagr > strong and yoy is not None and yoy <= 0:
        return 2, f"{noun} up {cagr:.1%} CAGR/yr but the latest year softened ({yoy:+.1%} YoY)"
    if cagr > moderate:
        return 2, f"Moderate {noun} growth: {cagr:.1%} CAGR/yr"
    if cagr > slight:
        return 1, f"Slight {noun} growth: {cagr:.1%} CAGR/yr"
    return 0, f"Flat/declining {noun}: {cagr:.1%} CAGR/yr"


def scale_points(points: int, max_points: int) -> int:
    """Map a 0..3 strength score onto an agent's own point bucket."""
    return round(points / 3 * max_points)
