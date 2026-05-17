from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"
DASHBOARD = ROOT / "app/frontend/src/components/reports/analyst-report-dashboard.tsx"
LANG_PREFS = ROOT / "app/frontend/src/lib/language-preferences.ts"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
SENTIMENT_DASHBOARD = ROOT / "app/frontend/src/components/reports/report-sentiment-dashboard.tsx"


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

        self.assertIn("extractTargetTiles(effectiveMetrics, displayAgentKey, language, effectiveCurrency)", layout)
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

    def test_rim_pbr_deep_dive_is_sidebar_only_and_does_not_drive_body_sections(self):
        src = (V5_DIR / "report-section.tsx").read_text(encoding="utf-8")
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        types = (V5_DIR / "types.ts").read_text(encoding="utf-8")
        sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")

        self.assertFalse((V5_DIR / "valuation-panel").exists(), "Do not restore the old body-level valuation panel")
        self.assertIn("ValuationDeepDive", types)
        self.assertIn("RimBreakdown", types)
        self.assertIn("PbrBand", types)
        self.assertIn("buildValuationDeepDive", helpers)
        self.assertIn("rim_analysis", helpers)
        self.assertIn("pbr_band_analysis", helpers)
        self.assertIn("valuationDeepDive", layout)
        self.assertIn("valuationDeepDive={valuationDeepDive}", layout)
        self.assertIn("ValuationSidebarPanel", sidebar)
        self.assertIn("valuationDeepDive", sidebar)
        self.assertGreaterEqual(
            sidebar.count("<ValuationSidebarPanel"),
            2,
            "PBR/RIM evidence must render even when primary target tiles are absent",
        )
        self.assertIn("primaryTiles", sidebar)
        self.assertIn("secondaryTiles", sidebar)
        self.assertLess(
            sidebar.index("dive.pbr"),
            sidebar.index("dive.rim"),
            "PBR band card must appear above the RIM card under safety margin",
        )
        self.assertNotIn("ValuationDeepDivePanel", src)
        self.assertNotIn("valuation-panel", src)

    def test_forward_per_narrative_is_sanitized_against_price_compass_snapshot(self):
        body = (V5_DIR / "report-body.tsx").read_text(encoding="utf-8")
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        price_compass = (V5_DIR / "price-compass-panel/index.tsx").read_text(encoding="utf-8")
        target_tiles = helpers[helpers.index("export function extractTargetTiles"):helpers.index("function buildSafetyMarginPrice")]
        i18n = LANG_PREFS.read_text(encoding="utf-8")

        self.assertIn("sanitizeForwardPeNarrative", helpers)
        self.assertIn("canonicalForwardSnapshot", layout)
        self.assertIn("canonicalForwardSnapshot={canonicalForwardSnapshot}", layout)
        self.assertIn("canonicalForwardSnapshot", body)
        self.assertIn("sanitizeForwardPeNarrative", body)
        self.assertIn(r"\(?", helpers, "FwdPER sanitizer must handle parenthesized values like FwdPER(36.05x)")
        self.assertIn("(?:은|는|이|가|을|를)", helpers)
        self.assertIn("향후 EPS와 영업이익 개선", helpers)
        self.assertIn("더\\s*)?(?:비싸|비싼|고평가|높|상승)", helpers)
        self.assertNotIn("Price Compass 기준 FwdPER", helpers)
        self.assertNotIn("(Price Compass 기준)", helpers)
        self.assertNotIn("canonical FwdPER", helpers)
        self.assertNotIn("targetForwardPeLabel", target_tiles)
        self.assertNotIn("targetForwardPeSubtitle", target_tiles)
        self.assertNotIn("metric: metrics.forwardPe, tone: 'neutral', formatter: formatMultiple", target_tiles)
        self.assertNotIn("metric: metrics.forwardPeFy0 || metrics.forwardPe", target_tiles)
        self.assertLess(
            price_compass.index("target?.forward_eps"),
            price_compass.index("metrics.forwardEpsFy0"),
            "Price Compass FwdEPS must prefer live next-year EPS over current-FY EPS",
        )
        self.assertLess(
            price_compass.index("target?.forward_pe"),
            price_compass.index("metrics.forwardPe"),
            "Price Compass FwdPER must prefer live analyst-target forward_pe",
        )

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

    def test_pick_default_agent_skips_empty_valuation_report(self):
        """valuation_analyst can complete with an empty report while persona agents have the body."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function pickDefaultAgent")
        snippet = src[fn_start:fn_start + 3200]

        self.assertIn("hasRenderableAgentReport", src)
        self.assertIn("findFirstRenderableAgentKey", src)
        self.assertIn("hasRenderableAgentReport", snippet)
        self.assertNotIn("const scopedValuation = completeForTicker.find", snippet)
        self.assertNotIn("if (scopedValuation) return scopedValuation[0]", snippet)

    def test_report_layout_uses_renderable_report_fallback(self):
        """If the active agent is empty, ReportBody must render the first non-empty narrative report."""
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")

        self.assertIn("findFirstRenderableAgentKey", layout)
        self.assertIn("displayAgentKey", layout)
        self.assertIn("displayReport", layout)
        self.assertIn("activeReport={displayReport}", layout)
        self.assertIn("activeAgentKey={displayAgentKey}", layout)
        self.assertIn("report={displayReport}", layout)
        self.assertIn("setActiveAgentKey(displayAgentKey)", layout)

    def test_report_body_falls_back_to_reasoning_text_per_empty_section(self):
        """No section should render the empty-data placeholder while the report has reasoning text."""
        body = (V5_DIR / "report-body.tsx").read_text(encoding="utf-8")

        self.assertIn("extractReasoningText", body)
        self.assertIn("fallbackSectionText", body)
        self.assertIn("sectionText(normalizedReport, section.id) || fallbackSectionText", body)

    def test_list_other_agents_excludes_risk_manager_suffix_keys(self):
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function listOtherAgents")
        snippet = src[fn_start:fn_start + 1800]

        self.assertIn("stripSuffix(key)", snippet)
        self.assertIn("!isNarrativeAgentKey(baseKey)", snippet)

    def test_extract_key_numbers_label_guard(self):
        """배 단위 값에 절대량 라벨이 붙지 않아야 한다.
        Price-to-Earnings 의 'Price' 가 '현재가' 패턴에 광범위하게 매치되던 버그 재발 방지."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        # (A) '현재가' 패턴이 더 이상 \bprice\b 단독을 잡지 않는다
        self.assertIn("share\\s*price", src)
        self.assertIn("stock\\s*price", src)
        self.assertIn("market\\s*price", src)
        # 이전의 광범위 'price' 단독 매치는 제거되어야 함
        self.assertNotIn("/현재가|current price|price/i", src)

        # (B) 단위 가드 헬퍼와 가드 분기가 존재한다
        self.assertIn("MULTIPLE_VALUE_PATTERN", src)
        self.assertIn("isMultipleValue", src)
        self.assertIn("isAbsoluteAmountLabel", src)
        self.assertIn("PRICE_LABEL_KO", src)
        self.assertIn("PRICE_LABEL_EN", src)

        # (C) 라벨 후보 순서: 트레일링 P/E 가 '현재가' 보다 위에 있어야 함
        forward_idx = src.find("ko: '포워드 P/E'")
        trailing_idx = src.find("ko: '트레일링 P/E'")
        current_price_idx = src.find("ko: '현재가'")
        self.assertGreater(forward_idx, 0)
        self.assertGreater(trailing_idx, 0)
        self.assertGreater(current_price_idx, 0)
        self.assertLess(forward_idx, current_price_idx,
                        "포워드 P/E 라벨은 현재가 라벨보다 앞 순서에 있어야 한다")
        self.assertLess(trailing_idx, current_price_idx,
                        "트레일링 P/E 라벨은 현재가 라벨보다 앞 순서에 있어야 한다")

    def test_sentiment_dashboard_has_toggle(self):
        """ReportSentimentDashboard cards must have expand/collapse toggle.
        Each tone card limits items to maxItemsPerTone with line-clamp-2 by default;
        a button must let users see all items in full text."""
        src = SENTIMENT_DASHBOARD.read_text(encoding="utf-8")
        self.assertIn("useState", src)
        self.assertIn("expandedTones", src)
        self.assertIn("toggleTone", src)
        self.assertIn("자세히 보기", src)
        self.assertIn("접기", src)
        # conditional line-clamp: only applied when !isExpanded
        self.assertIn("!isExpanded", src)
        self.assertIn("line-clamp-2", src)

    def test_sanitizer_strips_developer_tokens(self):
        """Sanitizer must never inject 'Price Compass 기준' itself, and must
        strip developer tokens like 'canonical FwdPER', 'canonical_multiples',
        'forward_outlook' from analyst-facing narrative."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        fn_start = src.index("export function sanitizeForwardPeNarrative")
        snippet = src[fn_start:fn_start + 4500]

        # (Self-contamination) sanitizer must no longer insert these strings
        self.assertNotIn("Price Compass 기준 FwdPER", snippet)
        self.assertNotIn("Price Compass baseline FwdPER", snippet)
        self.assertNotIn("(Price Compass 기준).", snippet)
        self.assertNotIn("(Price Compass baseline).", snippet)

        # (Token stripping) developer tokens must have replacement patterns
        self.assertIn("DEVELOPER_TOKEN_PATTERNS", src)
        self.assertIn("canonical\\s*FwdPER", src)
        self.assertIn("canonical_multiples", src)
        self.assertIn("forward_outlook", src)
        self.assertIn("price\\s*compass", src)

    def test_sanitizer_collapses_raw_vs_block(self):
        """`( 36.05x vs 30.06x )` style blocks must be collapsed to the
        snapshot-derived single multiple."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("RAW_PE_VS_BLOCK_PATTERN", src)
        # the new replacement uses 선행 PER / forward P/E rather than raw vs
        self.assertIn("선행 PER ${fwd}", src)
        self.assertIn("forward P/E ${fwd}", src)

    def test_sanitizer_corrects_false_expensive_tone(self):
        """When fwdPer < ttmPer, '더 비싸진' tone must be stripped in KO."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("FALSE_EXPENSIVE_TONE_KO", src)
        # Replacement strips the false-expensive clause entirely (empty string)
        self.assertIn("FALSE_EXPENSIVE_TONE_KO, ''", src)

    def test_label_candidates_ratio_guard(self):
        """Ratio-percent labels (ROIC, 안전마진, etc.) must be rejected when
        value is a multiple (배/x/X). Prevents '값 1 36.05x  ROIC 30.06x'."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("RATIO_PERCENT_LABEL_KO", src)
        self.assertIn("RATIO_PERCENT_LABEL_EN", src)
        self.assertIn("isRatioPercentLabel", src)
        # Guard must check both PRICE and RATIO sets in extractKeyNumbers
        self.assertIn("isRatioPercentLabel(label)", src)

    def test_eps_label_is_forward_12m_not_next_quarter(self):
        """targetEpsLabel must say '선행 12M' / '12M forward', not '다음 분기' /
        'next-quarter' — the underlying value is a 12-month forward / annual
        consensus EPS, not a single-quarter number."""
        src = LANG_PREFS.read_text(encoding="utf-8")
        self.assertIn("선행 12M 컨센 EPS", src)
        self.assertIn("12M forward consensus EPS", src)
        self.assertIn("12개월 선행 추정", src)
        self.assertIn("Forward 12-month estimate", src)
        # The misleading labels must be gone
        self.assertNotIn("다음 분기 컨센 EPS", src)
        self.assertNotIn("Next-quarter consensus EPS", src)
        self.assertNotIn("'전망이익의 크기'", src)
        self.assertNotIn("'Forward earnings scale'", src)
        self.assertNotIn("'Next-Q Consensus EPS'", src)
        self.assertNotIn("'Forward earnings size'", src)

    def test_sanitizer_strips_orphan_canonical_word(self):
        """After FwdPER → 선행 PER replacement, standalone 'canonical' word
        must still be stripped (it lost its FwdPER suffix)."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        # Lookahead pattern that strips 'canonical' before Korean PER/EPS phrases
        self.assertIn("canonical\\s+(?=(?:선행|포워드|컨센|forward|fwd|per|p\\/?e|eps|standard|multiple|consensus|baseline|estimate|FwdPER))", src)

    def test_sanitizer_price_compass_pattern_preserves_trailing_space(self):
        """The price\\s*compass replacement must not greedily consume the trailing
        whitespace when neither 'baseline' nor 'standard' follows — otherwise
        '기준선행' (no space) appears."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        # The trailing \\s* must be INSIDE the optional baseline|standard group, not outside
        self.assertIn("price\\s*compass(?:\\s*기준)?(?:\\s*(?:baseline|standard))?", src)
        # The old greedy form must be gone
        self.assertNotIn("price\\s*compass(?:\\s*기준)?\\s*(?:baseline|standard)?", src)

    def test_sanitizer_catches_inverted_expensive_tone(self):
        """'비싸진 상태라서' (verb-before-noun) must also be stripped, not only
        '상태라서 비싸' (noun-before-verb)."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("FALSE_EXPENSIVE_INVERTED_KO", src)
        # The inverted pattern must reference '비싸진?' and '상태'
        self.assertIn("비싸진?", src)
        # Both passes must run (inverted + original) when fwdPer < ttmPer
        self.assertIn("FALSE_EXPENSIVE_INVERTED_KO,", src)
        self.assertIn("FALSE_EXPENSIVE_TONE_KO,", src)

    def test_sanitizer_pass6_inserts_missing_korean_spaces(self):
        """Pass 6 must insert a space between certain Korean tokens
        (기준/배수/전망/추정/라서/etc.) and a following PER/EPS phrase."""
        src = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("(기준|배수|전망|메모|추정|스플라이스|변동률|라서|이라서|이며)", src)
        self.assertIn("(?=(?:선행|포워드|컨센|FwdPER|forward|fwd|TTM|trailing|P\\/?E|PER))", src)


if __name__ == "__main__":
    unittest.main()
