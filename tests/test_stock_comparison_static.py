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


def test_comparison_restores_latest_result_after_refresh():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "RESULT_STORAGE_KEY = 'stock-compare:last-result'" in src
    assert "loadInitialCompareState" in src
    assert "persistCompareSnapshot" in src
    assert "sanitizeRestoredSlot" in src
    assert "baselineId" in src
    assert "chartMetricKey" in src
    assert "chartWindow" in src
    assert "chartAxisMode" in src
    assert "slots.some(slot => slot.status === 'ready')" in src
    assert "snapshot.slots" in src


def test_comparison_can_export_current_screen_to_pdf():
    src = _read("components/tabs/stock-compare-tab.tsx")
    css = _read("index.css")

    assert "handlePrintComparison" in src
    assert "window.print()" in src
    assert "FileText" in src
    assert "PDF 저장" in src
    assert "Save PDF" in src
    assert "stock-compare-print-root" in src
    assert "no-print flex items-center gap-2" in src
    assert "#stock-compare-print-root" in css
    assert "#stock-compare-print-root *" in css


def test_comparison_pdf_matches_screen_layout():
    # PDF가 화면과 달라지던 원인 회귀 방지:
    # A4 분할은 카드가 페이지 경계마다 밀려 빈 페이지·낱장 파편화를 만들었다.
    # 화면 스크롤 전체를 통짜 한 페이지로 출력해 눈에 보이는 것과 동일하게 만든다.
    src = _read("components/tabs/stock-compare-tab.tsx")
    css = _read("index.css")

    assert "printRoot?.scrollHeight" in src
    assert "size: ${pageWidthPx}px ${pageHeightPx}px; margin: 0;" in src
    assert "compare-print-orientation" in src
    assert "orientationStyle.remove()" in src

    assert '[class*="lg:grid-cols-3"]' in css
    assert "repeat(3, minmax(0, 1fr)) !important" in css
    # 차트 선이 PDF 변환·축소 열람에서 사라지지 않게 인쇄에서 두껍고 진하게
    assert "#stock-compare-print-root svg path[stroke]" in css
    assert "stroke-width: 2.75 !important" in css
    assert "stroke-opacity: 0.55 !important" in css
    # 가로 막대 행: 인쇄 뷰포트에서 md: 그리드가 무너져 막대가 사라지던 회귀 방지
    assert "metricBarRowSplit" in src
    assert "metricBarRowSimple" in src
    assert "#stock-compare-print-root .metricBarRowSplit" in css
    assert "8rem minmax(0, 1fr) 2.75rem 8.5rem 7.5rem !important" in css
    assert "#stock-compare-print-root .rounded-full.bg-muted" in css
    assert "height: 10px !important" in css
    # 전역 height:auto 언클램프가 비교 서브트리의 고정높이 막대를 0으로 접지 않게 제외
    assert ":not(#stock-compare-print-root *)" in css
    # 섹션 단위 avoid는 금지(카드 단위만) — 문자열 재등장 감시
    assert "#stock-compare-print-root section,\n  #stock-compare-print-root .rounded-lg" not in css
    assert "#analyst-report-root article" in css
    assert "@page {" in css


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


def test_comparison_valuation_bars_explain_price_gap_basis():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "formatValuationBarPrimary" in src
    assert "formatValuationBarSecondary" in src
    assert "getValuationBarTooltip" in src
    assert "현재가 대비" in src
    assert "산식" in src
    assert "현재가" in src


def test_comparison_valuation_bars_split_value_and_gap_columns():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "hasSplitValueColumns" in src
    assert "metricBarBestCell" in src
    assert "metricBarValueCell" in src
    assert "metricBarGapCell" in src
    assert "md:grid-cols-[8rem_minmax(0,1fr)_2.75rem_8.5rem_7.5rem]" in src


def test_comparison_score_tooltips_and_axis_explanations():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "TooltipTrigger" in src
    assert "ScoreHelpTooltip" in src
    assert "scoreHelpText" in src
    assert "axisHelpText" in src
    assert "상승여력" in src
    assert "멀티플 자체" in src


def test_comparison_rank_cards_group_reference_metrics_by_score_axis():
    src = _read("components/tabs/stock-compare-tab.tsx")

    assert "buildScoreEvidenceGroups" in src
    assert "ScoreEvidenceGroup" in src
    assert "참고 수치" in src
    assert "Referenced metrics" in src

    evidence_block = src[src.index("function buildScoreEvidenceGroups"):src.index("function ScoreEvidenceGroup")]
    assert "key: 'value'" in evidence_block
    assert "FwdPER(NTM)" in evidence_block
    assert "증권사 평균목표가" in evidence_block
    assert "목표 상승여력" in evidence_block
    assert "key: 'quality'" in evidence_block
    assert "ROIC" in evidence_block
    assert "분기 영업이익률" in evidence_block
    assert "key: 'growth'" in evidence_block
    assert "분기 영업이익 YoY" in evidence_block
    assert "영업이익률 추세" in evidence_block

    ranking_block = src[src.index("function CompareRankingCards"):src.index("function ScoreBar")]
    assert "buildScoreEvidenceGroups(card.slot, language).map" in ranking_block
    assert "<ScoreEvidenceGroup" in ranking_block


def test_comparison_uses_muted_professional_palette():
    src = _read("components/tabs/stock-compare-tab.tsx")
    assert "#4f83cc" in src
    assert "#2f9b72" in src
    assert "#c95f66" in src
    assert "bg-card/30" in src
