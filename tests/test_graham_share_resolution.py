"""Ben Graham valuation must use the point-in-time share snapshot.

The financialdatasets TTM line item can sum ``outstanding_shares`` across
quarters (~4x the real float on US tickers like MU). Graham's margin of safety
compares the Graham Number to a per-share price computed as
``market_cap / shares``, so a 4x-inflated share count deflates that price by 4x
and silently inflates the margin of safety. The agent now prefers the
``metrics[0]`` snapshot, which is consistent with the share base behind market
cap, falling back to the line item only when the snapshot is missing.
"""
import math
from types import SimpleNamespace

from src.agents.ben_graham import analyze_valuation_graham


def _line_item(shares):
    return SimpleNamespace(
        current_assets=100_000_000_000.0,
        total_liabilities=50_000_000_000.0,
        book_value_per_share=40.0,
        earnings_per_share=10.0,
        outstanding_shares=shares,
    )


# market_cap / 1.116B real shares = $1,000 real price; the summed TTM count is 4x.
_MARKET_CAP = 1_116_000_000_000.0
_REAL_SHARES = 1_116_000_000.0
_INFLATED_SHARES = 4_464_000_000.0
_GRAHAM_NUMBER = math.sqrt(22.5 * 10.0 * 40.0)  # ≈ 94.87


def test_graham_prefers_metrics_snapshot_over_summed_ttm():
    # Line item carries the inflated 4x count; metrics[0] carries the real float.
    res = analyze_valuation_graham(
        [_line_item(_INFLATED_SHARES)], _MARKET_CAP, [SimpleNamespace(outstanding_shares=_REAL_SHARES)]
    )
    metrics = res["metrics"]
    # Per-share price must reflect the real float ($1,000), not the deflated $250.
    assert math.isclose(metrics["current_price"], 1000.0, rel_tol=1e-6)
    expected_mos = (_GRAHAM_NUMBER - 1000.0) / 1000.0
    assert math.isclose(metrics["margin_of_safety"], expected_mos, rel_tol=1e-6)
    # The inflated path would have reported a much less bearish ~-62% margin.
    inflated_mos = (_GRAHAM_NUMBER - 250.0) / 250.0
    assert abs(metrics["margin_of_safety"] - inflated_mos) > 0.2


def test_graham_falls_back_to_line_item_without_metrics():
    res = analyze_valuation_graham([_line_item(_REAL_SHARES)], _MARKET_CAP, None)
    assert math.isclose(res["metrics"]["current_price"], 1000.0, rel_tol=1e-6)
