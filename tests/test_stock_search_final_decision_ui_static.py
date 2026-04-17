from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"


class StockSearchFinalDecisionUiStaticTests(unittest.TestCase):
    def test_final_decision_uses_composite_score_and_status_label(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("function calculateCompositeScore", source)
        self.assertIn("function getScoreBand", source)
        self.assertIn("종합 점수", source)
        self.assertIn("관망", source)
        self.assertNotIn("t('holdAction', language).toUpperCase()", source)

    def test_final_decision_has_executive_summary_and_score_tooltip(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("function buildExecutiveSummary", source)
        self.assertIn("약식 요약", source)
        self.assertIn("TooltipContent", source)
        self.assertIn("80~100점: 강력 매수", source)
        self.assertIn("Info", source)


if __name__ == "__main__":
    unittest.main()
