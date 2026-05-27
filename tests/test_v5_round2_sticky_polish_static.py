from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"
LANGUAGE_PREFS = ROOT / "app/frontend/src/lib/language-preferences.ts"
CONTEXTS_DIR = ROOT / "app/frontend/src/contexts"
TABS_DIR = ROOT / "app/frontend/src/components/tabs"
VALUATION_AGENT = ROOT / "src/agents/valuation.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_sticky_analysis_header_component_exists_and_uses_core_metrics():
    src = read(V5_DIR / "sticky-analysis-header.tsx")

    assert "export function StickyAnalysisHeader" in src
    assert "sticky top-0" in src
    assert "targetMarginLabel" in src
    assert "targetWaccLabel" in src
    assert "stickyConfidenceLabel" in src
    assert "formatCurrency" in src
    assert "formatPercent" in src


def test_report_layout_mounts_sticky_header_before_existing_report_sections():
    src = read(V5_DIR / "report-layout.tsx")

    assert "import { StickyAnalysisHeader } from './sticky-analysis-header';" in src
    assert "<StickyAnalysisHeader" in src
    assert src.index("<StickyAnalysisHeader") < src.index("<TickerSwitcher")
    assert "isJapaneseTicker" in src


def test_sticky_header_i18n_keys_exist_in_ko_and_en():
    src = read(LANGUAGE_PREFS)

    assert "stickyConfidenceLabel: '신뢰도'" in src
    assert "stickyConfidenceLabel: 'Confidence'" in src
    assert "stickyPriceUnavailable: '현재가 없음'" in src
    assert "stickyPriceUnavailable: 'No price'" in src


def test_active_ticker_context_is_registered_and_used_by_stock_and_sandbox_tabs():
    context_src = read(CONTEXTS_DIR / "active-ticker-context.tsx")
    main_src = read(ROOT / "app/frontend/src/main.tsx")
    stock_src = read(TABS_DIR / "stock-search-tab.tsx")
    sandbox_src = read(TABS_DIR / "data-sandbox-tab.tsx")

    assert "ActiveTickerProvider" in context_src
    assert "useActiveTicker" in context_src
    assert "<ActiveTickerProvider>" in main_src
    assert "useActiveTicker" in stock_src
    assert "setActiveTicker" in stock_src
    assert "useActiveTicker" in sandbox_src
    assert "hasHydratedActiveTickerRef" in sandbox_src


def test_stock_search_redundant_top_status_box_is_not_rendered():
    src = read(TABS_DIR / "stock-search-tab.tsx")

    assert "활성 종목" not in src
    assert "Sandbox 미사용" not in src
    assert "샌드박스 미사용" not in src


def test_valuation_reasoning_requires_concrete_numbers_in_evidence_details():
    src = read(VALUATION_AGENT)

    assert "CONCRETE_CONCLUSION_GUIDANCE" in src
    assert "at least one concrete number" in src
    assert "def _ensure_numeric_evidence_details" in src
    assert "_ensure_numeric_evidence_details(" in src
    assert "enhanced_details," in src


def test_broker_consensus_tile_is_added_after_secondary_tiles_without_primary_tile_changes():
    sidebar = read(V5_DIR / "target-data-sidebar.tsx")
    layout = read(V5_DIR / "report-layout.tsx")

    assert "function BrokerConsensusTile" in sidebar
    assert "brokerConsensus" in sidebar
    assert "brokerConsensusLabel" in sidebar
    assert "brokerConsensusTip" in sidebar
    assert "secondaryTiles.map" in sidebar
    assert sidebar.index("secondaryTiles.map") < sidebar.index("<BrokerConsensusTile")
    assert "ORDERED_PRIMARY_TILE_KEYS = ['targetIntrinsicLabel', 'targetMarginLabel']" in sidebar

    assert "brokerConsensus={" in layout
    assert "liveTarget?.consensus" in layout
    assert "canonicalForwardSnapshot.fwdEps" in layout


def test_broker_consensus_i18n_keys_exist_in_ko_and_en():
    src = read(LANGUAGE_PREFS)

    assert "brokerConsensusLabel: '증권사 평균 목표가'" in src
    assert "brokerConsensusLabel: 'Broker Consensus'" in src
    assert "brokerConsensusTip:" in src


def test_consensus_bridge_tile_reconciles_broker_targets_with_pbr_band():
    sidebar = read(V5_DIR / "target-data-sidebar.tsx")
    language = read(LANGUAGE_PREFS)

    assert "function ConsensusBridgeTile" in sidebar
    assert "consensusBridgeLabel" in sidebar
    assert "impliedPbr" in sidebar
    assert "const pbrBasis = derivePbrBps(pbr)" in sidebar
    assert "consensus / pbrBasis" in sidebar
    assert "fairPriceP50" in sidebar
    assert "fairPriceP90" in sidebar
    assert sidebar.index("<BrokerConsensusTile") < sidebar.index("<ConsensusBridgeTile")

    assert "consensusBridgeLabel: '목표가 검산'" in language
    assert "consensusBridgeLabel: 'Target Bridge'" in language
    assert "consensusBridgeTip:" in language


def test_pbr_band_card_uses_defensive_price_identity_and_reader_labels():
    sidebar = read(V5_DIR / "target-data-sidebar.tsx")

    assert "function derivePbrFairPrice" in sidebar
    assert "function derivePbrBps" in sidebar
    assert "pbr.currentPrice / pbr.currentPbr" in sidebar
    assert "pbrFairP90" in sidebar
    assert "50% 기준 주가" in sidebar
    assert "현재 PBR" in sidebar
    assert "상단 시나리오" in sidebar
    assert "50% price" in sidebar
    assert "formatPbrMultiple" in sidebar


def test_pbr_band_card_supports_current_and_assumption_markers():
    sidebar = read(V5_DIR / "target-data-sidebar.tsx")
    language = read(LANGUAGE_PREFS)

    assert "assumptionPbrInput" in sidebar
    assert "useState(() => formatPbrMultiple(pbr.currentPbr))" in sidebar
    assert "setAssumptionPbrInput(formatPbrMultiple(pbr.currentPbr))" in sidebar
    assert "[pbr.currentPbr]" in sidebar
    assert "assumptionPbr" in sidebar
    assert "scenarioPct" in sidebar
    assert "showScenarioMarker" in sidebar
    assert "현재 PBR" in sidebar
    assert "현재가 " in sidebar
    assert "입력 PBR" in sidebar
    assert "grid grid-cols-2" in sidebar
    assert "입력 PBR 기준 주가" in sidebar
    assert "입력 필요" in sidebar
    assert "계산 기준 BPS" in sidebar
    assert "현재가 대비 ${formatPercent(assumptionGap)}" in sidebar
    assert "aria-label={language === 'ko' ? 'PBR 배수 입력' : 'PBR multiple input'}" in sidebar
    assert "50% 기준 주가는 과거 PBR의 중앙값" in language
