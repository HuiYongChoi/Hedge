from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"
DASHBOARD = ROOT / "app/frontend/src/components/reports/analyst-report-dashboard.tsx"
LANG_PREFS = ROOT / "app/frontend/src/lib/language-preferences.ts"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"


class AnalystReportV5StaticTests(unittest.TestCase):
    def test_v5_folder_has_all_components(self):
        expected = [
            "types.ts",
            "helpers.ts",
            "report-layout.tsx",
            "report-header-ribbon.tsx",
            "report-toc-sidebar.tsx",
            "report-body.tsx",
            "report-section.tsx",
            "evidence-item.tsx",
            "inline-data-chip.tsx",
            "citation-chip.tsx",
            "key-numbers-strip.tsx",
            "target-data-sidebar.tsx",
            "sensitivity-heatmap.tsx",
        ]
        for fname in expected:
            self.assertTrue((V5_DIR / fname).exists(), f"{fname} missing")

    def test_v5_helpers_exports_required_functions(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        for fn in [
            "normalizeAgentReport",
            "splitReasoningIntoSections",
            "parseEvidenceItems",
            "classifyItemTone",
            "splitTextIntoDataTokenParts",
            "findDataTokenReferences",
            "classifyDataTokenTone",
            "inferCitationLetters",
            "buildCitations",
            "extractKeyNumbers",
            "buildCanonicalMetrics",
            "extractTargetTiles",
            "listOtherAgents",
            "pickDefaultAgent",
        ]:
            self.assertIn(f"export function {fn}", src)

    def test_v5_layout_renders_3_columns(self):
        src = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        self.assertIn("ReportHeaderRibbon", src)
        self.assertIn("ReportTocSidebar", src)
        self.assertIn("ReportBody", src)
        self.assertIn("TargetDataSidebar", src)
        self.assertIn("w-[200px]", (V5_DIR / "report-toc-sidebar.tsx").read_text(encoding="utf-8"))
        self.assertIn("w-[280px]", (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8"))

    def test_header_uses_live_market_data_for_price_and_margin(self):
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        header = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")

        self.assertIn("analystTargetService", layout)
        self.assertIn("effectiveCurrentPrice", layout)
        self.assertIn("calcMarginOfSafety", layout)
        self.assertIn("refreshMarketData", layout)
        self.assertIn("analysisGeneratedAt", header)
        self.assertIn("marketDataUpdatedAt", header)
        self.assertIn("onRefreshMarketData", header)
        self.assertIn("RefreshCw", header)

    def test_stock_tab_passes_report_generated_timestamp(self):
        src = STOCK_TAB.read_text(encoding="utf-8")
        self.assertIn("analysisGeneratedAt", src)
        self.assertIn("setAnalysisGeneratedAt", src)
        self.assertIn("analysisGeneratedAt={analysisGeneratedAt}", src)

    def test_dashboard_delegates_to_v5(self):
        src = DASHBOARD.read_text(encoding="utf-8")
        self.assertIn("from './analyst-report-v5/report-layout'", src)
        self.assertIn("ReportLayout", src)

    def test_i18n_keys_added(self):
        src = LANG_PREFS.read_text(encoding="utf-8")
        for key in [
            "reportTocTitle",
            "reportSection01",
            "reportSection06",
            "targetDataTitle",
            "otherAgentsTitle",
            "openConsensusMatrix",
            "citationAutoNote",
        ]:
            self.assertIn(f"{key}:", src)

    def test_data_chip_and_citation_patterns_present(self):
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")
        inline = (V5_DIR / "inline-data-chip.tsx").read_text(encoding="utf-8")
        self.assertIn(r"\$\d", helpers)
        self.assertIn("%|배|x|X", helpers)
        self.assertIn("TextWithDataChips", evidence)
        self.assertIn("annotateTextWithCitations", inline)
        self.assertIn("CitationChip", evidence)

    def test_stock_tab_exports_reusable_report_helpers(self):
        src = STOCK_TAB.read_text(encoding="utf-8")
        for signature in [
            "export function isKoreanStock",
            "export function getKoreanStockCode",
            "export function getResearchLinks",
            "export function extractCrossCheckGuide",
            "export function buildFallbackCrossCheckGuide",
        ]:
            self.assertIn(signature, src)


if __name__ == "__main__":
    unittest.main()
