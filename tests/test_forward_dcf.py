"""선행 DCF — 컨센서스 기점 FCFF DCF 회귀 테스트.

기존 DCF 가 '지나간 실적'을 출발점으로 삼는 탓에, 사이클 업종에서 저점 현금흐름이
영구 성장의 기점이 되어 내재가치가 눌리는 문제를 보완하려고 추가한 경로다.
여기서 지키려는 것은 두 가지다.

  1. 선행 경로가 없거나 깨져도 기존 DCF 는 조금도 달라지지 않는다.
  2. 두 경로의 차이는 오직 '출발점'뿐이다 — 할인·감쇠·터미널은 같은 함수를 쓴다.
"""

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


def test_forward_growth_uses_sustainable_growth_when_roe_is_available():
    """g = ROE 중앙값 × 유보율. 임의의 상한이 아니라 그 기업 재무에서 나온 값."""
    metrics, items, risk = _sample_inputs()
    metrics = [
        SimpleNamespace(outstanding_shares=1_000, revenue=1_000,
                        return_on_equity=roe, payout_ratio=0.20)
        for roe in (0.35, 0.15, 0.04)
    ]
    result = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward())
    # 중앙값 15% × 유보율 80% = 12%
    assert result["assumptions"]["base_growth"] == pytest.approx(0.12)
    assert "ROE 중앙값" in result["assumptions"]["growth_source"]


def test_sustainable_growth_normalizes_across_the_cycle():
    """최근 ROE 하나만 쓰면 호황 정점이 10년 성장률이 된다."""
    peak_only = [SimpleNamespace(outstanding_shares=1_000, revenue=1_000,
                                 return_on_equity=0.35, payout_ratio=0.20)]
    across_cycle = peak_only + [
        SimpleNamespace(outstanding_shares=1_000, revenue=1_000,
                        return_on_equity=roe, payout_ratio=0.20)
        for roe in (0.15, 0.04)
    ]
    peak_g, _ = _sustainable_growth_rate(peak_only)
    cycle_g, _ = _sustainable_growth_rate(across_cycle)
    assert cycle_g < peak_g, "사이클을 가로지르면 정점보다 낮아야 한다"


def test_forward_growth_has_no_arbitrary_ceiling():
    """관측된 증가율을 그대로 쓴다 — 12% 상한은 제거했다(사용자 요청).

    상한이 있으면 사이클 회복 구간의 컨센서스가 잘려 나가 선행 DCF 를 따로 두는
    의미가 줄어든다. 대신 쓰인 증가율을 assumptions 로 내보내 화면에서 보이게 한다.
    할인율 ≤ 영구성장률이면 고든 분모가 무너지므로 그때만 미산출로 돌린다.
    """
    metrics, items, risk = _sample_inputs()
    metrics = [SimpleNamespace(outstanding_shares=1_000, revenue=1_000,
                               return_on_equity=0.40, payout_ratio=0.0)]
    result = calculate_forward_intrinsic_value_dcf(metrics, items, risk, _forward())
    # 12% 상한이 남아 있었다면 0.12 로 잘렸을 값.
    assert result["assumptions"]["base_growth"] == pytest.approx(0.40)


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
