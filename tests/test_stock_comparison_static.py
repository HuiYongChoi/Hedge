from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = REPO_ROOT / "app/frontend/src"


def _read(rel: str) -> str:
    return (FRONTEND / rel).read_text(encoding="utf-8")


def test_stock_compare_tab_component_exists():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "export function StockCompareTab" in src
    # Reuses the existing valuation parsing rather than re-implementing it.
    assert "buildValuationDeepDive" in src


def test_tab_service_wires_stock_compare():
    src = _read("services/tab-service.ts")
    assert "createStockCompareTab" in src
    assert "'stock-compare'" in src
    assert "StockCompareTab" in src


def test_tabs_context_registers_stock_compare():
    src = _read("contexts/tabs-context.tsx")
    assert "'stock-compare'" in src


def test_tab_bar_renders_stock_compare():
    src = _read("components/tabs/tab-bar.tsx")
    assert "stock-compare" in src
    assert "stockCompare" in src


def test_top_bar_has_connection_icon_entry():
    src = _read("components/layout/top-bar.tsx")
    assert "onStockCompareClick" in src
    # Connection (network) icon next to the existing menu.
    assert "Network" in src
    assert "stockCompare" in src


def test_layout_opens_stock_compare_tab():
    src = _read("components/Layout.tsx")
    assert "handleStockCompareClick" in src
    assert "createStockCompareTab" in src


def test_i18n_has_stock_compare_in_both_languages():
    src = _read("lib/language-preferences.ts")
    assert src.count("stockCompare:") >= 2


def test_valuation_matrix_does_not_hardcode_exclude_new_models():
    # The matrix must render the union of model keys (dynamic), so the new
    # EBITDA-normalized and ROIC-WACC models appear automatically.
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "ebitda_valuation" in src
    assert "roic_wacc_valuation" in src
    assert "PREFERRED_MODEL_ORDER" in src


def test_comparison_runs_valuation_per_ticker_with_progress_rows():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "runValuationForTicker" in src
    assert "progressMessage" in src
    assert "compareStatus" in src
    assert "Promise.allSettled" in src


def test_comparison_failure_isolated_per_slot():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "valuation failed" in src
    assert "status: 'error'" in src
    assert "metrics loaded" in src


def test_comparison_resolves_korean_names_before_backend_calls():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "resolveTickerValue" in src
    assert "resolveCompareTicker" in src
    assert "resolvedTicker" in src
    assert "fetchMetricsFor(resolvedTicker" in src
    assert "runValuationForTicker(resolvedTicker" in src


def test_comparison_defaults_to_requested_three_companies_and_allows_add():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "DEFAULT_COMPARE_TICKERS" in src
    assert "'MU'" in src
    assert "'SK하이닉스'" in src
    assert "'삼성전자'" in src
    assert "MAX_SLOTS = 6" in src
    assert "addSlot" in src


def test_comparison_can_save_results_to_archive():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "savedAnalysisService" in src
    assert "handleSaveComparison" in src
    assert "'stock_compare'" in src
    assert "Archive" in src
    assert "isSavingComparison" in src


def test_comparison_surfaces_current_price():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "compareCurrentPrice" in src
    assert "currentPrice" in src
    assert "CurrentPriceSummary" in src


def test_comparison_has_relative_chart_controls_and_metrics():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "COMPARISON_CHART_METRICS" in src
    assert "relative_price" in src
    assert "eps" in src
    assert "free_cash_flow" in src
    assert "earnings_growth" in src
    assert "liabilities_to_equity" in src
    assert "chartWindow" in src
    assert "chartAxisMode" in src
    assert "RelativeComparisonChart" in src
    assert "annual_line_items" in src
    assert "period: 'annual'" in src
