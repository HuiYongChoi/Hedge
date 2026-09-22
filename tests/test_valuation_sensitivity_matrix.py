def test_sensitivity_matrix_shape():
    from src.agents.valuation import _build_sensitivity_matrix

    fn = lambda wacc, growth: 100.0 * (growth / (wacc - growth))
    matrix = _build_sensitivity_matrix(
        fn,
        base_wacc=0.136,
        base_growth=0.025,
        current_price=100.0,
    )

    assert len(matrix) == 5
    assert all(len(row) == 5 for row in matrix)
    for row in matrix:
        for cell in row:
            assert set(cell.keys()) == {"wacc", "growth", "intrinsic_value", "safety_margin"}


# 대형주 + 고성장(매출성장률 46.8%)에서 격자가 평평해지던 회귀를 막는다.
_LARGE_CAP = 1_326_000_000_000_000
_FCF = [70_000_000_000_000, 55_000_000_000_000, 40_000_000_000_000, 30_000_000_000_000]
_GROWTH_METRICS = {"revenue_growth": 0.468, "fcf_growth": 0.3, "earnings_growth": 0.4}
_RAW_GROWTH = 0.468
_WACC = 0.105


def _agent_matrix():
    """valuation 에이전트가 실제로 격자를 만드는 방식 그대로."""
    from src.agents.valuation import (
        _build_sensitivity_matrix,
        calculate_enhanced_dcf_value,
        resolve_high_growth,
    )

    return _build_sensitivity_matrix(
        lambda wacc, growth: calculate_enhanced_dcf_value(
            fcf_history=_FCF,
            growth_metrics=_GROWTH_METRICS,
            wacc=wacc,
            market_cap=_LARGE_CAP,
            resolved_high_growth=growth,
        ),
        base_wacc=_WACC,
        base_growth=resolve_high_growth(_RAW_GROWTH, _LARGE_CAP),
        current_price=_LARGE_CAP,
    )


def test_growth_axis_actually_moves_above_the_cap():
    """성장률 축을 매출성장률로 잡으면 상한에 눌려 다섯 칸이 같은 값이 됐다."""
    matrix = _agent_matrix()

    for row in matrix:
        spread = max(c["safety_margin"] for c in row) - min(c["safety_margin"] for c in row)
        # 표가 정수 %로 반올림되므로 1%p 는 벌어져야 칸마다 다르게 보인다.
        assert spread > 0.01, f"성장률 축이 평평하다: {[c['safety_margin'] for c in row]}"


def test_growth_axis_is_labelled_with_the_growth_the_model_uses():
    """축 라벨이 모델이 쓰지 않는 46.8% 를 가리키면 안 된다."""
    from src.agents.valuation import resolve_high_growth

    matrix = _agent_matrix()
    center = matrix[len(matrix) // 2][len(matrix[0]) // 2]

    assert center["growth"] == resolve_high_growth(_RAW_GROWTH, _LARGE_CAP) == 0.10
    assert center["wacc"] == _WACC


def test_center_cell_still_matches_the_capped_model_run():
    """가운데 칸은 상한을 그대로 적용한 값과 같아야 한다 — 보고서 숫자가 바뀌면 안 된다."""
    from src.agents.valuation import calculate_enhanced_dcf_value

    matrix = _agent_matrix()
    center = matrix[len(matrix) // 2][len(matrix[0]) // 2]

    capped = calculate_enhanced_dcf_value(
        fcf_history=_FCF,
        growth_metrics=_GROWTH_METRICS,
        wacc=_WACC,
        market_cap=_LARGE_CAP,
        revenue_growth=_RAW_GROWTH,
    )

    assert center["intrinsic_value"] == capped


def test_resolve_high_growth_keeps_the_original_cap_behaviour():
    from src.agents.valuation import resolve_high_growth

    assert resolve_high_growth(None, _LARGE_CAP) == 0.05
    assert resolve_high_growth(0.0, _LARGE_CAP) == 0.05
    assert resolve_high_growth(0.468, _LARGE_CAP) == 0.10  # 대형주 상한
    assert resolve_high_growth(0.08, _LARGE_CAP) == 0.08  # 상한 아래는 그대로
    assert resolve_high_growth(0.468, 8_000_000_000) == 0.25  # 중소형주는 25% 상한
    assert resolve_high_growth(-0.05, _LARGE_CAP) == -0.05  # 역성장은 통과
