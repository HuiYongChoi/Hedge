from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
DASHBOARD = ROOT / "app/frontend/src/components/reports/analyst-report-dashboard.tsx"
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"


class StockSearchFinalDecisionUiStaticTests(unittest.TestCase):
    def test_final_decision_uses_composite_score_and_status_label(self):
        source = STOCK_TAB.read_text(encoding="utf-8")
        dashboard_source = DASHBOARD.read_text(encoding="utf-8")
        header_source = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")

        # calculateCompositeScore still lives in stock-search-tab and is passed to dashboard
        self.assertIn("function calculateCompositeScore", source)
        # Dashboard delegates to the v5 layout and score band labels live in v5 helpers/header
        self.assertIn("ReportLayout", dashboard_source)
        self.assertIn("getScoreBand", header_source)
        self.assertIn("ScoreGaugeCompact", header_source)
        self.assertNotIn("t('holdAction', language).toUpperCase()", source)

    def test_final_decision_has_score_display_in_v5_header(self):
        header_source = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")
        helpers_source = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        # New dashboard has compact score gauge
        self.assertIn("ScoreGaugeCompact", header_source)
        self.assertIn("strokeDasharray", header_source)
        # Score band labels
        self.assertIn("강력 매수", helpers_source)
        self.assertIn("Strong Buy", helpers_source)

    def test_final_decision_adds_v5_layout_to_dashboard(self):
        dashboard_source = DASHBOARD.read_text(encoding="utf-8")

        self.assertIn("from './analyst-report-v5/report-layout'", dashboard_source)
        self.assertIn("ReportLayout", dashboard_source)
        self.assertNotIn("6-panel grid", dashboard_source)

    def test_final_decision_reasoning_is_split_into_markdown_blocks(self):
        source = STOCK_TAB.read_text(encoding="utf-8")
        # Reasoning rendering helpers are shared through markdown-blocks
        self.assertIn("from '@/lib/markdown-blocks'", source)
        self.assertIn("formatDecisionReasoning", source)
        self.assertIn("normalizeCrossCheckGuideHeading", source)
        self.assertNotIn("function formatDecisionReasoning", source)
        self.assertNotIn("function normalizeCrossCheckGuideHeading", source)
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
        # edgar/browse/?CIK=는 숫자 CIK 전용이라 티커(GOOGL)로는 "CIK Not Found"(실검증).
        # cgi-bin browse-edgar는 티커를 서버에서 해석해 10-K 목록을 보여준다(200 확인).
        self.assertIn("cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(normalized)}&type=10-K", source)
        self.assertNotIn("edgar/browse/?CIK=", source)
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
