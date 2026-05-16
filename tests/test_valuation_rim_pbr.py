from src.data.models import FinancialMetrics, LineItem


def test_residual_income_breakdown_exposes_per_share_fields():
    from src.agents.valuation import calculate_residual_income_breakdown

    result = calculate_residual_income_breakdown(
        market_cap=1000.0,
        net_income=180.0,
        price_to_book_ratio=2.0,
        shares_outstanding=10.0,
        book_value_growth=0.04,
    )

    assert result is not None
    assert result["book_value"] == 500.0
    assert result["book_value_per_share"] == 50.0
    assert result["intrinsic_per_share"] is not None
    assert result["intrinsic_with_mos"] < result["intrinsic_total"]


def test_pbr_band_uses_historical_percentiles_and_implied_prices():
    from src.agents.valuation import calculate_pbr_band

    metrics = [
        FinancialMetrics(ticker="000660.KS", report_period="2026-03-31", period="ttm", currency="KRW", price_to_book_ratio=2.0, book_value_per_share=100_000.0),
        FinancialMetrics(ticker="000660.KS", report_period="2025-12-31", period="ttm", currency="KRW", price_to_book_ratio=1.2, book_value_per_share=98_000.0),
        FinancialMetrics(ticker="000660.KS", report_period="2025-09-30", period="ttm", currency="KRW", price_to_book_ratio=1.6, book_value_per_share=96_000.0),
        FinancialMetrics(ticker="000660.KS", report_period="2025-06-30", period="ttm", currency="KRW", price_to_book_ratio=2.4, book_value_per_share=94_000.0),
        FinancialMetrics(ticker="000660.KS", report_period="2025-03-31", period="ttm", currency="KRW", price_to_book_ratio=2.8, book_value_per_share=92_000.0),
    ]

    result = calculate_pbr_band(
        financial_metrics=metrics,
        current_price=200_000.0,
        shares_outstanding=1_000.0,
        revenue_growth=0.25,
    )

    assert result is not None
    assert result["current_pbr"] == 2.0
    assert result["percentiles"]["p50"] == 2.0
    assert result["fair_price_p50"] == 200_000.0
    assert result["rerating_note"]


def test_pbr_band_falls_back_to_current_snapshot_when_history_is_sparse():
    from src.agents.valuation import calculate_pbr_band

    result = calculate_pbr_band(
        financial_metrics=[
            FinancialMetrics(
                ticker="000660.KS",
                report_period="2026-12-31",
                period="ttm",
                currency="KRW",
                price_to_book_ratio=10.7,
                book_value_per_share=174_319.29,
            )
        ],
        current_price=1_865_216.4,
        shares_outstanding=692_216_846.0,
        revenue_growth=0.46,
    )

    assert result is not None
    assert result["position_label"] == "single_snapshot"
    assert result["fair_price_p50"] == result["current_price"]
    assert "히스토리 부족" in result["details"]


def test_valuation_agent_emits_rim_pbr_when_only_current_line_item(monkeypatch):
    """Korean/Japan providers can return only one rich TTM line-item snapshot."""
    import src.agents.valuation as valuation

    metrics = [
        FinancialMetrics(
            ticker="000660.KS",
            report_period=f"2026-0{idx + 1}-31",
            period="ttm",
            currency="KRW",
            market_cap=1_000_000.0,
            enterprise_value=1_200_000.0,
            enterprise_value_to_ebitda_ratio=6.0 + idx,
            price_to_earnings_ratio=30.9,
            price_to_book_ratio=pbr,
            book_value_per_share=100_000.0 - idx * 1_000.0,
            revenue_growth=0.25,
            earnings_growth=0.12,
            book_value_growth=0.04,
            free_cash_flow_growth=0.10,
            interest_coverage=10.0,
            debt_to_equity=0.4,
            outstanding_shares=10.0,
        )
        for idx, pbr in enumerate([2.0, 1.5, 2.4, 1.2])
    ]
    line_item = LineItem(
        ticker="000660.KS",
        report_period="2026-03-31",
        period="ttm",
        currency="KRW",
        free_cash_flow=80_000.0,
        net_income=140_000.0,
        depreciation_and_amortization=20_000.0,
        capital_expenditure=-30_000.0,
        working_capital=15_000.0,
        total_debt=200_000.0,
        cash_and_equivalents=50_000.0,
        interest_expense=5_000.0,
        revenue=500_000.0,
        ebitda=200_000.0,
        outstanding_shares=10.0,
    )

    monkeypatch.setattr(valuation, "get_financial_metrics", lambda **_: metrics)
    monkeypatch.setattr(valuation, "search_line_items", lambda **_: [line_item])
    monkeypatch.setattr(valuation, "get_market_cap", lambda *_args, **_kwargs: 1_000_000.0)
    monkeypatch.setattr(valuation, "get_cached_forward_metrics", lambda *_args, **_kwargs: None)

    state = {
        "messages": [],
        "data": {
            "tickers": ["000660.KS"],
            "end_date": "2026-05-10",
            "analyst_signals": {},
        },
        "metadata": {"show_reasoning": False},
    }

    result = valuation.valuation_analyst_agent(state, agent_id="valuation_analyst_test")
    signal = result["data"]["analyst_signals"]["valuation_analyst_test"]["000660.KS"]
    reasoning = signal["reasoning"]

    assert reasoning["rim_analysis"]["intrinsic_per_share"] is not None
    assert reasoning["pbr_band_analysis"]["fair_price_p50"] is not None
    assert reasoning["dcf_scenario_analysis"]["fcf_periods_analyzed"] == 1
