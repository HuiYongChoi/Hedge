from types import SimpleNamespace

import pytest

from src.agents.valuation import calculate_ev_ebit_breakdown


def _metrics(rows):
    """rows: list of (enterprise_value, operating_income, market_cap)."""
    out = []
    for ev, oi, mcap in rows:
        out.append(
            SimpleNamespace(
                enterprise_value=ev,
                operating_income=oi,
                market_cap=mcap,
            )
        )
    return out


def test_ev_ebit_breakdown_uses_median_multiple_and_net_debt():
    # EV/EBIT per period: 1200/150=8, 1600/200=8, 2000/200=10 → median 8.
    metrics = _metrics([
        (1_200.0, 150.0, 1_000.0),
        (1_600.0, 200.0, 0.0),
        (2_000.0, 200.0, 0.0),
    ])

    result = calculate_ev_ebit_breakdown(metrics)

    assert result is not None
    assert result["current_multiple"] == pytest.approx(8.0)
    assert result["median_multiple"] == pytest.approx(8.0)
    assert result["ebit_now"] == pytest.approx(150.0)
    assert result["net_debt"] == pytest.approx(200.0)
    # ev_implied 8 * 150 = 1200, minus net_debt 200 = 1000.
    assert result["equity_value"] == pytest.approx(1_000.0)
    assert result["sample_size"] == 3


def test_ev_ebit_breakdown_guards_negative_ebit():
    # Current EBIT negative → multiple meaningless → None.
    metrics = _metrics([(1_200.0, -50.0, 1_000.0)])
    assert calculate_ev_ebit_breakdown(metrics) is None


def test_ev_ebit_breakdown_skips_single_snapshot_without_external_basis():
    metrics = _metrics([(1_200.0, 150.0, 1_000.0)])
    assert calculate_ev_ebit_breakdown(metrics) is None


def test_ev_ebit_breakdown_uses_price_backed_line_item_multiples():
    metrics = [
        SimpleNamespace(
            enterprise_value=1_200.0,
            operating_income=150.0,
            market_cap=1_000.0,
        )
    ]
    line_items = [
        SimpleNamespace(report_period="2025-12-31", operating_income=150.0, total_debt=250.0, cash_and_equivalents=50.0),
        SimpleNamespace(report_period="2024-12-31", operating_income=100.0, total_debt=250.0, cash_and_equivalents=50.0),
        SimpleNamespace(report_period="2023-12-31", operating_income=90.0, total_debt=200.0, cash_and_equivalents=50.0),
    ]
    prices = [
        SimpleNamespace(time="2023-12-31T00:00:00", close=75.0),
        SimpleNamespace(time="2024-12-31T00:00:00", close=100.0),
        SimpleNamespace(time="2025-12-31T00:00:00", close=100.0),
    ]

    result = calculate_ev_ebit_breakdown(
        metrics,
        line_items=line_items,
        prices=prices,
        shares_outstanding=10.0,
    )

    assert result is not None
    # Price-backed EV/EBIT: 1200/150=8, 1200/100=12, 900/90=10 -> median 10.
    assert result["median_multiple"] == pytest.approx(10.0)
    assert result["current_multiple"] == pytest.approx(8.0)
    assert result["ebit_now"] == pytest.approx(150.0)
    assert result["equity_value"] == pytest.approx(1_300.0)
    assert result["multiple_basis"] == "price_backed_line_items_median"
    assert result["sample_size"] == 3


