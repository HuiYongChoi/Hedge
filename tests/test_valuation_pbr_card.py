from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
V5_DIR = REPO_ROOT / "app/frontend/src/components/reports/analyst-report-v5"
LANG_PREFS = REPO_ROOT / "app/frontend/src/lib/language-preferences.ts"
SIDEBAR = V5_DIR / "target-data-sidebar.tsx"


def test_pbr_trend_helper_is_exported_and_guarded():
    helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")

    assert "export interface PbrTrend" in helpers
    assert "export function computePbrTrend" in helpers
    assert "history.length < 4" in helpers
    assert "pctChange > 0.05" in helpers
    assert "pctChange < -0.05" in helpers
    assert "상승국면" in helpers
    assert "하락국면" in helpers


def test_pbr_card_uses_native_tooltips_and_no_chart_library():
    sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")

    assert "function PbrBandCard" in sidebar
    assert "function PbrMiniRail" in sidebar
    assert "function InfoDot" in sidebar
    assert 'title={title}' in sidebar
    assert "role=\"tooltip\"" in sidebar
    assert "from 'recharts'" not in sidebar
    assert "from 'chart.js'" not in sidebar
    assert "from 'apexcharts'" not in sidebar
    assert "from '@radix-ui" not in sidebar


def test_pbr_card_shows_band_position_extremes_signal_and_keeps_rim_card():
    sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")

    assert "pbrCardTitle" in sidebar
    assert "pbrRailTip" in sidebar
    assert "pbrRowPosition" in sidebar
    assert "pbrRowTrend" in sidebar
    assert "pbrRowExtremes" in sidebar
    assert "pbrRowSignal" in sidebar
    assert "computePbrTrend(pbr.history" in sidebar
    assert "formatPbrMultiple(pbr.percentiles.p10)" in sidebar
    # 중위값은 이 카드의 기준점이라 눈금에서 크게 쓴다("50%" → "중위").
    assert "'중위' : 'median'} {formatPbrMultiple(pbr.percentiles.p50)}" in sidebar
    assert "text-xs font-semibold text-foreground" in sidebar
    assert "formatPbrMultiple(pbr.percentiles.p90)" in sidebar
    assert "dive.regime === 'capex_heavy' ? (" in sidebar
    capex_block = sidebar[sidebar.index("dive.regime === 'capex_heavy' ? ("):]
    assert capex_block.index("{evCard}") < capex_block.index("{pbrCard}") < capex_block.index("{rimCard}")
    assert "RIM 평가" in sidebar
    assert "RIM Valuation" in sidebar


def test_pbr_i18n_keys_exist_in_both_languages():
    i18n = LANG_PREFS.read_text(encoding="utf-8")

    for needle in [
        "pbrCardTitle: 'PBR 밴드'",
        "pbrCardTitleTip: '역사적 PBR 중위값 기준 주가는 과거 PBR의 중앙값을 적용한 가격입니다.",
        "pbrRailTip: '회색 막대는 과거 PBR 범위입니다.",
        "pbrRowPosition: '위치'",
        "pbrRowTrend: '추세'",
        "pbrRowExtremes: '극값 대비'",
        "pbrRowSignal: '시그널'",
        "pbrCardTitle: 'PBR Band'",
        "pbrCardTitleTip: 'Historical median PBR price applies the historical median PBR.",
        "pbrRailTip: 'The gray rail is the historical PBR range.",
        "pbrRowPosition: 'Position'",
        "pbrRowTrend: 'Trend'",
        "pbrRowExtremes: 'Vs extremes'",
        "pbrRowSignal: 'Signal'",
    ]:
        assert needle in i18n


def test_valuation_cards_do_not_repeat_the_same_number():
    """같은 숫자가 한 화면에 여러 번 나오면 어느 것이 기준인지 흐려진다.

    실측(사용자 화면): '역사적 PBR 중위값 기준 주가 ₩1,154,606' 이 PBR 밴드 카드와
    목표가 검산 카드에 두 번, '상단 시나리오 ₩1,763,843' 도 두 번, RIM 은 목표가
    검산과 보수 모델 카드에 두 번 나왔다. 기준값은 한 곳에만 두고, 목표가 검산은
    '그 기준에서 얼마나 떨어져 있는가'만 말한다.
    """
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    bridge_start = sidebar.index("function ConsensusBridgeTile")
    next_decl = sidebar.find("\nfunction ", bridge_start + 1)
    bridge = sidebar[bridge_start:next_decl if next_decl != -1 else len(sidebar)]

    assert "중위값 기준 주가" not in bridge, "중위값 가격은 PBR 밴드 카드에만 둔다"
    assert "90% 상단 시나리오" not in bridge, "상단 시나리오도 PBR 밴드 카드에만 둔다"
    assert "formatCurrency(rimValue" not in bridge, "RIM 은 아래 카드에만 둔다"
    # 대신 '얼마나 떨어져 있는가'는 남아야 한다 — 그게 이 카드의 일이다.
    assert "gapToP90" in bridge and "upsideToCurrent" in bridge
    # 목표가가 몇 배짜리인지도 그 자리에서 검산되어야 한다.
    assert "fwdPerTargetLabel" in bridge and "PBR {formatPbrMultiple(impliedPbr)}" in bridge


def test_valuation_models_carry_plain_language_explanations():
    """DCF·EV/EBIT·RIM 이 한꺼번에 뜨는데 이름만으로는 무엇을 재는지 알 수 없다."""
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    language = LANG_PREFS.read_text(encoding="utf-8")

    assert "VALUATION_MODEL_GLOSSARY" in sidebar
    assert "valuationModelTip(model.labelKey, language)" in sidebar
    assert "valuationModelsHowToRead" in sidebar
    for key in ("Dcf", "Owner", "EvEbitda", "EvEbit", "Ebitda", "Eva", "Rim", "Pbr"):
        assert f"valuationModelGlossary{key}:" in language, key
    # 밴드 구간별 해석도 호버로 붙는다.
    for key in ("pbrLowerBandTip", "pbrMedianPriceTip", "pbrUpperBandTip"):
        assert f"{key}:" in language and key in sidebar, key
