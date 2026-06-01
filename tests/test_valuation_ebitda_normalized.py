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


def test_single_sample_fallback_skips_current_price_tautology_without_growth():
    # EV 1200 / current multiple 8 = 150 current EBITDA; single line item also 150.
    metrics = _metrics([8.0], ebitda_growth=None)
    line_items = _line_items([150.0])

    assert calculate_ebitda_valuation_breakdown(metrics, line_items) is None


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
