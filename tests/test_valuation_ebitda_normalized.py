from types import SimpleNamespace

import pytest

from src.agents.valuation import calculate_ebitda_valuation_breakdown


def _metrics(multiples, ebitda_growth=None, ev=1_200.0, market_cap=1_000.0):
    metrics = [
        SimpleNamespace(
            enterprise_value=ev,
            enterprise_value_to_ebitda_ratio=multiples[0],
            market_cap=market_cap,
            ebitda_growth=ebitda_growth,
        )
    ]
    for mult in multiples[1:]:
        metrics.append(
            SimpleNamespace(enterprise_value_to_ebitda_ratio=mult)
        )
    return metrics


def _line_items(ebitdas):
    return [SimpleNamespace(ebitda=e) for e in ebitdas]


def test_normalized_ebitda_uses_mean_with_growth_overlay():
    metrics = _metrics([6.0, 8.0, 10.0], ebitda_growth=0.10)
    line_items = _line_items([100.0, 200.0, 300.0])

    result = calculate_ebitda_valuation_breakdown(metrics, line_items)

    assert result is not None
    # mean(100,200,300)=200, *1.1 growth = 220.
    assert result["normalized_ebitda"] == pytest.approx(220.0)
    assert result["ebitda_growth_applied"] == pytest.approx(0.10)
    # median of [6,8,10] (no clip below 5 samples) = 8.0.
    assert result["target_multiple"] == pytest.approx(8.0)
    assert result["multiple_basis"] == "median"
    assert result["ebitda_sample_size"] == 3


def test_multiple_basis_matches_capex_heavy_selector():
    metrics = _metrics([6.0, 8.0, 10.0, 12.0, 100.0])
    line_items = _line_items([200.0])

    result = calculate_ebitda_valuation_breakdown(metrics, line_items, capex_heavy=True)

    assert result is not None
    assert result["multiple_basis"] == "capex_heavy_p75_clipped"


def test_single_sample_fallback_skips_current_price_tautology_without_external_basis():
    # EV 1200 / current multiple 8 = 150 current EBITDA; single line item also 150.
    metrics = _metrics([8.0], ebitda_growth=None)
    line_items = _line_items([150.0])

    assert calculate_ebitda_valuation_breakdown(metrics, line_items) is None


def test_single_metric_uses_historical_line_items_for_normalized_ebitda_value():
    metrics = _metrics([8.0], ebitda_growth=None)
    line_items = _line_items([150.0, 200.0, 250.0])

    result = calculate_ebitda_valuation_breakdown(metrics, line_items)

    assert result is not None
    assert result["current_ebitda"] == pytest.approx(150.0)
    assert result["normalized_ebitda"] == pytest.approx(200.0)
    assert result["target_multiple"] == pytest.approx(8.0)
    assert result["equity_value"] == pytest.approx(1_400.0)
    assert result["ebitda_sample_size"] == 3


def test_normalized_ebitda_uses_price_backed_target_multiple_when_available():
    metrics = _metrics([6.0], ebitda_growth=None)
    line_items = [
        SimpleNamespace(report_period="2025-12-31", ebitda=200.0, total_debt=250.0, cash_and_equivalents=50.0),
        SimpleNamespace(report_period="2024-12-31", ebitda=150.0, total_debt=250.0, cash_and_equivalents=50.0),
        SimpleNamespace(report_period="2023-12-31", ebitda=100.0, total_debt=200.0, cash_and_equivalents=50.0),
    ]
    prices = [
        SimpleNamespace(time="2023-12-31T00:00:00", close=75.0),
        SimpleNamespace(time="2024-12-31T00:00:00", close=100.0),
        SimpleNamespace(time="2025-12-31T00:00:00", close=100.0),
    ]

    result = calculate_ebitda_valuation_breakdown(
        metrics,
        line_items,
        prices=prices,
        shares_outstanding=10.0,
    )

    assert result is not None
    assert result["normalized_ebitda"] == pytest.approx(150.0)
    assert result["target_multiple"] == pytest.approx(8.0)
    assert result["equity_value"] == pytest.approx(1_000.0)
    assert result["multiple_basis"] == "price_backed_line_items_median"


def test_single_sample_with_growth_keeps_independent_normalized_ebitda():
    metrics = _metrics([8.0], ebitda_growth=0.10)
    line_items = _line_items([150.0])

    result = calculate_ebitda_valuation_breakdown(metrics, line_items)
    assert result is not None
    assert result["current_ebitda"] == pytest.approx(150.0)
    assert result["normalized_ebitda"] == pytest.approx(165.0)
    assert result["ebitda_growth_applied"] == pytest.approx(0.10)


def test_negative_normalized_ebitda_returns_none():
    metrics = _metrics([8.0])
    line_items = _line_items([-100.0, -200.0])

    assert calculate_ebitda_valuation_breakdown(metrics, line_items) is None


def test_missing_enterprise_value_returns_none():
    metrics = [
        SimpleNamespace(
            enterprise_value=0.0,
            enterprise_value_to_ebitda_ratio=8.0,
            market_cap=1_000.0,
            ebitda_growth=None,
        )
    ]
    assert calculate_ebitda_valuation_breakdown(metrics, _line_items([100.0])) is None
