from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
DASHBOARD = ROOT / "app/frontend/src/components/reports/analyst-report-dashboard.tsx"


class StockSearchFinalDecisionUiStaticTests(unittest.TestCase):
    def test_final_decision_uses_composite_score_and_status_label(self):
        source = STOCK_TAB.read_text(encoding="utf-8")
        dashboard_source = DASHBOARD.read_text(encoding="utf-8")

        # calculateCompositeScore still lives in stock-search-tab and is passed to dashboard
        self.assertIn("function calculateCompositeScore", source)
        # getScoreBand moved to dashboard component
        self.assertIn("function getScoreBand", dashboard_source)
        # Score band labels appear in the dashboard
        self.assertIn("강력 매수", dashboard_source)
        self.assertIn("Watch", dashboard_source)
        self.assertNotIn("t('holdAction', language).toUpperCase()", source)

    def test_final_decision_has_score_display_in_dashboard(self):
        dashboard_source = DASHBOARD.read_text(encoding="utf-8")

        # New dashboard has compact score gauge
        self.assertIn("ScoreGaugeCompact", dashboard_source)
        self.assertIn("strokeDasharray", dashboard_source)
        # Score band labels
        self.assertIn("강력 매수", dashboard_source)
        self.assertIn("Strong Buy", dashboard_source)

    def test_final_decision_adds_6_panel_grid_to_dashboard(self):
        dashboard_source = DASHBOARD.read_text(encoding="utf-8")

        # 6-panel grid components
        self.assertIn("DcfPanel", dashboard_source)
        self.assertIn("MultiplesPanel", dashboard_source)
        self.assertIn("VerdictPanel", dashboard_source)
        self.assertIn("BearThesisPanel", dashboard_source)
        self.assertIn("RiskPanel", dashboard_source)
        self.assertIn("CrossCheckPanel", dashboard_source)
        # Analyst strip
        self.assertIn("AnalystStrip", dashboard_source)

    def test_final_decision_reasoning_is_split_into_markdown_blocks(self):
        source = STOCK_TAB.read_text(encoding="utf-8")
        # Reasoning rendering helpers still exist in stock-search-tab
        self.assertIn("function formatDecisionReasoning", source)
        self.assertIn("function normalizeCrossCheckGuideHeading", source)
        # Detail report view still uses them
        detail_view_source = source[source.index("id=\"detail-report-view\""):]
        self.assertIn("renderMarkdownBlocks(", detail_view_source)

    def test_cross_check_heading_is_generic_in_fallback_guides(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("### 🔍 원문 대조 체크리스트", source)
        self.assertNotIn("${result.agentName}의 원문 대조 체크리스트", source)

    def test_research_quick_links_support_us_and_korean_tickers(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("function isKoreanStock", source)
        self.assertIn("function getResearchLinks", source)
        self.assertIn("참고 자료 및 원본 공시", source)
        self.assertIn("SEC 10-K", source)
        self.assertIn("https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(normalized)}&owner=exclude", source)
        self.assertNotIn("cgi-bin/browse-edgar?action=getcompany", source)
        self.assertIn("Finviz", source)
        self.assertIn("DART 정기보고서", source)
        self.assertIn("네이버 증권", source)
        self.assertIn("target=\"_blank\"", source)
        self.assertLess(
            source.index("<ResearchQuickLinks"),
            source.index("{/* Final Decision */}"),
        )

    def test_analyst_report_dashboard_wired_into_stock_search_tab(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("AnalystReportDashboard", source)
        self.assertIn("from '@/components/reports/analyst-report-dashboard'", source)
        # compositeScore passed to dashboard
        self.assertIn("compositeScore={score}", source)


if __name__ == "__main__":
    unittest.main()
