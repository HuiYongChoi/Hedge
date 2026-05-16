from src.data.models import FinancialMetrics


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