def test_ev_ebit_breakdown_constant_denominator_prefers_price_backed():
    # Repeated TTM operating income (150) with only EV moving makes the per-row
    # EV/EBIT multiples collapse to median(EV)/150 — i.e. median(EV) − net_debt,
    # identical to EV/EBITDA. With annual line items + prices the card must instead
    # use a genuinely independent price-backed multiple.
    metrics = _metrics([
        (1_200.0, 150.0, 1_000.0),  # 8.00
        (1_600.0, 150.0, 1_000.0),  # 10.67
        (2_000.0, 150.0, 1_000.0),  # 13.33
    ])
    line_items = [
        SimpleNamespace(report_period="2025-12-31", operating_income=150.0, total_debt=250.0, cash_and_equivalents=50.0),
        SimpleNamespace(report_period="2024-12-31", operating_income=100.0, total_debt=250.0, cash_and_equivalents=50.0),
        SimpleNamespace(report_period="2023-12-31", operating_income=90.0, total_debt=200.0, cash_and_equivalents=50.0),
    ]
    prices = [
        SimpleNamespace(time="2023-12-31T00:00:00", close=75.0),
        SimpleNamespace(time="2024-12-31T00:00:00", close=100.0),
        SimpleNamespace(time="2025-12-31T00:00:00", close=100.0),
    ]

    result = calculate_ev_ebit_breakdown(
        metrics,
        line_items=line_items,
        prices=prices,
        shares_outstanding=10.0,
    )

    assert result is not None
    # Price-backed EV/EBIT: 1200/150=8, 1200/100=12, 900/90=10 -> median 10.
    assert result["median_multiple"] == pytest.approx(10.0)
    assert result["multiple_basis"] == "price_backed_line_items_median"
    assert result["equity_value"] == pytest.approx(1_300.0)


def test_ev_ebit_breakdown_constant_denominator_drops_without_fallback():
    # Same tautological setup, but no price-backed data available → drop the card so
    # it cannot mirror the EV/EBITDA card.
    metrics = _metrics([
        (1_200.0, 150.0, 1_000.0),
        (1_600.0, 150.0, 1_000.0),
        (2_000.0, 150.0, 1_000.0),
    ])
    assert calculate_ev_ebit_breakdown(metrics) is None


def test_ev_ebit_breakdown_uses_p75_for_capex_heavy():
    # Multiples 8,8,10,12,100 → clip extremes → [8,10,12]... p75.
    metrics = _metrics([
        (1_200.0, 150.0, 1_000.0),  # 8
        (1_600.0, 200.0, 0.0),      # 8
        (2_000.0, 200.0, 0.0),      # 10
        (2_400.0, 200.0, 0.0),      # 12
        (20_000.0, 200.0, 0.0),     # 100
    ])
    result = calculate_ev_ebit_breakdown(metrics, capex_heavy=True)
    assert result is not None
    assert result["multiple_basis"] == "capex_heavy_p75_clipped"


def test_ev_ebit_breakdown_prefers_direct_ratio():
    metrics = [
        SimpleNamespace(
            enterprise_value=1_200.0,
            enterprise_value_to_ebit_ratio=10.0,
            operating_income=150.0,
            market_cap=1_000.0,
        ),
        SimpleNamespace(
            enterprise_value=1_600.0,
            enterprise_value_to_ebit_ratio=12.0,
            operating_income=200.0,
            market_cap=1_200.0,
        ),
    ]
    result = calculate_ev_ebit_breakdown(metrics)
    assert result is not None
    # Direct ratio 10 takes precedence over ev/oi (=8).
    assert result["current_multiple"] == pytest.approx(10.0)


def test_ev_ebit_breakdown_none_without_enterprise_value():
    metrics = _metrics([(0.0, 150.0, 1_000.0)])
    assert calculate_ev_ebit_breakdown(metrics) is None


def test_weight_buckets_include_ev_ebit_and_sum_to_one():
    import inspect

    from src.agents import valuation

    source = inspect.getsource(valuation.valuation_analyst_agent)
    assert '"ev_ebit":' in source
    # Sanity-check both regime weight dicts total 1.0.
    import ast

    tree = ast.parse(inspect.getsource(valuation.valuation_analyst_agent))
    dict_sums = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        has_ev_ebit = any(isinstance(k, ast.Constant) and k.value == "ev_ebit" for k in node.keys)
        all_numeric = node.values and all(
            isinstance(v, ast.Constant) and isinstance(v.value, (int, float)) for v in node.values
        )
        if has_ev_ebit and all_numeric:
            dict_sums.append(round(sum(v.value for v in node.values), 6))
    assert dict_sums, "no base_weights dict with ev_ebit found"
    assert all(s == 1.0 for s in dict_sums), dict_sums
