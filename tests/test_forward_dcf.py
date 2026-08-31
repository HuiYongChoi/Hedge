"""선행 DCF — 컨센서스 기점 FCFF DCF 회귀 테스트.

기존 DCF 가 '지나간 실적'을 출발점으로 삼는 탓에, 사이클 업종에서 저점 현금흐름이
영구 성장의 기점이 되어 내재가치가 눌리는 문제를 보완하려고 추가한 경로다.
여기서 지키려는 것은 두 가지다.

  1. 선행 경로가 없거나 깨져도 기존 DCF 는 조금도 달라지지 않는다.
  2. 두 경로의 차이는 오직 '출발점'뿐이다 — 할인·감쇠·터미널은 같은 함수를 쓴다.
"""

from pathlib import Path
import pytest
from types import SimpleNamespace

from src.agents.aswath_damodaran import (
    _sustainable_growth_rate,
    _discount_fcff_path,
    _historical_fcff_conversion,
    _resolve_share_count,
    calculate_forward_intrinsic_value_dcf,
    calculate_intrinsic_value_dcf,
)


def _line_item(**kwargs):
    base = dict(
        revenue=None, free_cash_flow=None, net_income=None, outstanding_shares=None,
        ebit=None, operating_income=None, total_debt=None, shareholders_equity=None,
        cash_and_equivalents=None, interest_expense=None, report_period=None,
        capital_expenditure=None, depreciation_and_amortization=None,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def _sample_inputs():
    """매출·FCF·순이익이 함께 있는 5개년 + TTM."""
    items = [
        _line_item(revenue=1_000, free_cash_flow=100, net_income=125, outstanding_shares=1_000),
    ]
    for i, rev in enumerate([600, 700, 800, 900]):
        items.append(_line_item(
            revenue=rev, free_cash_flow=rev * 0.1, net_income=rev * 0.125,
            outstanding_shares=1_000,
        ))
    metrics = [SimpleNamespace(outstanding_shares=1_000, revenue=1_000)]
    risk = {"cost_of_equity": 0.09}
    return metrics, items, risk


def _forward(eps_ttm=0.20, fy0=None, fy1=None, confidence="high"):
    return SimpleNamespace(
        forward_eps_ttm=eps_ttm,
        forward_eps_fy0=fy0,
        forward_eps_fy1=fy1,
        confidence=confidence,
    )


# ── 1. 폴백: 선행이 없어도 기존 DCF 는 불변 ──────────────────────────────────
def test_forward_dcf_returns_reason_when_no_consensus():
    metrics, items, risk = _sample_inputs()
    result = calculate_forward_intrinsic_value_dcf(metrics, items, risk, None)
    assert result["intrinsic_value"] is None
    assert "선행" in result["reason"]


def test_forward_dcf_skips_negative_forward_eps():
    metrics, items, risk = _sample_inputs()
    result = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward(eps_ttm=-0.5))
    assert result["intrinsic_value"] is None


def test_trailing_dcf_unchanged_by_forward_path():
    """선행 경로를 어떻게 호출하든 기존 DCF 결과는 그대로여야 한다."""
    metrics, items, risk = _sample_inputs()
    before = calculate_intrinsic_value_dcf(metrics, items, risk)["intrinsic_value"]
    calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward())
    after = calculate_intrinsic_value_dcf(metrics, items, risk)["intrinsic_value"]
    assert before == after


# ── 2. 출발점만 다르다 ──────────────────────────────────────────────────────
def test_forward_dcf_uses_consensus_as_base():
    metrics, items, risk = _sample_inputs()
    conversion, _ = _historical_fcff_conversion(items)
    fwd = _forward(eps_ttm=0.20)
    result = calculate_forward_intrinsic_value_dcf(metrics, items, risk, fwd)

    shares = _resolve_share_count(metrics, items)
    expected_base = 0.20 * shares * conversion
    assert result["assumptions"]["base_fcff"] == expected_base
    # 할인율·터미널은 기존 DCF 와 동일한 가정을 그대로 쓴다
    assert result["assumptions"]["discount_rate"] == 0.09
    assert result["assumptions"]["terminal_growth"] == 0.025


def test_forward_growth_never_reuses_the_consensus_jump():
    """FY0→FY1 증가율을 성장률로 쓰면 같은 상승을 두 번 센다.

    출발점이 이미 '오른 뒤의 선행 연도'인데 거기에 그 상승률을 10년 더 얹는 셈이다.
    실측(000660.KS): 그렇게 계산하면 주당 1억 5,912만 원이 나왔다(현재가 165만 원).
    """
    metrics, items, risk = _sample_inputs()
    result = calculate_forward_intrinsic_value_dcf(
        metrics, items, risk, _forward(fy0=1.0, fy1=5.0),
    )
    assert "FY0" not in result["assumptions"]["growth_source"]
    assert result["assumptions"]["base_growth"] < 4.0


