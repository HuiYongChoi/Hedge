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

    def test_final_decision_reasoning_is_split_into_markdown_blocks(self):
        source = STOCK_TAB.read_text(encoding="utf-8")
        final_decision_source = source[
            source.index("{/* Final Decision */}") : source.index("{completeResult.reasoning &&")
        ]

        self.assertIn("function formatDecisionReasoning", source)
        self.assertIn("function normalizeCrossCheckGuideHeading", source)
        self.assertIn("{renderMarkdownBlocks(formatDecisionReasoning(decision.reasoning))}", final_decision_source)
        self.assertNotIn("{String(decision.reasoning)}", final_decision_source)

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
        self.assertIn("Finviz", source)
        self.assertIn("DART 정기보고서", source)
        self.assertIn("네이버 증권", source)
        self.assertIn("target=\"_blank\"", source)
        self.assertLess(
            source.index("<ResearchQuickLinks"),
            source.index("{/* Final Decision */}"),
        )


if __name__ == "__main__":
    unittest.main()
