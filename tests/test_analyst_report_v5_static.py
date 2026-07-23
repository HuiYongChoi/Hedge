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
        self.assertIn("const primaryTickerLabel = companyName || displayTicker", header)
        self.assertIn("const secondaryTickerLabel = companyName ? ticker : null", header)
        self.assertIn("{' · '}{activeAgent.name}", header)

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
        sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")
        prefs = LANG_PREFS.read_text(encoding="utf-8")

        self.assertIn("extractTargetTiles(effectiveMetrics, displayAgentKey, language, effectiveCurrency)", layout)
        self.assertIn("formatMarginTarget", helpers)
        self.assertIn("SAFETY_MARGIN_PRICE_BUFFER = 0.25", helpers)
        self.assertIn("safetyMarginPrice", helpers)
        self.assertIn("formatSafetyMarginTarget", helpers)
        self.assertIn("impliedIntrinsicValue = current * (1 + margin)", helpers)
        self.assertIn("ORDERED_PRIMARY_TILE_KEYS", sidebar)
        self.assertIn("primaryTiles.map", sidebar)
        self.assertLess(
            sidebar.index("<ConsensusBridgeTile"),
            sidebar.index("primaryTiles.map"),
            "Safety margin must remain preserved after the broker/PBR/bridge overview",
        )
        self.assertLess(
            sidebar.index("primaryTiles.map"),
            sidebar.index('mode="afterPbr"'),
            "Safety margin must remain above the lower RIM and conservative valuation model cards",
        )
        self.assertNotIn("formatMarginTarget(value, metrics.intrinsicValue?.value", helpers)
        self.assertNotIn("formatCurrency(referencePrice, currency)", helpers)
        self.assertIn("finiteNumber(rawMarginOfSafety)", helpers)
        self.assertLess(helpers.index("finiteNumber(rawMarginOfSafety)"), helpers.index("safetyMarginPrice - current"))
        self.assertIn("targetMarginLabel: '안전가'", prefs)

    def test_header_does_not_mix_composite_and_agent_direction_badges(self):
        header = (V5_DIR / "report-header-ribbon.tsx").read_text(encoding="utf-8")

        self.assertIn("getScoreBand(compositeScore", header)
        self.assertNotIn("signalToVerdict(signal", header)
        self.assertNotIn("getSignalTone(signal", header)

    def test_conclusion_omits_signal_prefix_when_direction_conflicts(self):
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("inferDirectionalToneFromText", helpers)
        self.assertIn("hasDirectionalConflict", helpers)
        self.assertIn("report.signal && !hasDirectionalConflict", helpers)

    def test_sticky_verdict_uses_single_source_resolver(self):
        # 스티키 헤더 결론은 resolveHeadlineVerdict 단일 진실원천을 거쳐야 하며,
        # 표시 에이전트 신호가 종합점수 밴드와 충돌하면 밴드 라벨('비중 축소' 등)로 대체한다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        sticky = (V5_DIR / "sticky-analysis-header.tsx").read_text(encoding="utf-8")

        self.assertIn("export function resolveHeadlineVerdict", helpers)
        self.assertIn("band.tone !== 'neutral' && tone !== 'neutral' && band.tone !== tone", helpers)
        self.assertIn("resolveHeadlineVerdict(", layout)
        self.assertNotIn("function stickyVerdictFromSignal", layout)
        self.assertIn("verdictLabelOverride={headlineVerdict.label}", layout)
        self.assertIn("verdictLabelOverride?: string | null", sticky)
        self.assertIn("labelOverride || verdictLabel(verdict, language)", sticky)

    def test_evidence_tone_prefers_explicit_neutral_and_weighted_keywords(self):
        # '확신 매수로 가기엔 불리 → 관망' 문장이 '매수' 키워드만으로 강세로 새면 안 된다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("관망|중립|보류|neutral", helpers)
        self.assertLess(
            helpers.index("관망|중립|보류|neutral"),
            helpers.index("if (bear > bull) return 'bearish';"),
            "명시적 중립 판정이 방향 키워드 집계보다 먼저 와야 한다",
        )
        self.assertIn("if (bull > bear) return 'bullish';", helpers)

    def test_evidence_body_renders_markdown_bold_not_literal_asterisks(self):
        chip = (V5_DIR / "inline-data-chip.tsx").read_text(encoding="utf-8")

        self.assertIn("sentence.split(/\\*\\*([^*]+)\\*\\*/g)", chip)
        self.assertIn("<strong", chip)
        self.assertIn("segment.replace(/\\*\\*/g, '')", chip)

    def test_data_token_pattern_highlights_ratio_labels(self):
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("PER|PBR|PSR|ROE|ROIC|WACC|EPS|EV\\/EBITDA", helpers)

    def test_evidence_items_sorted_by_tone_with_conclusion_pinned(self):
        # 근거 카드는 강세→중립→약세 순으로 순차 보고하고, '결론' 카드는 항상 맨 앞.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        section = (V5_DIR / "report-section.tsx").read_text(encoding="utf-8")
        prefs = LANG_PREFS.read_text(encoding="utf-8")

        self.assertIn("sortEvidenceItemsByTone", helpers)
        self.assertIn("{ bullish: 0, neutral: 1, bearish: 2 }", helpers)
        self.assertIn(".trim().startsWith('결론') ? -1", helpers)
        self.assertIn("|| a.order - b.order", helpers)  # 같은 톤 안에서는 원문 순서 보존

        # 섹션 상단 톤 요약 스트립: 강세/중립/약세 카운트 + 우위 판정 한 줄
        self.assertIn("toneDominanceBull", section)
        self.assertIn("bullCount > bearCount", section)
        self.assertIn("items.length >= 2 && (", section)
        self.assertIn("toneDominanceBull: '강세 근거 우위'", prefs)
        self.assertIn("toneDominanceBear: '약세 근거 우위'", prefs)
        self.assertIn("toneDominanceBalanced: '강세·약세 균형'", prefs)

    def test_data_token_pattern_keeps_comma_grouped_numbers_whole(self):
        # "EPS 393,030.8"이 "[393]" + ",030.8"로 쪼개지면 안 되고,
        # 문장 구두점 콤마("41.1, ")에서 "41"로 백트래킹되어도 안 된다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("(?:,\\d{3})*(?:\\.\\d+)?(?![%배xXBMK\\d]|,\\d)", helpers)

    def test_citations_deep_link_to_ticker_specific_pages(self):
        # 출처 링크는 대표 홈이 아니라 종목별/데이터별 정확한 페이지로 — 실검증된 URL 패턴.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        search = (ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx").read_text(encoding="utf-8")

        # DART: autoSearch=true + option=corp 없이는 자동 검색이 실행되지 않는다
        self.assertIn("dsab001/main.do?autoSearch=true&option=corp&textCrpNm=", helpers)
        self.assertIn("dsab001/main.do?autoSearch=true&option=corp&textCrpNm=", search)
        # KR 컨센서스: 실제 데이터 소스(FnGuide)의 해당 종목 페이지
        self.assertIn("comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A", helpers)
        # Damodaran: 홈이 아니라 업종별 WACC 데이터 표
        self.assertIn("New_Home_Page/datafile/wacc.htm", helpers)
        self.assertNotIn("href: 'https://pages.stern.nyu.edu/~adamodar/',", helpers)

    def test_sections_dedupe_repeated_sentences_across_toc(self):
        # 목차 간 동일 문장 반복(실측 26%)을 렌더에서 제거 — 첫 목차에만 남긴다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        body = (V5_DIR / "report-body.tsx").read_text(encoding="utf-8")

        self.assertIn("export function dedupeSentencesAcrossSections", helpers)
        self.assertIn("key.length >= 30", helpers)
        # 지문은 마커/헤딩 프리픽스를 벗겨 계산(같은 본문이 다른 헤딩을 달고 반복되는 패턴)
        self.assertIn("[^:：.!?。]{0,40}[:：]", helpers)
        self.assertIn("dedupeSentencesAcrossSections(", body)
        self.assertIn("dedupedSectionTexts[sectionIndex]", body)

    def test_key_number_labels_cover_more_metrics(self):
        # "값 N" 최소화: 분기 태그 EPS(2025Q4 EPS)는 분기명 라벨, 그리고 DATA_TOKEN이
        # 값을 뽑는 컨텍스트(PBR/PSR/ROE/EV·EBITDA/EPS/PER)에 제네릭 실라벨을 붙인다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        # 분기 EPS 특례 + 매칭 끝 위치(가장 가까운) 기반 선택
        self.assertIn("EPS\\s*$/i", helpers)
        self.assertIn("const end = m.index + m[0].length", helpers)
        # 제네릭 라벨 후보(구체 라벨 뒤에 배치)
        self.assertIn("ko: 'PBR', en: 'PBR'", helpers)
        self.assertIn("ko: 'ROE', en: 'ROE'", helpers)
        self.assertIn("ko: 'EV/EBITDA', en: 'EV/EBITDA'", helpers)
        self.assertIn("ko: 'EPS', en: 'EPS'", helpers)
        self.assertIn("ko: 'PER', en: 'P/E'", helpers)

    def test_sec_citation_uses_ticker_capable_endpoint(self):
        # SEC edgar/browse/?CIK=는 숫자 CIK 전용 → 티커로는 Not Found(스크린샷 실증).
        # cgi-bin browse-edgar가 티커를 해석해 10-K 목록으로 직결(200 실검증).
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(normalized)}&type=10-K", helpers)
        self.assertNotIn("edgar/browse/?CIK=", helpers)

    def test_sector_citation_has_market_specific_link(self):
        # '출처 링크 미연결: 섹터 리포트' 해소 — 시장별 섹터 페이지로 연결(전부 200 실검증).
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("SVD_UJRank.asp?pGB=1&gicode=A", helpers)
        self.assertIn("stockanalysis.com/stocks/", helpers)
        self.assertNotIn("typeEn: 'Sector',\n      href: null", helpers)

    def test_sentence_split_keeps_abbreviations_together(self):
        # 문장 중복 제거기가 "Alphabet Inc."의 마침표에서 문장을 잘라
        # "저는 Alphabet Inc.2.3" 고아 파편을 만들던 문제 — 약어 가드 공용 정규식 사용.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("const SENTENCE_MATCH_RE", helpers)
        self.assertEqual(helpers.count("SENTENCE_MATCH_RE"), 3)  # 정의 + 두 분리기
        self.assertIn("Inc|Corp|Co|Ltd|LLC|plc|PLC|vs|Mr|Ms|Dr|Jr|Sr|St|No|etc", helpers)

    def test_leading_decimal_not_stripped_as_enumerator(self):
        # "2.0%/d"의 선두 "2."를 목록 번호로 오인해 지워 "0%/d"가 되던 문제 —
        # 모든 선두 번호 제거에 (?!\d) 소수점 가드.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")
        self.assertIn("\\d+\\.(?!\\d)\\s*|\\d+\\)\\s*", helpers)
        self.assertIn("\\d+\\.(?!\\d)\\s*|\\d+\\)\\s*", evidence)
        # 내용을 지우는 선두 스트립에 가드 없는 \d+[.)] 가 남아 있으면 안 된다
        self.assertNotIn("|[-*•]\\s+|\\d+[.)]\\s*)/u, '')", helpers)
        self.assertNotIn("|[-*•]\\s+|\\d+[.)]\\s*|\\[[+\\-~?]\\]\\s*)/u, '')", evidence)

    def test_abbreviation_period_not_sentence_boundary(self):
        # "Alphabet Inc.의 …"가 'Inc'에서 잘려 제목이 회사명 조각만 되던 문제 —
        # 약어(Inc/Corp/U.S 등) 뒤 마침표는 제목 경계가 아니다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("Inc|Corp|Co|Ltd|LLC|plc|PLC|vs", helpers)

    def test_long_first_sentence_gets_clause_heading(self):
        # 90자 초과 첫 문장 카드는 제목이 통째로 사라지지 않고 절 경계(쉼표)에서
        # 볼드 제목을 확보한다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("function splitLeadClauseHeading(", helpers)
        self.assertIn(".lastIndexOf(',')", helpers)

    def test_numeric_unit_fragment_filtered(self):
        # "2.0%/d."·"0%/d." 같은 숫자+단위 조각과 "[?" 깨진 마커 조각은 본문/카드로
        # 렌더하지 않는다(값은 핵심 숫자 스트립이 담당).
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")
        for src in (helpers, evidence):
            self.assertIn("(?:\\/[a-zA-Z]+)?\\.?$", src)

    def test_after_noun_metric_label(self):
        # "높은 프리미엄과 2.0%/d 변동성"의 2.0%는 프리미엄이 아니라 변동성 —
        # 숫자 바로 뒤 지표 명사가 앞쪽 명사보다 우선한다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("const METRIC_NOUN_TAIL", helpers)
        self.assertIn("const afterNoun = after.match(", helpers)

    def test_verdict_heading_allows_leading_marker(self):
        # "[~] →보유·중립 (신뢰도 58%) · …"처럼 마커 뒤 판정도 볼드 제목으로 추출.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("(?:\\[[+\\-~?]\\]\\s*)?[→↑↓]?", helpers)

    def test_fwd_per_tiles_label_price_basis(self):
        # 사이드바의 두 FwdPER(현재가 기준 vs 목표가 내재)는 같은 12M 선행 EPS를 쓰지만
        # 분자가 달라 값이 다르다 → 화면에 기준+기간을 표기해 혼동을 없앤다.
        prefs = LANG_PREFS.read_text(encoding="utf-8")
        self.assertIn("fwdPerCurrentLabel: '현재가 기준 12M 선행 PER'", prefs)
        self.assertIn("fwdPerTargetLabel: '목표가 기준 12M 선행 PER'", prefs)
        self.assertIn("fwdPerCurrentLabel: '12M fwd P/E · current price'", prefs)
        self.assertIn("fwdPerTargetLabel: '12M fwd P/E · target-implied'", prefs)
        sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")
        self.assertIn("t('fwdPerCurrentLabel', language)", sidebar)
        self.assertIn("t('fwdPerTargetLabel', language)", sidebar)
        # 기준 없는 맨 'FwdPER ...' 표기는 남지 않아야 한다
        self.assertNotIn("FwdPER {forwardPerText}", sidebar)
        self.assertNotIn("FwdPER {perText(impliedFwdPer)}", sidebar)

    def test_unlabeled_numbers_use_context_or_are_omitted(self):
        # 일반 해결책: 고정 지표명에 안 걸리는 서술형 숫자는 (1) 문맥 서술어/명사로 이름을
        # 유도하고("62.5% 상승"→상승, "변동성 4.9%"→변동성), (2) 그래도 못 정하면
        # 의미 없는 "값 N" 대신 강조 스트립에서 생략한다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("function describeNumberFromContext(", helpers)
        # 문맥 없으면 '값 N'을 밀어넣지 않고 건너뛴다
        self.assertIn("if (!label) continue;", helpers)
        self.assertNotIn("`값 ${results.length + 1}`", helpers)
        # 단위 정합성: % 값에 원화 절대금액(EPS 등) 라벨 차단
        self.assertIn("if (isPercent && wonAmount) label = null;", helpers)

    def test_per_gap_comparison_deduped_to_most_detailed(self):
        # 선행/TTM PER 격차 비교가 여러 섹션에 반복 서술되면 가장 상세한(긴) 블록
        # 하나만 남기고 나머지 제거. 요약(섹션 01)은 보존.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        body = (V5_DIR / "report-body.tsx").read_text(encoding="utf-8")
        self.assertIn("export function dedupePerGapComparisons(", helpers)
        self.assertIn("c.len > a.len ? c : a", helpers)  # 가장 상세한(긴) 것 선택
        self.assertIn("if (s === 0) return", helpers)      # 섹션 01 보존
        # report-body가 실제로 이 패스를 적용
        self.assertIn("dedupePerGapComparisons(dedupeSentencesAcrossSections(", body)

    def test_heading_boundary_excludes_comparative_boda(self):
        # 비교격 조사 '보다'의 '다'를 문장 종결로 오인해 제목이 "…39.5보다"에서
        # 잘리던 문제 방지: 종결 판정에서 '…보다'를 제외.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("if (/보다$/u.test(word)) continue", helpers)

    def test_malformed_bold_does_not_split_sentence(self):
        # 잘못 닫힌 강조(**)가 문장 중간을 끊어 제목이 "…(Confidence" 파편이 되던
        # 문제 방지: 괄호 불균형·소문자 라틴 연속·조사 시작을 감지해 이어 붙임.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("function looksLikeMidSentenceBoldSplit(", helpers)
        self.assertIn("if (opens > closes) return true", helpers)
        self.assertIn("if (!looksLikeMidSentenceBoldSplit(boldHeading, boldBody))", helpers)

    def test_conclusion_verdict_becomes_bold_heading(self):
        # 결론 카드: "→보유·중립 (신뢰도 52%) · 본문…"에서 판정을 볼드 제목으로 승격.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("보유(?:\\s*·\\s*중립)?|중립|관망|비중\\s*축소", helpers)
        self.assertIn("const verdict = normalizedItemText.match(", helpers)

    def test_key_numbers_labeled_and_deduped(self):
        # 핵심 숫자: '값 N' 대신 신뢰도/선행 PER/TTM PER 실라벨 + 같은 숫자 중복 제거 +
        # 숫자에 가장 가까운 지표명을 고른다.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("ko: '신뢰도', en: 'Confidence'", helpers)
        self.assertIn("ko: '선행 PER', en: 'Fwd P/E'", helpers)
        self.assertIn("ko: 'TTM PER', en: 'TTM P/E'", helpers)
        self.assertIn("const usedValues = new Set<string>()", helpers)
        self.assertIn("if (usedValues.has(valueKey)) continue", helpers)
        # 숫자에 가장 가까운(=매칭 끝 위치가 가장 큰) 지표명 선택
        self.assertIn("const end = m.index + m[0].length", helpers)
        self.assertIn("if (end > bestPos)", helpers)

    def test_marker_card_heading_does_not_duplicate_body(self):
        # 마커 근거 카드: 첫 문장을 제목으로 올리고 본문에서 제거 → 제목=본문 중복 방지,
        # 단문은 제목만(본문 빈 카드는 제목이 실질이면 유지), 다문장은 볼드 제목+일반 본문.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

        self.assertIn("function splitLeadSentenceHeading", helpers)
        self.assertIn("return splitLeadSentenceHeading(bodyText)", helpers)
        self.assertNotIn("function deriveMarkerHeading", helpers)
        self.assertNotIn("heading: deriveMarkerHeading(bodyText), body: bodyText", helpers)
        # 단문일 때 본문을 비운다(중복 방지)
        self.assertIn("if (only.length <= 90) return { heading: only, body: '' };", helpers)
        # 본문이 비어도 제목이 실질 내용이면 카드 유지
        self.assertIn("return bodyBlank && headingBlank", helpers)

    def test_hyphen_bullet_before_marker_leaves_no_orphan_dash_cards(self):
        # "- [+] …" 하이픈 불릿 뒤 마커에서 하이픈이 고아 블록("-")으로 남아
        # 본문이 빈 카드(6,7,9~11번)가 생기던 회귀 방지.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")

        self.assertIn("(?:\\s+[-*•])?\\s+(?=(?:\\d+[.)]\\s+)?\\[[+\\-~]\\])", helpers)
        self.assertIn("(?:\\s+[-*•])?\\s+(?=(?:\\d+[.)]\\s+)?\\[[+\\-~]\\])", evidence)
        # 불릿 기호만 남은 블록은 카드로 렌더하지 않는다
        self.assertIn("^[.)[\\]+~?\\-–—·•]+$", helpers)
        self.assertIn("^[.)[\\]+~?\\-–—·•]+$", evidence)
        # 콜론 없는 ### 헤딩도 본문과 병합 (제목만 있는 빈 카드 방지)
        self.assertIn("[:：]?\\s*$/u.test(clean)", helpers)

    def test_trailing_orphan_enumerator_stripped(self):
        # 완결 문장 뒤에 매달린 목록 번호 조각(" 2.")은 다음 항목 enumerator 누출이므로
        # 제거한다. 종결부호 뒤 1~2자리 숫자만 잡아 실제 수치("100.")는 보존.
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")
        self.assertIn("(?<=[.!?。？！])\\s+\\d{1,2}[.)]\\s*$", evidence)

    def test_sentence_terminated_short_block_is_not_heading_only(self):
        # "따라서 중립."처럼 종결부호로 끝나는 짧은 문장은 라벨이 아니라 본문 문장이므로
        # heading-only로 필터링해 fallback이 원본을 노출하지 않게 한다.
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")
        self.assertIn("\\s*$/u.test(block.trim())) return false;", evidence)

    def test_question_marker_items_stay_attached_to_parent(self):
        # [?](검증 조건)는 별도 카드로 쪼개지 않는다 — 20번 "아래 중 하나가 확인돼야"
        # 뒤의 조건 목록이 유실되던 문제의 회귀 방지.
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        evidence = (V5_DIR / "evidence-item.tsx").read_text(encoding="utf-8")

        self.assertIn("(?:\\d+[.)]\\s+)?\\[[+\\-~]\\])/gu", helpers)  # prepare: [?] 제외
        self.assertNotIn("(?:\\d+[.)]\\s+)?\\[[+\\-~?]\\])/gu", helpers)
        self.assertIn("\\[\\?\\]\\s*/gu, ' · '", evidence)  # 본문 내 [?]는 · 목록으로

    def test_mixed_signal_items_are_demoted_to_neutral(self):
        # 강세·약세 근거가 둘 다 짙은 항목은 [-] 마커가 있어도 중립으로 강등 (19번 오판 방지)
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("const isMixed = bull >= 2 && bear >= 2", helpers)
        self.assertIn("isMixed ? 'neutral' : 'bearish'", helpers)
        self.assertIn("isMixed ? 'neutral' : 'bullish'", helpers)
        self.assertIn("dedupeRepeatedSentences", helpers)

    def test_inline_number_emphasis_is_subtle_not_boxed(self):
        # 본문 숫자 강조는 박스 칩이 아니라 은은한 인라인(mono+색)이어야 한다.
        chip = (V5_DIR / "inline-data-chip.tsx").read_text(encoding="utf-8")
        self.assertIn("tabular-nums", chip)
        self.assertNotIn("rounded-md border px-1.5", chip)

    def test_key_number_labels_only_from_preceding_text(self):
        # 핵심 숫자 라벨은 숫자 바로 앞 근접 텍스트에서만 추정 (오표기 방지)
        helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
        self.assertIn("itemText.slice(Math.max(0, index - 28), index)", helpers)
        # 숫자에 가장 가까운(=before 끝에 근접한) 지표명을 고른다 (배열 first-match 아님)
        self.assertIn("const m = before.match(c.pattern)", helpers)
        # 기간 표기(3M/6M/12M)는 핵심 숫자에서 제외, 컨센서스 EPS 라벨은 '선행 EPS'
        self.assertIn("(?:3|6|12)\\s?M$", helpers)
        self.assertIn("ko: '선행 EPS'", helpers)
        self.assertNotIn("ko: '다음분기 EPS'", helpers)
        # 중복 문장 감지는 소수점(6.2)·약어(Inc. 등)를 문장 경계로 보지 않는다
        # (SENTENCE_MATCH_RE 공용 정규식 — 소수점 가드 + 약어 가드)
        self.assertIn("|(?<=\\d)\\.(?=\\d)|", helpers)

    def test_sticky_header_labels_margin_percent_as_margin_not_price(self):
        # 안전가(=가격) 라벨을 퍼센트 값에 붙이면 안 된다. 스티키 헤더의 안전마진 %는
        # 가격 타일(targetMarginLabel='안전가')과 구분되는 안전마진 라벨을 써야 한다.
        sticky = (V5_DIR / "sticky-analysis-header.tsx").read_text(encoding="utf-8")
        prefs = LANG_PREFS.read_text(encoding="utf-8")

        self.assertIn("t('targetMarginPctLabel', language)", sticky)
        self.assertNotIn("t('targetMarginLabel', language)", sticky)
        self.assertIn("targetMarginPctLabel: '안전마진'", prefs)
        self.assertIn("targetMarginPctLabel: 'Margin of safety'", prefs)

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
        self.assertIn('mode="pbrOnly"', sidebar)
        self.assertIn('mode="afterPbr"', sidebar)
        self.assertLess(
            sidebar.index('mode="pbrOnly"'),
            sidebar.index("primaryTiles.map"),
            "PBR band card must appear in the upper valuation overview before the primary tiles",
        )
        self.assertLess(
            sidebar.index("primaryTiles.map"),
            sidebar.index('mode="afterPbr"'),
            "RIM and remaining valuation cards must stay below the primary tiles",
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
