"""Static source-level checks for report sentiment marker integration."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LLM = ROOT / "src/utils/llm.py"
TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
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


if __name__ == "__main__":
    unittest.main()