def _cycle_items(ebits, *, equity=1_000.0, debt=200.0, cash=100.0, growing=True, equity_step=100.0):
    """사이클 손익 + 연도별 투하자본. 최신이 앞."""
    items = []
    for index, ebit in enumerate(ebits):
        items.append(_line_item(
            report_period=f"{2025 - index}-12-31",
            ebit=ebit, operating_income=ebit,
            net_income=ebit * 0.75, interest_expense=0.0,
            total_debt=debt,
            shareholders_equity=equity - (index * equity_step if growing else 0),
            cash_and_equivalents=cash,
            revenue=1_000, free_cash_flow=100, outstanding_shares=1_000,
        ))
    return items


def test_growth_uses_reinvestment_times_roic():
    """FCFF DCF 의 성장은 재투자율 × ROIC 다 — ROE × 유보율은 주주 몫(FCFE) 판본이다."""
    items = _cycle_items([200.0, 180.0, 160.0, 140.0])
    growth, source = _sustainable_growth_rate([], items)
    assert growth is not None
    assert "재투자율" in source and "ROIC" in source
    assert 0 < growth < 1


def test_growth_keeps_loss_years_in_the_cycle():
    """적자 해를 빼면 남는 건 호황뿐이고, 그 호황이 10년 성장률이 된다.

    실측(000660.KS): 적자 해를 뺐더니 재투자율이 상한 100% 에 붙고 g 24.7% 가
    나왔다. 포함하니 14.8% 로 내려갔다.
    """
    # 같은 자본 궤적에 적자 해를 하나 끼워 넣는다. 연도 수가 달라지면 비교가
    # 성립하지 않으므로, 그 해의 이익만 음수로 바꾼다.
    with_loss = _sustainable_growth_rate([], _cycle_items([200.0, 180.0, -150.0, 140.0]))[0]
    boom_only = _sustainable_growth_rate([], _cycle_items([200.0, 180.0, 160.0, 140.0]))[0]
    assert with_loss is not None and boom_only is not None
    assert with_loss < boom_only, f"적자 해가 성장률을 끌어내려야 한다 ({with_loss} vs {boom_only})"


def test_growth_has_no_arbitrary_ceiling():
    """12% 상한은 없앴다 — 재무가 그렇게 말하면 12% 를 넘어도 된다."""
    # 번 돈을 전부 재투자하고(재투자율 100%) 그 자본이 20%대를 벌어오는 회사.
    items = _cycle_items([400.0] * 4, equity=2_000.0, equity_step=400.0)
    growth, _ = _sustainable_growth_rate([], items)
    assert growth > 0.12, growth


def test_growth_is_none_without_enough_years():
    """한 해만으로는 투하자본 증감을 볼 수 없다 — 지어내지 않고 폴백에 맡긴다."""
    assert _sustainable_growth_rate([], _cycle_items([200.0]))[0] is None


def test_both_dcf_engines_share_the_same_growth_basis():
    """같은 화면의 두 적정가가 서로 다른 성장 가정을 쓰면 폭을 읽을 수 없다."""
    source = (Path(__file__).resolve().parents[1] / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")
    # 두 DCF 엔진 + 사이클 정점 시나리오까지 같은 성장률 기준을 쓴다.
    assert source.count("_sustainable_growth_rate(metrics, cycle_items or line_items)") == 3


def test_forward_dcf_reports_which_forward_eps_it_started_from():
    """화면에 '선행 EPS'가 둘 뜨므로 어느 쪽을 썼는지 밝혀야 대조가 된다."""
    metrics, items, risk = _sample_inputs()
    forward = _forward(eps_ttm=0.20)
    forward.canonical_forward_eps = 0.50   # 증권사 12개월 선행 컨센서스
    result = calculate_forward_intrinsic_value_dcf(metrics, items, risk, forward)
    assert result["assumptions"]["forward_eps_source"] == "consensus12m"
    assert result["assumptions"]["forward_eps_used"] == pytest.approx(0.50)


def test_forward_dcf_falls_back_to_the_splice_and_says_so():
    """진짜 선행치가 없으면 스플라이스를 쓰되, 선행성이 1분기뿐임을 표시한다."""
    metrics, items, risk = _sample_inputs()
    result = calculate_forward_intrinsic_value_dcf(
        metrics, items, risk, _forward(eps_ttm=0.20),
    )
    assert result["assumptions"]["forward_eps_source"] == "spliceTtm"
    assert result["assumptions"]["forward_eps_used"] == pytest.approx(0.20)


def test_higher_forward_earnings_raise_intrinsic_value():
    metrics, items, risk = _sample_inputs()
    low = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward(eps_ttm=0.10))
    high = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward(eps_ttm=0.30))
    assert high["intrinsic_value"] > low["intrinsic_value"]


# ── 3. 이익→현금흐름 환산 가정 ──────────────────────────────────────────────
def test_conversion_ignores_loss_years_and_outliers():
    items = [
        _line_item(free_cash_flow=100, net_income=125),   # 0.8
        _line_item(free_cash_flow=90, net_income=100),    # 0.9
        _line_item(free_cash_flow=50, net_income=-10),    # 적자 → 제외
        _line_item(free_cash_flow=1_000, net_income=1),   # 1000배 → 제외
    ]
    conversion, n = _historical_fcff_conversion(items)
    assert n == 2
    assert abs(conversion - 0.85) < 1e-9


