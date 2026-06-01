from pathlib import Path
from types import SimpleNamespace

import pytest

from src.data.models import FinancialMetrics, LineItem


REPO_ROOT = Path(__file__).resolve().parents[1]
V5_DIR = REPO_ROOT / "app/frontend/src/components/reports/analyst-report-v5"
LANG_PREFS = REPO_ROOT / "app/frontend/src/lib/language-preferences.ts"


def test_ev_ebitda_breakdown_uses_median_multiple_and_net_debt():
    from src.agents.valuation import calculate_ev_ebitda_breakdown

    metrics = [
        SimpleNamespace(
            enterprise_value=1_200.0,
            enterprise_value_to_ebitda_ratio=6.0,
            market_cap=1_000.0,
        ),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=8.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=10.0),
    ]

    result = calculate_ev_ebitda_breakdown(metrics)

    assert result is not None
    assert result["current_multiple"] == pytest.approx(6.0)
    assert result["median_multiple"] == pytest.approx(8.0)
    assert result["ebitda_now"] == pytest.approx(200.0)
    assert result["net_debt"] == pytest.approx(200.0)
    assert result["equity_value"] == pytest.approx(1_400.0)
    assert result["sample_size"] == 3


def test_ev_ebitda_breakdown_returns_none_without_enterprise_value():
    from src.agents.valuation import calculate_ev_ebitda_breakdown

    result = calculate_ev_ebitda_breakdown([
        SimpleNamespace(
            enterprise_value=0.0,
            enterprise_value_to_ebitda_ratio=6.0,
            market_cap=1_000.0,
        )
    ])

    assert result is None


def test_ev_ebitda_breakdown_accepts_single_snapshot_fallback():
    from src.agents.valuation import calculate_ev_ebitda_breakdown

    result = calculate_ev_ebitda_breakdown([
        SimpleNamespace(
            enterprise_value=1_200.0,
            enterprise_value_to_ebitda_ratio=6.0,
            market_cap=1_000.0,
        )
    ])

    assert result is not None
    assert result["median_multiple"] == pytest.approx(result["current_multiple"])
    assert result["equity_value"] == pytest.approx(1_000.0)
    assert result["sample_size"] == 1


def test_ev_ebitda_breakdown_clips_extreme_multiples_before_median():
    from src.agents.valuation import calculate_ev_ebitda_breakdown

    metrics = [
        SimpleNamespace(
            enterprise_value=1_200.0,
            enterprise_value_to_ebitda_ratio=6.0,
            market_cap=1_000.0,
        ),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=8.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=10.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=12.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=100.0),
    ]

    result = calculate_ev_ebitda_breakdown(metrics)

    assert result is not None
    assert result["median_multiple"] == pytest.approx(10.0)
    assert result["multiple_basis"] == "median_clipped"
    assert result["clipped_sample_size"] == 3


def test_ev_ebitda_breakdown_uses_p75_for_capex_heavy_regime():
    from src.agents.valuation import calculate_ev_ebitda_breakdown

    metrics = [
        SimpleNamespace(
            enterprise_value=1_200.0,
            enterprise_value_to_ebitda_ratio=6.0,
            market_cap=1_000.0,
        ),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=8.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=10.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=12.0),
        SimpleNamespace(enterprise_value_to_ebitda_ratio=100.0),
    ]

    result = calculate_ev_ebitda_breakdown(metrics, capex_heavy=True)

    assert result is not None
    assert result["median_multiple"] == pytest.approx(11.0)
    assert result["multiple_basis"] == "capex_heavy_p75_clipped"
    assert result["clipped_sample_size"] == 3


def test_valuation_agent_emits_ev_ebitda_breakdown(monkeypatch):
    import src.agents.valuation as valuation

    metrics = [
        FinancialMetrics(
            ticker="MU",
            report_period=f"2026-0{idx + 1}-28",
            period="ttm",
            currency="USD",
            market_cap=1_000_000.0,
            enterprise_value=1_200_000.0,
            enterprise_value_to_ebitda_ratio=multiple,
            price_to_book_ratio=2.0,
            book_value_per_share=100.0,
            revenue_growth=0.25,
            earnings_growth=0.12,
            book_value_growth=0.04,
            free_cash_flow_growth=0.10,
            interest_coverage=10.0,
            debt_to_equity=0.4,
            outstanding_shares=10_000.0,
        )
        for idx, multiple in enumerate([6.0, 8.0, 10.0, 12.0])
    ]
    line_item = LineItem(
        ticker="MU",
        report_period="2026-03-31",
        period="ttm",
        currency="USD",
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
        outstanding_shares=10_000.0,
    )

    monkeypatch.setattr(valuation, "get_financial_metrics", lambda **_: metrics)
    monkeypatch.setattr(valuation, "get_pbr_history", lambda **_: [])
    monkeypatch.setattr(valuation, "search_line_items", lambda **_: [line_item])
    monkeypatch.setattr(valuation, "get_market_cap", lambda *_args, **_kwargs: 1_000_000.0)
    monkeypatch.setattr(valuation, "get_cached_forward_metrics", lambda *_args, **_kwargs: None)

    state = {
        "messages": [],
        "data": {
            "tickers": ["MU"],
            "end_date": "2026-05-10",
            "analyst_signals": {},
        },
        "metadata": {"show_reasoning": False},
    }

    result = valuation.valuation_analyst_agent(state, agent_id="valuation_analyst_evtest")
    reasoning = result["data"]["analyst_signals"]["valuation_analyst_evtest"]["MU"]["reasoning"]
    ev = reasoning["ev_ebitda_analysis"]

    assert ev["median_multiple"] == pytest.approx(10.5)
    assert ev["current_multiple"] == pytest.approx(6.0)
    assert ev["ebitda_now"] == pytest.approx(200_000.0)
    assert ev["net_debt"] == pytest.approx(200_000.0)
    assert ev["sample_size"] == 4
    assert ev["multiple_basis"] == "capex_heavy_p75"


