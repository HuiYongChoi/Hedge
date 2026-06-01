from types import SimpleNamespace

import pytest

from src.agents.valuation import calculate_cash_flow_profile


def _items(fcf0=120.0, fcf1=100.0):
    li0 = SimpleNamespace(
        ebit=200.0,
        operating_income=200.0,
        depreciation_and_amortization=50.0,
        capital_expenditure=-30.0,
        net_income=140.0,
        interest_expense=10.0,
        working_capital=100.0,
        total_debt=300.0,
        free_cash_flow=fcf0,
    )
    li1 = SimpleNamespace(
        working_capital=80.0,
        total_debt=250.0,
        free_cash_flow=fcf1,
    )
    return [li0, li1]


def test_fcff_fcfe_levels_and_yields():
    result = calculate_cash_flow_profile(
        _items(),
        market_cap=1_000.0,
        enterprise_value=1_200.0,
        ev_ebitda_multiple=6.0,
        cost_of_equity=0.10,
        shares_outstanding=100.0,
    )
    assert result is not None
    # FCFF = 200*0.75 + 50 - 30 - (100-80) = 150.
    assert result["fcff"] == pytest.approx(150.0)
    # FCFE = 140 + 50 - 30 - 20 + (300-250) = 190.
    assert result["fcfe"] == pytest.approx(190.0)
    assert result["fcff_yield"] == pytest.approx(0.125)
    assert result["fcfe_yield"] == pytest.approx(0.19)
    # FCFE fair value uses a conservative 5% growth cap even if reported FCF grew faster.
    assert result["fcfe_intrinsic_per_share"] == pytest.approx(190 * 1.05 / 0.05 / 100)


def test_value_trap_flags():
    genuine = calculate_cash_flow_profile(
        _items(fcf0=120.0, fcf1=100.0),  # +growth
        market_cap=1_000.0, enterprise_value=1_200.0, ev_ebitda_multiple=6.0,
    )
    assert genuine["value_trap_flag"] == "genuine_value"

    trap = calculate_cash_flow_profile(
        _items(fcf0=80.0, fcf1=100.0),  # -growth, still cheap
        market_cap=1_000.0, enterprise_value=1_200.0, ev_ebitda_multiple=6.0,
    )
    assert trap["value_trap_flag"] == "trap_risk"

    rich = calculate_cash_flow_profile(
        _items(),
        market_cap=1_000.0, enterprise_value=1_200.0, ev_ebitda_multiple=20.0,
    )
    assert rich["value_trap_flag"] == "neutral"


def test_fcf_growth_uses_recent_positive_history_when_cycle_has_losses():
    li0, li1 = _items(fcf0=120.0, fcf1=100.0)
    history = [
        SimpleNamespace(free_cash_flow=258.0),
        SimpleNamespace(free_cash_flow=138.0),
        SimpleNamespace(free_cash_flow=-40.0),
        SimpleNamespace(free_cash_flow=-42.0),
        SimpleNamespace(free_cash_flow=73.0),
    ]

    result = calculate_cash_flow_profile(
        [li0, li1],
        market_cap=1_000.0,
        enterprise_value=1_200.0,
        ev_ebitda_multiple=6.0,
        fcf_growth_line_items=history,
    )

    assert result is not None
    assert result["fcf_growth"] == pytest.approx((258.0 / 138.0) - 1)
    assert result["fcfe_growth_used"] == pytest.approx(0.05)
    assert result["value_trap_flag"] == "genuine_value"


def test_shareholder_capacity_buckets():
    strong = calculate_cash_flow_profile(_items(), market_cap=1_000.0, enterprise_value=1_200.0)
    assert strong["shareholder_capacity"] == "strong"  # 0.19 yield

    # Tiny FCFE → limited/negative bucket.
    li0 = SimpleNamespace(
        ebit=10.0, operating_income=10.0, depreciation_and_amortization=0.0,
        capital_expenditure=-200.0, net_income=5.0, interest_expense=0.0,
        working_capital=100.0, total_debt=100.0, free_cash_flow=5.0,
    )
    li1 = SimpleNamespace(working_capital=80.0, total_debt=100.0, free_cash_flow=5.0)
    neg = calculate_cash_flow_profile([li0, li1], market_cap=1_000.0, enterprise_value=1_200.0)
    assert neg["shareholder_capacity"] == "negative"  # FCFE < 0


def test_returns_none_without_inputs():
    assert calculate_cash_flow_profile([], market_cap=1_000.0, enterprise_value=1_200.0) is None
    blank = [SimpleNamespace(working_capital=10.0, total_debt=10.0)]
    assert calculate_cash_flow_profile(blank, market_cap=1_000.0, enterprise_value=1_200.0) is None


def test_agent_emits_cash_flow_insight(monkeypatch):
    import src.agents.valuation as valuation
    from src.data.models import FinancialMetrics, LineItem

    metrics = [
        FinancialMetrics(
            ticker="MU", report_period="2026-03-31", period="ttm", currency="USD",
            market_cap=1_000_000.0, enterprise_value=1_200_000.0,
            enterprise_value_to_ebitda_ratio=6.0, operating_income=200_000.0,
            price_to_book_ratio=2.0, book_value_per_share=100.0,
            return_on_invested_capital=0.18, revenue_growth=0.2, earnings_growth=0.1,
            book_value_growth=0.04, free_cash_flow_growth=0.1, interest_coverage=10.0,
            debt_to_equity=0.4, outstanding_shares=10_000.0, beta=1.1,
        )
    ]
    line_item = LineItem(
        ticker="MU", report_period="2026-03-31", period="ttm", currency="USD",
        free_cash_flow=80_000.0, net_income=140_000.0,
        depreciation_and_amortization=20_000.0, capital_expenditure=-30_000.0,
        working_capital=15_000.0, total_debt=200_000.0, cash_and_equivalents=50_000.0,
        interest_expense=5_000.0, revenue=500_000.0, operating_income=180_000.0,
        ebit=180_000.0, ebitda=200_000.0, outstanding_shares=10_000.0,
    )

    monkeypatch.setattr(valuation, "get_financial_metrics", lambda **_: metrics)
    monkeypatch.setattr(valuation, "get_pbr_history", lambda **_: [])
    monkeypatch.setattr(valuation, "search_line_items", lambda **_: [line_item])
    monkeypatch.setattr(valuation, "get_market_cap", lambda *_a, **_k: 1_000_000.0)
    monkeypatch.setattr(valuation, "get_cached_forward_metrics", lambda *_a, **_k: None)

    state = {
        "messages": [],
        "data": {"tickers": ["MU"], "end_date": "2026-05-10", "analyst_signals": {}},
        "metadata": {"show_reasoning": False},
    }
    result = valuation.valuation_analyst_agent(state, agent_id="valuation_cf_test")
    reasoning = result["data"]["analyst_signals"]["valuation_cf_test"]["MU"]["reasoning"]
    cf = reasoning["cash_flow_insight"]
    assert cf["fcff"] is not None
    assert cf["fcfe"] is not None
    assert "fcff_yield" in cf and "fcfe_yield" in cf
