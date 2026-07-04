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


def test_comparison_shows_metrics_before_slow_valuation_finishes():
    src = _read("components/tabs/stock-compare-tab.tsx")
    run_block = src[src.index("const runSlot = async"):src.index("await Promise.allSettled")]

    assert "재무 데이터 완료 · 가치평가 중" in run_block
    assert "status: 'ready'" in run_block
    assert "void runValuationForTicker" in run_block
    valuation_block = run_block[
        run_block.index("void runValuationForTicker"):
        run_block.index("} catch (err: any)")
    ]
    assert "status: 'error'" not in valuation_block


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


def test_comparison_financial_charts_keep_titles_and_fallback_series():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "filterByWindowWithFallback" in src
    assert "chartHeader" in src
    assert "COMPARISON_CHART_METRICS.map(metric" in src


def test_comparison_charts_render_readable_x_axis_ticks():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "buildXAxisTicks" in src
    assert "xTicks.map" in src
    assert "formatDateTick" in src
    assert "y2={H - padB + 4}" in src
    assert "textAnchor=\"middle\"" in src


def test_comparison_charts_use_real_dates_not_point_indexes():
    src = _read("components/tabs/stock-compare-tab.tsx")
    chart_block = src[src.index("function RelativeComparisonChart"):src.index("const chartHeader")]

    assert "buildDateDomain" in src
    assert "dateToChartX" in src
    assert "dateDomain" in chart_block
    assert "dateToChartX(point.label, dateDomain)" in chart_block
    assert "pointIdx / Math.max(rawPoints.length - 1, 1)" not in chart_block
    assert "buildXAxisTicks(dateDomain" in src


def test_comparison_charts_do_not_index_signed_metrics_when_values_cross_zero():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "shouldUseIndexedAxis" in src
    assert "hasMixedSigns" in src
    assert "effectiveAxisMode" in src
    assert "실값 전환" in src


def test_comparison_shows_broker_consensus_target_in_valuation_matrix():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "analystTargetService" in src
    assert "targetConsensus" in src
    assert "compareBrokerConsensusTarget" in src
    assert "formatTargetWithGap" in src
    assert "fetchAnalystTargetFor" in src


def test_comparison_shows_forward_per_in_financial_metrics():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "forwardMetrics" in src
    assert "forward_pe" in src
    assert "FwdPER" in src


def test_comparison_uses_scorecard_ranking_design():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "CompareRankingCards" in src
    assert "buildRankedScorecards" in src
    assert "valueScore" in src
    assert "qualityScore" in src
    assert "growthScore" in src
    assert "compareValueRankTitle" in src


def test_comparison_quality_group_includes_profit_growth_rows():
    src = _read("components/tabs/stock-compare-tab.tsx")

    quality_block = src[src.index("key: 'quality'"):src.index("key: 'growth_leverage'")]
    assert "operating_income_growth" in quality_block
    assert "영업이익 성장 (연간)" in quality_block
    assert "operating_income_growth_yoy" in quality_block
    assert "영업이익 성장 (분기 YoY)" in quality_block
    assert "earnings_growth" in quality_block
    assert "순이익 성장 (연간)" in quality_block
    assert "earnings_growth_yoy" in quality_block
    assert "순이익 성장 (분기 YoY)" in quality_block


def test_comparison_annual_growth_uses_annual_metrics_and_line_item_fallback():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "annual_metrics: annualData.metrics" in src
    assert "annualMetrics: data.annual_metrics" in src
    assert "ANNUAL_GROWTH_KEYS" in src
    assert "getAnnualLineItemGrowth(slot, key)" in src
    assert "operating_income_growth: 'operating_income'" in src
    assert "earnings_growth: 'net_income'" in src
    assert "getMetricValue(s, row.key)" in src


def test_comparison_growth_score_uses_operating_and_net_income_growth():
    src = _read("components/tabs/stock-compare-tab.tsx")

    score_block = src[src.index("function buildRankedScorecards"):src.index("function newSlot")]
    assert "operatingIncomeGrowth" in score_block
    assert "operatingIncomeGrowthQ" in score_block
    assert "earningsGrowth" in score_block
    assert "earningsGrowthQ" in score_block
    assert "scoreMaps.operatingIncomeGrowth.get(slot.id)" in score_block
    assert "scoreMaps.operatingIncomeGrowthQ.get(slot.id)" in score_block


def test_comparison_deep_links_to_stock_analysis():
    # 비교 → 종목 분석 딥링크: 저장 분석 재열람과 같은 패턴(patchWorkspace + TabService)
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "useTabsContext" in src
    assert "useWorkspace" in src
    assert "TabService.createStockSearchTab()" in src
    assert "patchWorkspace({ tickers: trimmed })" in src
    assert "onOpenAnalysis" in src
    assert "compareOpenAnalysis" in src

    prefs = _read("lib/language-preferences.ts")
    assert "compareOpenAnalysis: '분석 열기'" in prefs
    assert "compareOpenAnalysis: 'Open analysis'" in prefs


def test_comparison_has_same_axis_metric_bars():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "MetricBarComparisonPanel" in src
    assert "VALUATION_BAR_ROWS" in src
    assert "FINANCIAL_BAR_GROUPS" in src
    assert "BEST" in src
    assert "metricBarTrack" in src


def test_comparison_score_tooltips_and_axis_explanations():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "TooltipTrigger" in src
    assert "ScoreHelpTooltip" in src
    assert "scoreHelpText" in src
    assert "axisHelpText" in src
    assert "상승여력" in src
    assert "멀티플 자체" in src


def test_comparison_uses_muted_professional_palette():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "#4f83cc" in src
    assert "#2f9b72" in src
    assert "#c95f66" in src
    assert "bg-card/30" in src
