"""Unit tests for calculate_pbr_band and detect_capex_regime."""
import pytest
from unittest.mock import MagicMock
from src.agents.valuation import calculate_pbr_band, detect_capex_regime


def _metric(pbr: float, bvps: float = 96000.0):
    m = MagicMock()
    m.price_to_book_ratio = pbr
    m.book_value_per_share = bvps
    m.report_period = "FY24"
    return m


def test_pbr_band_basic():
    metrics = [
        _metric(1.42), _metric(0.95), _metric(0.85),
        _metric(1.10), _metric(1.55),
    ]
    out = calculate_pbr_band(
        metrics,
        current_price=1_800_000,
        shares_outstanding=728e6,
        revenue_growth=0.25,
    )
    assert out is not None
    assert out["position_label"] in {"p25_p50", "p50_p75", "below_p25", "above_p75"}
    p50 = out["percentiles"]["p50"]
    assert out["fair_price_p50"] == pytest.approx(96000 * p50, rel=0.01)
    assert out["rerating_note"] is not None  # rev_growth 0.25 > 0.20


def test_pbr_band_insufficient_history_returns_none():
    metrics = [_metric(1.42), _metric(0.95), _metric(0.85)]  # only 3
    assert calculate_pbr_band(metrics, current_price=1e6, shares_outstanding=1e6) is None


def test_pbr_band_no_rerating_when_low_growth():
    metrics = [_metric(1.20), _metric(0.90), _metric(0.80), _metric(1.10)]
    out = calculate_pbr_band(
        metrics,
        current_price=1_000_000,
        shares_outstanding=500e6,
        revenue_growth=0.10,  # below 0.20 threshold
    )
    assert out is not None
    assert out["rerating_note"] is None


def test_pbr_band_position_below_p25():
    # force a low current PBR by making first metric very low
    metrics = [_metric(0.50), _metric(1.50), _metric(2.00), _metric(1.80)]
    out = calculate_pbr_band(metrics, current_price=500_000, shares_outstanding=100e6)
    assert out is not None
    assert out["position_label"] == "below_p25"
    assert out["signal"] == "bullish"


def test_pbr_band_position_above_p75():
    # force a high current PBR
    metrics = [_metric(3.00), _metric(1.50), _metric(1.20), _metric(0.90)]
    out = calculate_pbr_band(metrics, current_price=3_000_000, shares_outstanding=100e6)
    assert out is not None
    assert out["position_label"] == "above_p75"
    assert out["signal"] == "bearish"


def test_pbr_band_missing_bvps_returns_none():
    metrics = [
        _metric(1.42, bvps=None), _metric(0.95, bvps=None),
        _metric(0.85, bvps=None), _metric(1.10, bvps=None),
    ]
    assert calculate_pbr_band(metrics, current_price=1e6, shares_outstanding=100e6) is None


def test_pbr_band_filters_zero_pbr():
    # 3 valid + 2 zeros → only 3 valid → returns None (< 4)
    metrics = [
        _metric(1.42), _metric(0.95), _metric(0.85),
        MagicMock(price_to_book_ratio=0, book_value_per_share=96000, report_period="FY21"),
        MagicMock(price_to_book_ratio=None, book_value_per_share=96000, report_period="FY20"),
    ]
    assert calculate_pbr_band(metrics, current_price=1e6, shares_outstanding=100e6) is None


# ------- detect_capex_regime tests -------

def test_detect_capex_regime_heavy_by_ratio():
    assert detect_capex_regime(capex=3e12, revenue=10e12, fcf_history=[1e12, 2e12, 1.5e12]) == "capex_heavy"


def test_detect_capex_regime_heavy_by_volatility():
    # Only 1 positive FCF → calculate_fcf_volatility returns 0.8 (high volatility)
    fcf = [1e12, -5e12, -2e12, -3e12, -1e12]
    assert detect_capex_regime(capex=0.05e12, revenue=10e12, fcf_history=fcf) == "capex_heavy"


def test_detect_capex_regime_default():
    assert detect_capex_regime(capex=1e12, revenue=20e12, fcf_history=[5e12, 4e12, 6e12, 5.5e12]) == "default"


def test_detect_capex_regime_none_capex():
    result = detect_capex_regime(capex=None, revenue=10e12, fcf_history=[5e12, 4e12, 6e12])
    assert result in {"default", "capex_heavy"}
