"""Unit tests for the shared context-aware trend reader.

These exercise the pure helper (no agent/LLM/network deps) so they run anywhere.
"""
from src.utils.growth_trend import assess_trend, scale_points


# Real MU annual EPS (newest -> oldest): a V-shaped memory cycle. Both endpoints
# ($7.65, $7.81) are cyclical peaks and FY2023 was a deep loss (-$5.34), so an
# endpoint CAGR reads ~flat while a bare latest-YoY explodes to +992%.
MU_EPS = [7.65, 0.70, -5.34, 7.81]
MU_REV = [37_378_000_000.0, 25_111_000_000.0, 15_540_000_000.0, 30_758_000_000.0]


def test_cyclical_v_recovery_not_decline():
    points, label = assess_trend(MU_EPS, noun="EPS")
    assert points == 3
    assert "Cyclical EPS recovered to" in label
    assert "of the prior peak" in label
    # The +992% base-effect YoY must never surface.
    assert "992" not in label


def test_cyclical_fresh_high():
    points, label = assess_trend(MU_REV, noun="revenue")
    assert points == 3
    assert "fresh cycle high" in label


def test_still_negative_trough_scores_zero():
    # Latest value still in the red -> not yet recovered.
    points, label = assess_trend([-1.0, -3.0, 2.0], noun="EPS")
    assert points == 0
    assert "still negative" in label


def test_monotonic_growth_uses_cagr():
    points, label = assess_trend([2.0, 1.8, 1.5], noun="EPS")
    assert points == 3
    assert "CAGR/yr" in label
    assert "Cyclical" not in label


def test_softening_latest_year_caps_at_two():
    # Up over the window but the latest year rolled over.
    points, label = assess_trend([110.0, 130.0, 100.0, 80.0], noun="EPS")
    assert points == 2
    assert "softened" in label


def test_flat_or_declining_scores_zero():
    points, label = assess_trend([100.0, 110.0, 120.0], noun="EPS")
    assert points == 0
    assert "Flat/declining" in label


def test_thresholds_are_configurable():
    # ~9.5%/yr CAGR. With default 8% bar -> strong (3). With Fisher's 20% bar it
    # is merely moderate (2), so each investor keeps their own growth bar.
    series = [120.0, 110.0, 100.0]
    assert assess_trend(series, noun="revenue")[0] == 3
    assert assess_trend(series, noun="revenue", strong=0.20, moderate=0.05, slight=0.02)[0] == 2


def test_insufficient_data():
    points, label = assess_trend([5.0], noun="EPS")
    assert points == 0
    assert "Not enough" in label


def test_scale_points_maps_onto_bucket():
    assert scale_points(0, 2) == 0
    assert scale_points(3, 2) == 2
    assert scale_points(3, 10) == 10
    assert scale_points(0, 10) == 0
