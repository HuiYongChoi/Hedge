"""Static source-level checks for report sentiment marker integration."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LLM = ROOT / "src/utils/llm.py"
TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
DATA_SANDBOX_TAB = ROOT / "app/frontend/src/components/tabs/data-sandbox-tab.tsx"
REPORT_SENTIMENT = ROOT / "app/frontend/src/components/reports/report-sentiment-dashboard.tsx"
DAMODARAN = ROOT / "src/agents/aswath_damodaran.py"
BUFFETT = ROOT / "src/agents/warren_buffett.py"
GROWTH = ROOT / "src/agents/growth_agent.py"


class ReportSentimentMarkerStaticTests(unittest.TestCase):

    # ── Backend: llm.py constants ────────────────────────────────────────────

    def test_llm_defines_sentiment_marker_requirement(self):
        source = LLM.read_text(encoding="utf-8")
        self.assertIn("SENTIMENT_MARKER_REQUIREMENT", source)
        self.assertIn("[+]", source)
        self.assertIn("[-]", source)
        self.assertIn("[~]", source)
        self.assertIn("[?]", source)

    def test_llm_defines_company_identity_requirement(self):
        source = LLM.read_text(encoding="utf-8")
        self.assertIn("COMPANY_IDENTITY_REQUIREMENT", source)
        self.assertIn("COMPANY IDENTITY REQUIREMENT", source)

    # ── Backend: damodaran agent ─────────────────────────────────────────────

    def test_damodaran_imports_resolve_company_name(self):
        source = DAMODARAN.read_text(encoding="utf-8")
        self.assertIn("resolve_company_name", source)

    def test_damodaran_uses_company_identity_requirement(self):
        source = DAMODARAN.read_text(encoding="utf-8")
        self.assertIn("COMPANY_IDENTITY_REQUIREMENT", source)

    def test_damodaran_uses_sentiment_marker_requirement(self):
        source = DAMODARAN.read_text(encoding="utf-8")
        self.assertIn("SENTIMENT_MARKER_REQUIREMENT", source)

    def test_damodaran_human_message_has_company_name(self):
        source = DAMODARAN.read_text(encoding="utf-8")
        self.assertIn("Company name: {company_name}", source)

    # ── Backend: buffett agent ───────────────────────────────────────────────

    def test_buffett_imports_resolve_company_name(self):
        source = BUFFETT.read_text(encoding="utf-8")
        self.assertIn("resolve_company_name", source)

    def test_buffett_uses_company_identity_requirement(self):
        source = BUFFETT.read_text(encoding="utf-8")
        self.assertIn("COMPANY_IDENTITY_REQUIREMENT", source)

    def test_buffett_uses_sentiment_marker_requirement(self):
        source = BUFFETT.read_text(encoding="utf-8")
        self.assertIn("SENTIMENT_MARKER_REQUIREMENT", source)

    # ── Backend: growth_agent (no LLM — only company_name injection) ─────────

    def test_growth_agent_imports_resolve_company_name(self):
        source = GROWTH.read_text(encoding="utf-8")
        self.assertIn("resolve_company_name", source)

    def test_growth_agent_injects_company_name(self):
        source = GROWTH.read_text(encoding="utf-8")
        self.assertIn("company_name", source)

    # ── Frontend: stock-search-tab.tsx renderer ───────────────────────────────

    def test_frontend_has_parse_sentiment_marker(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("parseSentimentMarker", source)

    def test_frontend_has_render_toned_content(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("renderTonedContent", source)

    def test_frontend_has_ensure_paragraph_breaks(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("ensureParagraphBreaks", source)

    def test_frontend_has_tone_legend(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("ToneLegend", source)

    def test_frontend_has_tone_styles(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("TONE_STYLES", source)

    def test_frontend_uses_ensure_paragraph_breaks_at_call_sites(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("ensureParagraphBreaks(", source)

    def test_frontend_renders_company_name_header(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("companyName", source)
        self.assertIn("company_name", source)

    def test_frontend_has_grouped_sentiment_dashboard_component(self):
        self.assertTrue(REPORT_SENTIMENT.exists())
        source = REPORT_SENTIMENT.read_text(encoding="utf-8")

        self.assertIn("ReportSentimentDashboard", source)
        self.assertIn("collectReportSentimentItems", source)
        self.assertIn("긍정 근거", source)
        self.assertIn("부정 리스크", source)
        self.assertIn("중립/보합", source)
        self.assertIn("데이터 공백", source)

    def test_stock_search_uses_sentiment_dashboard_before_raw_reasoning(self):
        source = TAB.read_text(encoding="utf-8")
        agent_summary_source = source[source.index("function AgentReportSummary") :]
        final_decision_source = source[
            source.index("{/* Final Decision */}") : source.index("{completeResult.reasoning &&")
        ]

        self.assertIn("ReportSentimentDashboard", source)
        self.assertLess(
            agent_summary_source.index("<ReportSentimentDashboard"),
            agent_summary_source.index("renderMarkdownBlocks("),
        )
        self.assertLess(
            final_decision_source.index("<ReportSentimentDashboard"),
            final_decision_source.index("renderMarkdownBlocks("),
        )

    def test_data_sandbox_uses_sentiment_dashboard_and_toned_lines(self):
        source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

        self.assertIn("ReportSentimentDashboard", source)
        self.assertIn("renderReportTonedContent", source)
        self.assertIn("renderReportTonedContent(line.replace", source)
        self.assertLess(
            source.index("<ReportSentimentDashboard"),
            source.index("renderMarkdown(result.reasoning)"),
        )

    def test_detailed_report_lines_are_sorted_by_sentiment_tone(self):
        dashboard_source = REPORT_SENTIMENT.read_text(encoding="utf-8")
        stock_source = TAB.read_text(encoding="utf-8")
        sandbox_source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

        self.assertIn("REPORT_TONE_ORDER", dashboard_source)
        self.assertIn("sortReportSentimentLines", dashboard_source)
        self.assertIn("positive: 0", dashboard_source)
        self.assertIn("negative: 1", dashboard_source)
        self.assertIn("neutral: 2", dashboard_source)
        self.assertIn("unknown: 3", dashboard_source)
        self.assertIn("sortReportSentimentLines(markdown)", stock_source)
        self.assertIn("sortReportSentimentLines(text)", sandbox_source)

    def test_orphan_ordered_numbers_are_joined_to_following_paragraph(self):
        dashboard_source = REPORT_SENTIMENT.read_text(encoding="utf-8")
        stock_source = TAB.read_text(encoding="utf-8")
        sandbox_source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

        self.assertIn("normalizeReportOrderedMarkers", dashboard_source)
        self.assertIn("pendingOrderedMarker", dashboard_source)
        self.assertIn("normalizeReportOrderedMarkers(sortReportSentimentLines(markdown))", stock_source)
        self.assertIn("normalizeReportOrderedMarkers(sortReportSentimentLines(text))", sandbox_source)


if __name__ == "__main__":
    unittest.main()
