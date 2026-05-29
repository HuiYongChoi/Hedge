import pytest

from src.agents.valuation import calculate_roic_wacc_breakdown


def _base_kwargs(**overrides):
    kwargs = dict(
        roic=0.18,
        wacc=0.10,
        book_value_per_share=100.0,
        shares_outstanding=1_000.0,
        total_debt=20_000.0,
        cash=0.0,
        market_cap=200_000.0,
        eva_growth=0.05,
    )
    kwargs.update(overrides)
    return kwargs


def test_positive_spread_creates_value_above_invested_capital():
    result = calculate_roic_wacc_breakdown(**_base_kwargs())

    assert result is not None
    # book_equity 100 * 1000 = 100,000 + net_debt 20,000 = 120,000 invested capital.
    assert result["invested_capital"] == pytest.approx(120_000.0)
    assert result["ic_basis"] == "book"
    assert result["spread"] == pytest.approx(0.08)
    assert result["mva"] > 0
    # Value creator: enterprise value exceeds invested capital (pre margin-of-safety).
    assert result["enterprise_value"] > result["invested_capital"]
    assert result["equity_value"] > 0


def test_negative_spread_destroys_value():
    result = calculate_roic_wacc_breakdown(**_base_kwargs(roic=0.06, wacc=0.12))

    assert result is not None
    assert result["spread"] == pytest.approx(-0.06)
    assert result["mva"] < 0
    # Value destroyer: enterprise value falls below invested capital.
    assert result["enterprise_value"] < result["invested_capital"]


def test_none_roic_returns_none():
    assert calculate_roic_wacc_breakdown(**_base_kwargs(roic=None)) is None


def test_missing_invested_capital_basis_returns_none():
    result = calculate_roic_wacc_breakdown(
        **_base_kwargs(book_value_per_share=None, market_cap=None)
    )
    assert result is None


def test_market_proxy_when_book_equity_unavailable():
    result = calculate_roic_wacc_breakdown(
        **_base_kwargs(book_value_per_share=None, market_cap=500_000.0)
    )

    assert result is not None
    assert result["ic_basis"] == "market_proxy"
    # market_cap 500,000 + net_debt 20,000.
    assert result["invested_capital"] == pytest.approx(520_000.0)


def test_weight_buckets_sum_to_one():
    import inspect

    from src.agents import valuation

    source = inspect.getsource(valuation.valuation_analyst_agent)
    # Both regimes' base_weights dicts must each total 1.0 including the two new items.
    assert '"ebitda_valuation": 0.10' in source
    assert '"roic_wacc_valuation": 0.10' in source
