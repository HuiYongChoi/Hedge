from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
MARKDOWN_BLOCKS = ROOT / "app/frontend/src/lib/markdown-blocks.tsx"
LANG_PREFS = ROOT / "app/frontend/src/lib/language-preferences.ts"
VALUATION = ROOT / "src/agents/valuation.py"


class AnalystReportV5Phase2StaticTests(unittest.TestCase):
    def test_layout_supports_multiple_tickers(self):
        src = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        self.assertIn("TickerSwitcher", src)
        self.assertIn("activeTicker", src)
        self.assertIn("Object.keys(completeResult.decisions", src)

    def test_pick_default_agent_takes_ticker(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertRegex(src, r"pickDefaultAgent\s*\([^)]*activeTicker")

    def test_normalize_report_function_exists(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertRegex(src, r"export function normalizeAgentReport\s*\(")

    def test_normalized_report_type_exists(self):
        src = (V5_DIR / "types.ts").read_text(encoding="utf-8")
        self.assertIn("export interface NormalizedReport", src)
        self.assertIn("conclusion:", src)
        self.assertIn("valuationDcf:", src)
        self.assertIn("multiples:", src)
        self.assertIn("risks:", src)
        self.assertIn("crossCheck:", src)
        self.assertIn("sources:", src)

    def test_body_uses_normalized_report(self):
        src = (V5_DIR / "report-body.tsx").read_text(encoding="utf-8")
        self.assertIn("normalizeAgentReport", src)

    def test_citation_confidence_levels_defined(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("highRegex", src)
        self.assertIn("mediumRegex", src)
        self.assertIn("CITATION_RULES", src)

    def test_citation_chip_handles_confidence_and_href(self):
        src = (V5_DIR / "citation-chip.tsx").read_text(encoding="utf-8")
        self.assertIn("confidence", src)
        self.assertIn("hrefAvailable", src)

    def test_citation_auto_note_in_toc(self):
        src = (V5_DIR / "report-toc-sidebar.tsx").read_text(encoding="utf-8")
        self.assertIn("citationAutoNote", src)

    def test_markdown_blocks_module_exists(self):
        self.assertTrue(MARKDOWN_BLOCKS.exists())
        src = MARKDOWN_BLOCKS.read_text(encoding="utf-8")
        for fn in [
            "formatDecisionReasoning",
            "normalizeCrossCheckGuideHeading",
            "ensureParagraphBreaks",
            "renderMarkdownBlocks",
            "renderInlineMarkdown",
            "renderTonedContent",
        ]:
            self.assertRegex(src, rf"export (function|const) {fn}\b")

    def test_stock_search_imports_from_markdown_module(self):
        src = STOCK_TAB.read_text(encoding="utf-8")
        self.assertIn("from '@/lib/markdown-blocks'", src)
        self.assertNotIn("function renderMarkdownBlocks(", src)
        self.assertNotIn("function ensureParagraphBreaks(", src)

    def test_v5_modal_uses_shared_markdown_helpers(self):
        src = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        self.assertIn("from '@/lib/markdown-blocks'", src)
        self.assertIn("renderMarkdownBlocks(", src)
        self.assertNotIn('<pre className="whitespace-pre-wrap break-words text-sm', src)

    def test_helpers_no_longer_exports_render_text_with_data_chips(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertNotIn("export function renderTextWithDataChips", src)
        self.assertNotIn("export const renderTextWithDataChips", src)

    def test_helpers_exports_data_token_helpers(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        for fn in ["splitTextIntoDataTokenParts", "findDataTokenReferences", "classifyDataTokenTone"]:
            self.assertRegex(src, rf"export function {fn}\b")

    def test_inline_data_chip_component_is_canonical(self):
        src = (V5_DIR / "inline-data-chip.tsx").read_text(encoding="utf-8")
        self.assertIn("export function TextWithDataChips", src)
        self.assertIn("sectionId", src)
        self.assertIn("citations", src)

    def test_valuation_emits_sensitivity_matrix(self):
        src = VALUATION.read_text(encoding="utf-8")
        self.assertIn("_build_sensitivity_matrix", src)
        self.assertIn("sensitivity_matrix", src)

    def test_v5_extracts_sensitivity_matrix(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("extractSensitivityMatrix", src)
        self.assertIn("shouldShowSensitivity", src)

    def test_v5_section_02_renders_heatmap(self):
        src = (V5_DIR / "report-section.tsx").read_text(encoding="utf-8")
        self.assertIn("SensitivityHeatmap", src)
        self.assertIn("'section-02'", src)

    def test_canonical_metrics_helper(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("buildCanonicalMetrics", src)
        self.assertIn("CanonicalMetrics", src)

    def test_target_tile_has_source_agent(self):
        src = (V5_DIR / "types.ts").read_text(encoding="utf-8")
        self.assertIn("sourceAgent", src)
        self.assertIn("isFromActiveAgent", src)

    def test_sidebar_shows_source_agent_chip(self):
        src = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")
        self.assertIn("sourceAgent", src)

    def test_layout_has_mobile_toc(self):
        src = (V5_DIR / "report-toc-sidebar.tsx").read_text(encoding="utf-8")
        self.assertRegex(src, r"export (function|const) MobileToc\b")

    def test_layout_responsive_classes(self):
        src = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        self.assertIn("lg:flex-row", src)
        self.assertIn("lg:hidden", src)

    def test_target_sidebar_responsive_grid(self):
        src = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")
        self.assertIn("grid-cols-2", src)
        self.assertIn("lg:grid-cols-1", src)

    def test_header_ribbon_responsive(self):
        src = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")
        self.assertIn("lg:flex-row", src)
        self.assertIn("flex-col", src)

    def test_phase2_i18n_keys_exist(self):
        src = LANG_PREFS.read_text(encoding="utf-8")
        for key in [
            "tickerSwitcherLabel",
            "citationAutoNote",
            "sensitivityTitle",
            "sensitivityCurrentAssumption",
            "targetDataEmpty",
            "targetTileFromAgent",
            "mobileTocLabel",
        ]:
            self.assertIn(f"{key}:", src)


if __name__ == "__main__":
    unittest.main()
