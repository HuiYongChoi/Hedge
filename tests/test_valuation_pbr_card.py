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


def test_pbr_card_uses_lightweight_tooltips_and_no_chart_library():
    sidebar = (V5_DIR / "target-data-sidebar.tsx").read_text(encoding="utf-8")

    assert "function PbrBandCard" in sidebar
    assert "function PbrMiniRail" in sidebar
    assert "function InfoDot" in sidebar
    # native title 은 1초 넘게 기다려야 떠서 group-hover 로 바꿨다.
    # 차트도 라이브러리 없이 div 로 그린다 — 번들을 늘리지 않는다.
    assert "function HelpTip" in sidebar
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
    assert "upsideToCurrent" in bridge
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


def test_input_pbr_price_falls_back_to_the_placeholder_value():
    """상자에 보이는 값과 계산이 어긋나면 안 된다.

    실측(사용자 화면): 입력칸에 3.5 가 보이는데 '입력 필요' 가 떴다. 그 3.5 는
    입력값이 아니라 placeholder(현재 PBR)였고, 실제 값은 비어 있어 Number('')
    로 계산이 멈춰 있었다. 비어 있으면 화면에 보이는 그 값으로 계산한다.
    """
    sidebar = SIDEBAR.read_text(encoding="utf-8")

    assert "placeholder={formatPbrMultiple(pbr.currentPbr)}" in sidebar
    # 비었을 때 현재 PBR 로 떨어진다.
    assert "if (assumptionPbrInput.trim() !== '') return null;" in sidebar
    assert "return Number.isFinite(pbr.currentPbr) && pbr.currentPbr > 0 ? pbr.currentPbr : null;" in sidebar
    # '—' 가 입력칸 초기값으로 들어가면 Number('—') = NaN 이라 계산이 죽는다.
    assert "const defaultPbrText = Number.isFinite(pbr.currentPbr) && pbr.currentPbr > 0" in sidebar
    # 안내 문구도 '입력해야 계산된다'가 아니라 '현재 PBR 기준으로 계산 중'이다.
    # (주석에는 남아 있어도 된다 — 왜 이렇게 바꿨는지가 거기 적혀 있다.)
    assert "'입력 필요' : 'Enter PBR'" not in sidebar
    assert "현재 PBR 기준으로 계산됩니다" in sidebar


def test_model_values_appear_once_in_the_valuation_section():
    """모델 값이 요약 리스트와 개별 카드에 연달아 두 번 나오고 있었다.

    실측(사용자 화면): '밸류에이션 모델 요약'에 DCF·Owner Earnings·EV/EBITDA·
    EV/EBIT·EBITDA 정규화·ROIC−WACC EVA·RIM 이 줄로 다 들어 있는데, 바로 아래에
    같은 모델 카드가 하나씩 또 그려졌다. 값은 요약 한 곳에만 둔다.
    """
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    start = sidebar.index("if (mode === 'afterPbr')")
    block = sidebar[start:sidebar.index("\n  return (", start)]

    assert "<ValuationModelsSummary" in block, "요약 리스트가 이 구간의 기준이다"
    for card in ("{evCard}", "{evEbitCard}", "{ebitdaCard}", "{evaCard}", "{secondaryRimCard}"):
        assert card not in block, f"{card} 가 요약과 중복된다"
    # 요약에 없는 것만 남는다.
    assert "{cashFlowCard}" in block and "{gapNotice}" in block


def test_gap_notice_states_the_gap_not_the_numbers_again():
    """현재가·증권사 평균·RIM 은 각각 다른 카드에 이미 한 번씩 있다."""
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    start = sidebar.index("function ValuationGapNotice")
    notice = sidebar[start:sidebar.index("\nfunction ", start + 1)]

    assert "formatCurrency(livePrice" not in notice, "현재가는 상단 헤더에 있다"
    assert "formatCurrency(consensus" not in notice, "증권사 평균은 목표가 검산 카드에 있다"
    assert "formatCurrency(rimValue" not in notice, "RIM 은 모델 요약에 있다"
    # 대신 괴리(%)는 남는다 — 그게 이 카드의 일이다.
    for gap in ("safetyGap", "rimGap", "consensusGap"):
        assert f"formatPercent({gap})" in notice, gap


def test_market_implied_eps_shows_the_multiple_not_just_the_number():
    """EPS 하나만 있으면 비싼지 싼지 알 수 없다 — 현재가 기준 PER 로도 보여준다."""
    helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
    language = LANG_PREFS.read_text(encoding="utf-8")

    assert "(price / impliedEps).toFixed(1)" in helpers
    assert "marketImpliedPerLabel" in helpers
    assert "marketImpliedPerLabel: '현재가 기준 PER'" in language


