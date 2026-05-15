"""Unit tests for calculate_residual_income_breakdown."""
from src.agents.valuation import calculate_residual_income_breakdown


def test_rim_breakdown_normal_case():
    out = calculate_residual_income_breakdown(
        market_cap=120e12,
        net_income=20e12,
        price_to_book_ratio=1.7,
        shares_outstanding=728e6,
        book_value_growth=0.08,
        cost_of_equity=0.10,
    )
    assert out is not None
    assert out["roe_implied"] > 0
    assert out["spread_roe_ke"] > 0
    assert out["intrinsic_per_share"] is not None
    assert out["intrinsic_per_share"] > 0
    assert "book_value" in out
    assert out["book_value"] > 0
    assert out["present_value_ri"] > 0
    assert out["terminal_pv_ri"] > 0


def test_rim_breakdown_negative_ri():
    # ROE ~1%, Ke 10% → ri0 음수 → BV-only fallback
    out = calculate_residual_income_breakdown(
        market_cap=100e12,
        net_income=1e12,
        price_to_book_ratio=1.0,
        shares_outstanding=100e6,
    )
    assert out is not None
    assert out["ri_year_1"] == 0
    assert out["present_value_ri"] == 0
    assert out["terminal_pv_ri"] == 0
    assert out["intrinsic_total"] == out["book_value"]


def test_rim_breakdown_missing_market_cap_returns_none():
    assert calculate_residual_income_breakdown(None, 1e12, 1.0, 1e6) is None


def test_rim_breakdown_zero_pbr_returns_none():
    assert calculate_residual_income_breakdown(100e12, 10e12, 0, 100e6) is None


def test_rim_breakdown_negative_pbr_returns_none():
    assert calculate_residual_income_breakdown(100e12, 10e12, -1.0, 100e6) is None


def test_rim_breakdown_no_shares_gives_none_per_share():
    out = calculate_residual_income_breakdown(
        market_cap=100e12,
        net_income=15e12,
        price_to_book_ratio=1.5,
        shares_outstanding=None,
    )
    assert out is not None
    assert out["intrinsic_per_share"] is None
    assert out["book_value_per_share"] is None


def test_rim_breakdown_spread_and_gap():
    out = calculate_residual_income_breakdown(
        market_cap=100e12,
        net_income=20e12,
        price_to_book_ratio=2.0,
        shares_outstanding=500e6,
        cost_of_equity=0.10,
    )
    assert out is not None
    bv = 100e12 / 2.0
    assert abs(out["book_value"] - bv) < 1
    assert abs(out["roe_implied"] - (20e12 / bv)) < 1e-9
    assert abs(out["spread_roe_ke"] - (out["roe_implied"] - 0.10)) < 1e-9
    assert out["gap_to_market_cap"] is not None
