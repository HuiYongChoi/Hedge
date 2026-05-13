from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
V5_HELPERS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts"


class StockAnalysisLayoutStaticTests(unittest.TestCase):
    def test_config_panel_auto_collapses_after_run_and_can_toggle(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("isConfigPanelCollapsed", source)
        self.assertIn("setIsConfigPanelCollapsed(true)", source)
        self.assertIn("setIsConfigPanelCollapsed(prev => !prev)", source)
        self.assertIn("aria-label={isConfigPanelCollapsed", source)
        self.assertIn("w-14", source)
        self.assertIn("w-72", source)

    def test_dashboard_renders_before_agent_cards(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertLess(
            source.index("{/* Final Decision */}"),
            source.index("{/* Agent cards */}"),
        )
        self.assertLess(
            source.index("<AnalystReportDashboard"),
            source.index("agentResultList.map"),
        )

    def test_conclusion_summary_filters_weak_headings_and_keeps_key_points(self):
        source = V5_HELPERS.read_text(encoding="utf-8")

        self.assertIn("buildConciseConclusion", source)
        self.assertIn("isWeakConclusion", source)
        self.assertIn("selectMeaningfulSentence", source)
        self.assertIn("stripMarkdownNoise", source)
        self.assertIn("valuationDcf", source)
        self.assertIn("risks", source)


if __name__ == "__main__":
    unittest.main()
