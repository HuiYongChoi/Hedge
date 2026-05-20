from pathlib import Path
from types import SimpleNamespace

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
V5_DIR = REPO_ROOT / "app/frontend/src/components/reports/analyst-report-v5"
LANG_PREFS = REPO_ROOT / "app/frontend/src/lib/language-preferences.ts"
VALUATION = REPO_ROOT / "src/agents/valuation.py"


def _metric(
    *,
    bvps: float | None = 100.0,
    book_growth: float | None = 0.03,
    roe: float | None = None,
    beta: float | None = None,
):
    return SimpleNamespace(
        book_value_per_share=bvps,
        book_value_growth=book_growth,
        return_on_equity=roe,
        beta=beta,
    )


def _forward(fy0: float | None = None, fy1: float | None = None):
    return SimpleNamespace(forward_eps_fy0=fy0, forward_eps_fy1=fy1)


def test_justified_pbr_matches_skhynix_forward_roe_regression():
    from src.agents.valuation import calculate_justified_pbr_breakdown

    result = calculate_justified_pbr_breakdown(
        financial_metrics=[_metric(bvps=600_000.0, book_growth=0.03)],
        forward_metrics=_forward(fy0=360_000.0, fy1=360_000.0),
        cost_of_equity=0.12,
    )

    assert result is not None
    assert result["roe_used"] == pytest.approx(0.60)
    assert result["justified_pbr"] == pytest.approx((0.60 - 0.03) / (0.12 - 0.03))
    assert result["bvps_forward"] == pytest.approx(618_000.0)
    assert result["target_price"] == pytest.approx(3_914_000.0)


def test_justified_pbr_uses_forward_eps_fy0_fy1_when_available():
    from src.agents.valuation import calculate_justified_pbr_breakdown

    result = calculate_justified_pbr_breakdown(
        financial_metrics=[_metric(bvps=4.0, book_growth=0.02)],
        forward_metrics=_forward(fy0=8.0, fy1=9.0),
        cost_of_equity=0.105,
    )

    assert result is not None
    assert result["roe_source"] == "forward_eps_implied"
    assert result["roe_window"] == "FY0-FY1"
    assert result["roe_used"] == pytest.approx(((8.0 + 9.0) / 2.0) / 4.0)


def test_justified_pbr_falls_back_to_trailing_roe_average_without_forward_eps():
    from src.agents.valuation import calculate_justified_pbr_breakdown

    result = calculate_justified_pbr_breakdown(
        financial_metrics=[
            _metric(roe=0.20),
            _metric(roe=0.30),
            _metric(roe=0.40),
            _metric(roe=None),
            _metric(roe=0.50),
        ],
        forward_metrics=None,
        cost_of_equity=0.12,
    )

    assert result is not None
    assert result["roe_source"] == "trailing_avg"
    assert result["roe_window"] == "trailing 4y"
    assert result["roe_used"] == pytest.approx(0.35)


def test_justified_pbr_returns_none_without_positive_bvps():
    from src.agents.valuation import calculate_justified_pbr_breakdown

    assert calculate_justified_pbr_breakdown(
        financial_metrics=[_metric(bvps=0.0)],
        forward_metrics=_forward(fy0=10.0, fy1=12.0),
        cost_of_equity=0.12,
    ) is None


def test_justified_pbr_clamps_growth_below_cost_of_equity():
    from src.agents.valuation import calculate_justified_pbr_breakdown

    result = calculate_justified_pbr_breakdown(
        financial_metrics=[_metric(bvps=100.0, book_growth=0.06)],
        forward_metrics=_forward(fy0=10.0, fy1=10.0),
        cost_of_equity=0.05,
    )

    assert result is not None
    assert result["growth_g"] == pytest.approx(0.045)
    assert result["cost_of_equity"] - result["growth_g"] > 0


def test_justified_pbr_reports_one_year_eps_growth_only():
    from src.agents.valuation import calculate_justified_pbr_breakdown

    result = calculate_justified_pbr_breakdown(
        financial_metrics=[_metric()],
        forward_metrics=_forward(fy0=100.0, fy1=120.0),
        cost_of_equity=0.12,
    )
    fy1_only = calculate_justified_pbr_breakdown(
        financial_metrics=[_metric()],
        forward_metrics=_forward(fy0=None, fy1=120.0),
        cost_of_equity=0.12,
    )

    assert result is not None
    assert result["eps_growth_1y"] == pytest.approx(0.20)
    assert fy1_only is not None
    assert fy1_only["eps_growth_1y"] is None


def test_compute_cost_of_equity_matches_wacc_existing_capm_path():
    from src.agents.valuation import calculate_wacc, compute_cost_of_equity

    assert compute_cost_of_equity(beta_proxy=1.0) == pytest.approx(0.105)
    assert compute_cost_of_equity(beta_proxy=-1.0) == pytest.approx(0.065)
    assert calculate_wacc(
        market_cap=1_000.0,
        total_debt=0.0,
        cash=0.0,
        interest_coverage=None,
        debt_to_equity=None,
        beta_proxy=1.0,
    ) == pytest.approx(0.105)


def test_frontend_wires_justified_pbr_without_touching_primary_tiles():
    valuation = VALUATION.read_text(encoding="utf-8")
    types = (V5_DIR / "types.ts").read_text(encoding="utf-8")
    helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
    sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")
    i18n = LANG_PREFS.read_text(encoding="utf-8")

    assert "forward_eps_fy2" not in valuation
    assert "forward_eps_fy3" not in valuation
    assert "eps_cagr_3y" not in valuation
    assert "eps_cagr_4y" not in valuation

    assert "export interface JustifiedPbrBreakdown" in types
    assert "justifiedPbr: JustifiedPbrBreakdown | null" in types

    assert "function parseJustifiedPbrBreakdown" in helpers
    assert "justified_pbr_analysis" in helpers
    assert "eps_growth_1y" in helpers

    assert "function JustifiedPbrCard" in sidebar
    assert "const justifiedCard = dive.justifiedPbr &&" in sidebar
    assert "{pbrCard}" in sidebar and "{justifiedCard}" in sidebar and "{rimCard}" in sidebar
    assert sidebar.index("ORDERED_PRIMARY_TILE_KEYS = ['targetIntrinsicLabel', 'targetMarginLabel']") > 0
    assert sidebar.index("{topTiles.map") < sidebar.index("{valuationDeepDive &&")

    for key in [
        "justifiedPbrLabel",
        "justifiedPbrTitleTip",
        "justifiedPbrInputsTip",
        "justifiedPbrRoeTip",
        "justifiedPbrKeGTip",
        "justifiedPbrGrowthTip",
    ]:
        assert f"{key}:" in i18n