def test_conversion_is_clamped_to_sane_band():
    """감가상각이 큰 해가 영구화되지 않도록 상한을 둔다."""
    items = [_line_item(free_cash_flow=280, net_income=100)]  # 2.8배
    conversion, _ = _historical_fcff_conversion(items)
    assert conversion == 1.5


def test_forward_dcf_needs_conversion_samples():
    metrics = [SimpleNamespace(outstanding_shares=1_000)]
    items = [_line_item(revenue=1_000, outstanding_shares=1_000)]  # 순이익 없음
    result = calculate_forward_intrinsic_value_dcf(
        metrics, items, {"cost_of_equity": 0.09}, _forward(),
    )
    assert result["intrinsic_value"] is None
    assert "현금전환율" in result["reason"]


# ── 4. 발산 차단 ────────────────────────────────────────────────────────────
def test_path_refuses_discount_below_terminal_growth():
    """할인율이 영구성장률 이하이면 고든 분모가 무너진다 — 계산하지 않는다."""
    assert _discount_fcff_path(100, 0.05, 0.02, 10, 0.025) is None


def test_forward_dcf_refuses_when_discount_too_low():
    metrics, items, _ = _sample_inputs()
    result = calculate_forward_intrinsic_value_dcf(
        metrics, items, {"cost_of_equity": 0.01}, _forward(),
    )
    assert result["intrinsic_value"] is None


# ── 역산: 시장이 암묵적으로 쓰는 이익 ────────────────────────────────────────
def test_dcf_is_linear_in_the_starting_cash_flow():
    """역산이 비례식으로 성립하려면 이 성질이 참이어야 한다.

    할인율·감쇠·터미널은 이익과 무관하므로 출발 현금흐름을 k 배 하면 가치도
    정확히 k 배가 된다. 이 성질이 깨지면 '시장 암묵 이익'을 비례식으로 구할 수
    없고, 반복 탐색으로 바꿔야 한다.
    """
    metrics, items, risk = _sample_inputs()
    one = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward(eps_ttm=0.10))
    two = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward(eps_ttm=0.30))
    assert two["intrinsic_value"] == pytest.approx(one["intrinsic_value"] * 3.0, rel=1e-9)


def test_market_implied_eps_is_wired_from_the_forward_dcf():
    """화면이 '우리가 보는 이익' 옆에 '시장이 보는 이익'을 놓을 수 있어야 한다."""
    source = (Path(__file__).resolve().parents[1] / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")
    assert 'signal_payload["market_implied_eps"]' in source
    assert 'signal_payload["market_implied_eps_vs_forward"]' in source
    # 비례식이어야 한다 — 반복 탐색이 들어오면 위 선형성 테스트가 무의미해진다.
    assert "_fwd_eps_used * market_cap / _fwd_value" in source


# ── 사이클 정점 ──────────────────────────────────────────────────────────────
def test_cycle_path_is_worth_less_than_endless_growth():
    """정점을 넣으면 값이 내려가야 한다.

    기존 경로는 정점 개념이 없어 '지금 이익이 영원히 이어진다'로 계산한다.
    사이클 업종에서는 그것만으로 4배가 갈린다(실측 000660.KS: 정점 없이 597만,
    2년 뒤 정점이면 158만).
    """
    from src.agents.aswath_damodaran import _discount_cycle_path, _discount_fcff_path

    endless = _discount_fcff_path(100.0, 0.13, 0.105, 10, 0.025)
    peaked = _discount_cycle_path(100.0, 0.13, 2, 0.22, 0.105, 0.025)
    assert peaked is not None and endless is not None
    assert peaked < sum(endless)


def test_later_peak_is_worth_more():
    """정점이 뒤로 갈수록 좋은 해가 길어지므로 값이 커진다."""
    from src.agents.aswath_damodaran import _discount_cycle_path

    values = [_discount_cycle_path(100.0, 0.13, k, 0.22, 0.105, 0.025) for k in (1, 2, 3)]
    assert all(v is not None for v in values)
    assert values[0] < values[1] < values[2]


def test_normalization_ratio_comes_from_the_company_history():
    """상수로 박으면 종목마다 다른 사이클 진폭을 하나로 뭉갠다."""
    from src.agents.aswath_damodaran import _cycle_normalization_ratio

    items = [_line_item(net_income=n) for n in (100.0, 50.0, -20.0, 10.0, 40.0)]
    ratio, note = _cycle_normalization_ratio(items)
    assert ratio == pytest.approx((100 + 50 - 20 + 10 + 40) / 5 / 100)
    assert "정상/정점" in note


def test_normalization_needs_enough_years():
    from src.agents.aswath_damodaran import _cycle_normalization_ratio

    assert _cycle_normalization_ratio([_line_item(net_income=100.0)])[0] is None
