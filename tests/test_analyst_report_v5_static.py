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
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("analystTargetService", layout)
        self.assertIn("effectiveCurrentPrice", layout)
        self.assertIn("calcMarginOfSafety", layout)
        self.assertIn("extractReasoningMetricValue", layout)
        self.assertIn("refreshMarketData", layout)
        self.assertIn("export function extractReasoningMetricValue", helpers)
        self.assertIn("marginOfSafetyPatterns", helpers)
        self.assertIn("안전마진", helpers)
        self.assertIn("analysisGeneratedAt", header)
        self.assertIn("marketDataUpdatedAt", header)
        self.assertIn("onRefreshMarketData", header)
        self.assertIn("RefreshCw", header)

    def test_header_uses_company_display_name_and_reference_margin(self):
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        header = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("getDisplayTickerLabel", helpers)
        self.assertIn("000660.KS", helpers)
        self.assertIn("SK하이닉스", helpers)
        self.assertIn("displayTickerLabel", layout)
        self.assertIn("displayTicker={displayTickerLabel}", layout)
        self.assertIn("displayTicker: string", header)
        self.assertIn("{displayTicker} · {activeAgent.name}", header)

    def test_margin_of_safety_recomputes_from_reference_price(self):
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        header = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("resolveMarginOfSafetySnapshot", helpers)
        self.assertIn("normalizePerShareReferencePrice", helpers)
        self.assertIn("marginSnapshot", layout)
        self.assertIn("marginReferencePrice={marginSnapshot.referencePrice}", layout)
        self.assertIn("marginReferencePrice", header)
        self.assertIn("function formatMargin(", header)
        self.assertIn("value: number | null", header)
        self.assertIn("referencePrice", header)
        self.assertIn("formatMoney(referencePrice", header)

    def test_target_margin_tile_shows_historical_buffered_price_not_raw_intrinsic(self):
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("extractTargetTiles(effectiveMetrics, activeAgentKey, language, effectiveCurrency)", layout)
        self.assertIn("formatMarginTarget", helpers)
        self.assertIn("SAFETY_MARGIN_PRICE_BUFFER = 0.25", helpers)
        self.assertIn("safetyMarginPrice", helpers)
        self.assertIn("formatSafetyMarginTarget", helpers)
        self.assertNotIn("formatMarginTarget(value, metrics.intrinsicValue?.value", helpers)
        self.assertNotIn("formatCurrency(referencePrice, currency)", helpers)

    def test_header_metric_chips_have_tooltips(self):
        header = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")
        prefs = LANG_PREFS.read_text(encoding="utf-8")

        for needle in ["TooltipProvider", "TooltipTrigger", "TooltipContent", "MetricChip"]:
            self.assertIn(needle, header)
        for key in ["currentPriceHelp", "marginOfSafetyHelp", "reportGeneratedAtHelp", "marketDataUpdatedAtHelp"]:
            self.assertIn(key, header)
            self.assertIn(f"{key}:", prefs)

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

    def test_report_readability_splits_dense_agent_output(self):
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("prepareEvidenceLayoutText", helpers)
        self.assertIn("splitLongEvidenceBlock", helpers)
        self.assertIn("mergeOrphanEvidenceHeadings", helpers)
        self.assertIn("isBlankEvidenceItem", helpers)
        self.assertIn("isMarkerOnlyEvidenceText", helpers)
        self.assertIn("isHeadingOnlyEvidenceText", helpers)
        self.assertIn("핵심 판단", helpers)
        self.assertIn("포워드 아웃룩", helpers)
        self.assertIn("inline headings", helpers)
        self.assertNotIn("source.slice(0, 7)", helpers)

    def test_evidence_cards_render_body_as_blocks(self):
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")
        inline = (V5_DIR / "inline-data-chip.tsx").read_text(encoding="utf-8")
        self.assertIn("splitEvidenceBodyBlocks", evidence)
        self.assertIn("space-y-2.5", evidence)
        self.assertIn("leading-7", evidence)
        self.assertIn("inlineCitations={false}", evidence)
        self.assertIn("visibleBodyBlocks", evidence)
        self.assertIn("isMarkerOnlyBodyBlock", evidence)
        self.assertIn("isHeadingOnlyBodyBlock", evidence)
        self.assertIn("HEADING_ONLY_BODY_PATTERNS", evidence)
        self.assertIn("readableTextStyle", evidence)
        self.assertIn("wordBreak: 'keep-all'", evidence)
        self.assertIn("overflowWrap: 'break-word'", evidence)
        self.assertNotIn(".slice(0, 4)", evidence)
        self.assertIn("inlineCitations", inline)

    def test_v5_report_body_does_not_truncate_conclusion_text(self):
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("buildConciseConclusion", helpers)
        self.assertIn("joinConclusionParts", helpers)
        self.assertNotIn("function truncateSummary", helpers)
        self.assertNotIn("return truncateSummary(parts.slice", helpers)
        self.assertNotIn("parts.slice(0, 3)", helpers)
        self.assertNotIn("|| truncateSummary(stripMarkdownNoise(reasoning))", helpers)
        self.assertNotIn("compact.slice(0, 57)", helpers)

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

    def test_rim_pbr_deep_dive_regression_is_removed_until_reintroduced_safely(self):
        src = (V5_DIR / "report-section.tsx").read_text(encoding="utf-8")
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        types = (V5_DIR / "types.ts").read_text(encoding="utf-8")
        prefs = LANG_PREFS.read_text(encoding="utf-8")

        self.assertFalse((V5_DIR / "valuation-panel").exists(), "RIM/PBR panel must stay removed in strategy A")
        for src_text in [src, layout, helpers, types, prefs]:
            self.assertNotIn("ValuationDeepDive", src_text)
            self.assertNotIn("valuation-panel", src_text)
            self.assertNotIn("buildValuationDeepDive", src_text)
            self.assertNotIn("pbrBand", src_text)
            self.assertNotIn("RimBreakdown", src_text)

    def test_get_agent_report_is_suffix_aware_for_live_sse_keys(self):
        """Live SSE uses keys like aswath_damodaran_codx01."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function getAgentReport")
        snippet = src[fn_start:fn_start + 2400]

        self.assertIn("export function stripSuffix", src)
        self.assertIn("Suffix-aware fallback", snippet)
        self.assertIn("stripSuffix(key) !== wantedBase", snippet)

    def test_get_agent_report_unwraps_ticker_wrapped_agent_result_report(self):
        """Stock search stores final agentResult.report as { ticker: report }."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function getAgentReport")
        snippet = src[fn_start:fn_start + 2600]

        self.assertIn("pickTickerReport", src)
        self.assertIn("agentResult.report", snippet)
        self.assertNotIn("return agentResult.report as AgentReport", snippet)

    def test_pick_default_agent_skips_risk_manager_metrics_nodes(self):
        """risk_management_agent_codx01 has metrics dict reasoning, not a narrative report."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function pickDefaultAgent")
        snippet = src[fn_start:fn_start + 2400]

        self.assertIn("isNarrativeAgentKey", src)
        self.assertIn("risk_management", snippet)
        self.assertIn("isNarrativeAgentKey(key)", snippet)

    def test_list_other_agents_excludes_risk_manager_suffix_keys(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function listOtherAgents")
        snippet = src[fn_start:fn_start + 1800]

        self.assertIn("stripSuffix(key)", snippet)
        self.assertIn("!isNarrativeAgentKey(baseKey)", snippet)

if __name__ == "__main__":
    unittest.main()
