"""bear/base/bull 시나리오가 실제로 갈리는지, 헤드라인 base 는 그대로인지."""

import pytest

from src.agents.valuation import (
    calculate_dcf_scenarios,
    calculate_enhanced_dcf_value,
    resolve_high_growth,
)

FCF = [70_000_000_000_000, 55_000_000_000_000, 40_000_000_000_000, 30_000_000_000_000]
BIG_CAP = 1_326_000_000_000_000
SMALL_CAP = 8_000_000_000
WACC = 0.105


def _metrics(revenue_growth):
    return {'revenue_growth': revenue_growth, 'fcf_growth': 0.3, 'earnings_growth': 0.4}


def _scenarios(revenue_growth, market_cap=BIG_CAP, wacc=WACC):
    return calculate_dcf_scenarios(
        fcf_history=FCF,
        growth_metrics=_metrics(revenue_growth),
        wacc=wacc,
        market_cap=market_cap,
        revenue_growth=revenue_growth,
    )


# 매출성장률 46.8% + 대형주 상한 10%. 조정을 매출성장률에 걸면 0.234/0.468/0.702 가
# 모두 상한 10% 로 눌려 세 시나리오의 성장률이 같아졌다.
def test_growth_actually_moves_the_wings_for_capped_names():
    res = _scenarios(0.468)
    s = res['scenarios']

    # 할인율만으로 벌어지는 폭 — 성장률을 세 시나리오에서 고정했을 때.
    fixed_growth = resolve_high_growth(0.468, BIG_CAP)
    wacc_only = [
        calculate_enhanced_dcf_value(
            fcf_history=FCF,
            growth_metrics=_metrics(0.468),
            wacc=WACC * adj,
            market_cap=BIG_CAP,
            resolved_high_growth=fixed_growth,
        )
        for adj in (1.2, 1.0, 0.9)
    ]
    wacc_only_spread = wacc_only[2] - wacc_only[0]

    assert s['bull'] - s['bear'] > wacc_only_spread, (
        '성장률이 시나리오 폭에 전혀 기여하지 않는다 — 상한에 눌렸다'
    )


def test_base_scenario_still_equals_a_plain_capped_run():
    """헤드라인이 움직이면 안 된다 — base 는 상한을 그대로 적용한 값과 같아야 한다."""
    plain = calculate_enhanced_dcf_value(
        fcf_history=FCF,
        growth_metrics=_metrics(0.468),
        wacc=WACC,
        market_cap=BIG_CAP,
        revenue_growth=0.468,
    )

    assert _scenarios(0.468)['scenarios']['base'] == plain


def test_negative_growth_does_not_flip_bear_and_bull():
    """−5% 에 1.5 를 곱하면 −7.5% 가 되어 bull 이 bear 보다 나빠졌다."""
    s = _scenarios(-0.05)['scenarios']

    assert s['bear'] < s['base'] < s['bull']
    assert _scenarios(-0.05)['range'] > 0


@pytest.mark.parametrize(
    'revenue_growth,market_cap,wacc',
    [
        (0.468, BIG_CAP, WACC),
        (0.12, BIG_CAP, WACC),
        (0.06, BIG_CAP, WACC),
        (0.03, BIG_CAP, WACC),
        (0.0, BIG_CAP, WACC),
        (None, BIG_CAP, WACC),
        (-0.05, BIG_CAP, WACC),
        (-0.30, BIG_CAP, WACC),
        (0.468, SMALL_CAP, WACC),
        (0.08, SMALL_CAP, WACC),
        (0.468, BIG_CAP, 0.04),   # 할인율이 영구성장률에 근접
        (0.468, BIG_CAP, 0.025),  # 할인율이 영구성장률 아래
    ],
)
def test_scenarios_stay_ordered_and_finite(revenue_growth, market_cap, wacc):
    res = _scenarios(revenue_growth, market_cap, wacc)
    s = res['scenarios']

    assert s['bear'] <= s['base'] <= s['bull']
    assert res['upside'] >= res['downside']
    assert all(0 <= v < 1e20 for v in s.values())


def test_positive_growth_adjustment_still_matches_the_old_multiplier():
    """양수 성장률에서는 가감이 곱셈과 같은 값을 내야 한다(0.5g / g / 1.5g)."""
    resolved = resolve_high_growth(0.08, SMALL_CAP)
    s = _scenarios(0.08, SMALL_CAP)['scenarios']

    for name, factor, terminal_adj in (('bear', 0.5, 0.8), ('base', 1.0, 1.0), ('bull', 1.5, 1.2)):
        expected = calculate_enhanced_dcf_value(
            fcf_history=FCF,
            growth_metrics=_metrics(0.08),
            wacc=WACC * {'bear': 1.2, 'base': 1.0, 'bull': 0.9}[name],
            market_cap=SMALL_CAP,
            resolved_high_growth=resolved * factor,
            terminal_growth_adj=terminal_adj,
        )
        assert s[name] == expected


def test_terminal_growth_ceiling_still_binds():
    """영구성장률은 어떤 조정을 넣어도 3% 를 넘지 못한다 — 폭증하는 자리다."""
    kwargs = dict(
        fcf_history=FCF,
        growth_metrics=_metrics(0.10),
        wacc=WACC,
        market_cap=BIG_CAP,
        resolved_high_growth=0.10,  # 0.10 * 0.6 = 6% → 천장 3% 에 걸린다
    )

    at_ceiling = calculate_enhanced_dcf_value(**kwargs, terminal_growth_adj=1.0)
    way_over = calculate_enhanced_dcf_value(**kwargs, terminal_growth_adj=100.0)

    assert at_ceiling == way_over


def test_terminal_adjustment_applies_below_the_ceiling():
    """천장 아래에서는 조정이 실제로 먹어야 한다 — 죽은 설정이면 안 된다."""
    kwargs = dict(
        fcf_history=FCF,
        growth_metrics=_metrics(0.03),
        wacc=WACC,
        market_cap=BIG_CAP,
        resolved_high_growth=0.03,  # 0.03 * 0.6 = 1.8% → 천장 아래
    )

    tightened = calculate_enhanced_dcf_value(**kwargs, terminal_growth_adj=0.8)
    neutral = calculate_enhanced_dcf_value(**kwargs, terminal_growth_adj=1.0)
    loosened = calculate_enhanced_dcf_value(**kwargs, terminal_growth_adj=1.2)

    assert tightened < neutral < loosened
