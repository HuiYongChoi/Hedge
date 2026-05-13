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