def test_sticky_header_price_is_the_largest_chip():
    """현재가는 화면의 모든 값이 견주는 기준점이다."""
    header = (V5_DIR / "sticky-analysis-header.tsx").read_text(encoding="utf-8")
    price_block = header[header.index("formatCurrency(currentPrice, currency, language)") - 300:]
    assert "text-lg font-bold" in price_block
    assert "text-sm font-semibold text-foreground\">\n            {formatCurrency(currentPrice" not in header


def test_tooltips_do_not_use_the_slow_browser_default():
    """title 속성은 마우스를 올리고 1초 넘게 기다려야 뜬다.

    설명이 필요해서 올린 손이 그 사이에 지나가 버리면 없는 것과 같다.
    group-hover 로 지연 없이 뜨게 한다.
    """
    sidebar = SIDEBAR.read_text(encoding="utf-8")

    assert "function HelpTip" in sidebar
    assert "group-hover/tip:block" in sidebar
    # InfoDot 이 native title 로 되돌아가면 안 된다.
    info_dot = sidebar[sidebar.index("function InfoDot"):]
    assert "title={title}" not in info_dot[:400]
    # 모델 이름 호버도 같은 경로를 쓴다.
    assert "title={valuationModelTip(" not in sidebar


def test_target_check_card_drops_the_unreadable_band_fragments():
    """'90% 대비 +82.7% · 50% +179.1%' — 무엇의 90%/50% 인지 이 카드에선 알 수 없다."""
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    start = sidebar.index("function ConsensusBridgeTile")
    next_decl = sidebar.find("\nfunction ", start + 1)
    bridge = sidebar[start:next_decl if next_decl != -1 else len(sidebar)]

    assert "p90Text" not in bridge
    assert "gapToP50" not in bridge
    assert "현재가 대비" in bridge, "현재가 대비는 남는다"


def test_cycle_card_draws_the_scenarios():
    """세 값의 간격과 현재가 위치는 표만으로는 머릿속에서 그려야 한다."""
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    start = sidebar.index("function CyclePeakCard")
    card = sidebar[start:sidebar.index("\nfunction ", start + 1)]

    assert "currentPrice" in card, "현재가 기준선을 그리려면 현재가가 필요하다"
    assert "bg-emerald-500/60" in card and "bg-rose-500/60" in card, "현재가 위/아래를 색으로 가른다"
    assert "style={{ width: pct(value) }}" in card


def test_both_discount_rates_are_shown_with_their_engine():
    """화면의 할인율과 타일을 실제로 만든 할인율이 어긋나 있었다.

    실측(000660.KS): 사이드바에는 가치평가 분석가의 WACC 10.5% 만 떠 있었는데,
    위 내재가치 타일들을 만든 다모다란 DCF 는 자기자본비용 9.0% 로 할인한다.
    할인율은 성장률과 함께 결과를 가장 크게 좌우하는 두 축이라, 어느 값이 어느
    엔진의 것인지 함께 밝혀야 한다.
    """
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    helpers = (V5_DIR / "helpers.ts").read_text(encoding="utf-8")
    language = LANG_PREFS.read_text(encoding="utf-8")
    agent = (REPO_ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")

    assert 'signal_payload["damodaran_cost_of_equity"]' in agent
    assert "function DiscountRateCard" in sidebar
    assert "다모다란 DCF · 자기자본비용" in sidebar
    assert "가치평가 분석가 · WACC" in sidebar
    assert "discountRateCardTip:" in language
    # 베타 자료가 없으면 1.0 을 가정한다는 사실도 숨기지 않는다.
    assert "베타 자료가 없어 1.0으로 가정했습니다" in sidebar
    # 단독 WACC 타일은 이 카드와 중복이라 뺐다.
    assert "'targetWaccLabel'" not in helpers


def test_cost_of_capital_card_pairs_the_hurdle_with_the_return():
    """조달 비용만 있으면 반쪽이다 — 그 돈으로 얼마를 벌었는지가 짝이어야 한다.

    본문은 '세후 ROIC 약 7.3% vs 자본비용 9.0%' 를 이미 말하고 있는데 화면에는
    그 숫자가 없었다. 초과수익이 음수면 재투자할수록 주주 가치가 깎인다는 뜻이라,
    할인율 옆에 나란히 놓여야 판단이 된다.
    """
    sidebar = SIDEBAR.read_text(encoding="utf-8")
    scorecard = (REPO_ROOT / "src/tools/management_scorecard.py").read_text(encoding="utf-8")
    agent = (REPO_ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")

    assert 'metrics_out["roic_after_tax"]' in scorecard
    assert 'signal_payload[f"damodaran_{_key}"]' in agent
    assert "세후 ROIC (번 수익률)" in sidebar
    assert "초과수익 (ROIC − 자본비용)" in sidebar
    # 초과수익 부호에 따라 해석이 달라진다.
    assert "재투자를 늘릴수록 주주 가치가 깎입니다" in sidebar
    assert "재투자할수록 주주 몫이 늘어나는 구간입니다" in sidebar