def test_valuation_agent_emits_ebitda_and_roic_wacc_blocks(monkeypatch):
    import src.agents.valuation as valuation

    metrics = [
        FinancialMetrics(
            ticker="MU",
            report_period=f"2026-0{idx + 1}-28",
            period="ttm",
            currency="USD",
            market_cap=1_000_000.0,
            enterprise_value=1_200_000.0,
            enterprise_value_to_ebitda_ratio=multiple,
            operating_income=150_000.0,
            price_to_book_ratio=2.0,
            book_value_per_share=100.0,
            return_on_invested_capital=0.18,
            operating_income_growth=0.08,
            ebitda_growth=0.10,
            revenue_growth=0.25,
            earnings_growth=0.12,
            book_value_growth=0.04,
            free_cash_flow_growth=0.10,
            interest_coverage=10.0,
            debt_to_equity=0.4,
            outstanding_shares=10_000.0,
        )
        for idx, multiple in enumerate([6.0, 8.0, 10.0, 12.0])
    ]
    line_item = LineItem(
        ticker="MU",
        report_period="2026-03-31",
        period="ttm",
        currency="USD",
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
        outstanding_shares=10_000.0,
    )

    monkeypatch.setattr(valuation, "get_financial_metrics", lambda **_: metrics)
    monkeypatch.setattr(valuation, "get_pbr_history", lambda **_: [])
    monkeypatch.setattr(valuation, "search_line_items", lambda **_: [line_item])
    monkeypatch.setattr(valuation, "get_market_cap", lambda *_args, **_kwargs: 1_000_000.0)
    monkeypatch.setattr(valuation, "get_cached_forward_metrics", lambda *_args, **_kwargs: None)

    state = {
        "messages": [],
        "data": {
            "tickers": ["MU"],
            "end_date": "2026-05-10",
            "analyst_signals": {},
        },
        "metadata": {"show_reasoning": False},
    }

    result = valuation.valuation_analyst_agent(state, agent_id="valuation_dual_test")
    reasoning = result["data"]["analyst_signals"]["valuation_dual_test"]["MU"]["reasoning"]

    # The two new items are emitted as distinct, separate reasoning blocks.
    ebitda = reasoning["ebitda_valuation_analysis"]
    assert ebitda["intrinsic_total"] > 0
    assert ebitda["normalized_ebitda"] > 0
    assert "target_multiple" in ebitda
    assert ebitda["ebitda_growth_applied"] == pytest.approx(0.10)

    roic_wacc = reasoning["roic_wacc_valuation_analysis"]
    assert roic_wacc["intrinsic_total"] > 0
    assert roic_wacc["roic"] == pytest.approx(0.18)
    assert roic_wacc["spread"] == roic_wacc["roic"] - roic_wacc["wacc"]
    assert roic_wacc["ic_basis"] in {"book", "market_proxy"}

    # The legacy EV/EBITDA block still coexists unchanged.
    assert reasoning["ev_ebitda_analysis"]["ebitda_now"] == pytest.approx(200_000.0)

    # EV/EBIT is emitted as its own independent model block.
    ev_ebit = reasoning["ev_ebit_analysis"]
    assert ev_ebit["intrinsic_total"] > 0
    assert ev_ebit["current_multiple"] > 0
    assert "ebit_now" in ev_ebit


def test_sidebar_renders_ev_ebitda_without_changing_pbr_rim_cards():
    sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")
    types = (V5_DIR / "types.ts").read_text(encoding="utf-8")
    helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
    i18n = LANG_PREFS.read_text(encoding="utf-8")

    assert "const evModel = dive.models.find(model => model.key === 'ev_ebitda');" in sidebar
    assert "const evCard = hasEv &&" in sidebar
    assert "const pbrCard = hasPbr &&" in sidebar
    assert "const rimCard = hasRim &&" in sidebar
    assert "dive.regime === 'capex_heavy' ? (" in sidebar
    assert sidebar.index("{evCard}") < sidebar.index("{pbrCard}") < sidebar.index("{rimCard}")
    assert "evEbitdaLabel" in sidebar
    assert "evEbitdaSubtitleMedian" in sidebar
    assert "evEbitdaSubtitleFallback" in sidebar

    assert "medianMultiple?: number | null" in types
    assert "currentMultiple?: number | null" in types
    assert "ebitdaNow?: number | null" in types
    assert "netDebt?: number | null" in types

    assert "median_multiple" in helpers
    assert "current_multiple" in helpers
    assert "ebitda_now" in helpers
    assert "net_debt" in helpers

    for needle in [
        "evEbitdaLabel: 'EV/EBITDA 평가'",
        "evEbitdaSubtitleMedian: '중앙값 EV/EBITDA {median}x · 현재 {current}x'",
        "evEbitdaSubtitleFallback: 'EV ÷ EBITDA 중앙값 기준'",
        "evEbitdaLabel: 'EV/EBITDA'",
        "evEbitdaSubtitleMedian: 'Median EV/EBITDA {median}x · current {current}x'",
        "evEbitdaSubtitleFallback: 'Median EV/EBITDA multiple'",
    ]:
        assert needle in i18n

    assert "PBR · RIM 카드 본문 수정 금지" not in sidebar
