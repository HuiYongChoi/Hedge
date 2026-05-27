from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
V5_DIR = REPO_ROOT / "app/frontend/src/components/reports/analyst-report-v5"
LANG_PREFS = REPO_ROOT / "app/frontend/src/lib/language-preferences.ts"


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
    assert "50% {formatPbrMultiple(pbr.percentiles.p50)}" in sidebar
    assert "formatPbrMultiple(pbr.percentiles.p90)" in sidebar
    assert "dive.regime === 'capex_heavy' ? (" in sidebar
    assert sidebar.index("{evCard}") < sidebar.index("{pbrCard}") < sidebar.index("{rimCard}")
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
