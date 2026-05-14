from pathlib import Path
from types import SimpleNamespace

import pytest

from src.agents.charlie_munger import (
    _munger_decision_factors,
    _weighted_component_score,
    analyze_predictability,
    make_munger_facts_bundle,
)


ROOT = Path(__file__).resolve().parents[1]
MUNGER_SOURCE = ROOT / "src/agents/charlie_munger.py"
API_SOURCE = ROOT / "src/tools/api.py"


def test_search_line_items_filters_empty_history_rows_before_returning() -> None:
    source = API_SOURCE.read_text(encoding="utf-8")

    assert "def _filter_usable_line_items" in source
    assert "_filter_usable_line_items(standardize_line_items" in source


def test_munger_predictability_uses_four_usable_period_threshold() -> None:
    source = MUNGER_SOURCE.read_text(encoding="utf-8")
    predictability_source = source[source.index("def analyze_predictability") : source.index("def calculate_munger_valuation")]

    assert "MIN_PREDICTABILITY_PERIODS = 4" in source
    assert "need 4+ usable years" in predictability_source
    assert "len(revenues) >= MIN_PREDICTABILITY_PERIODS" in predictability_source
    assert "len(op_income) >= MIN_PREDICTABILITY_PERIODS" in predictability_source
    assert "len(op_margins) >= MIN_PREDICTABILITY_PERIODS" in predictability_source
    assert "len(fcf_values) >= MIN_PREDICTABILITY_PERIODS" in predictability_source


def test_munger_facts_bundle_formats_recent_debt_ratio_as_percent() -> None:
    source = MUNGER_SOURCE.read_text(encoding="utf-8")
    bundle_source = source[source.index("def make_munger_facts_bundle") : source.index("def compute_confidence")]

    assert "format_debt_ratio_percent" in source
    assert '"최근 부채비율": format_debt_ratio_percent' in bundle_source


def test_munger_predictability_backfills_operating_margin_from_income_and_revenue() -> None:
    line_items = [
        SimpleNamespace(revenue=100, operating_income=20, operating_margin=None, free_cash_flow=12),
        SimpleNamespace(revenue=92, operating_income=18, operating_margin=None, free_cash_flow=10),
        SimpleNamespace(revenue=84, operating_income=16, operating_margin=None, free_cash_flow=9),
        SimpleNamespace(revenue=76, operating_income=14, operating_margin=None, free_cash_flow=8),
    ]

    result = analyze_predictability(line_items)

    assert result["score"] is not None
    assert result["operating_margin_backfilled_periods"] == 4
    assert "backfilled" in result["details"].lower()


def test_munger_predictability_returns_none_when_data_is_insufficient() -> None:
    line_items = [
        SimpleNamespace(revenue=100, operating_income=20, operating_margin=None, free_cash_flow=12),
        SimpleNamespace(revenue=92, operating_income=18, operating_margin=None, free_cash_flow=10),
        SimpleNamespace(revenue=84, operating_income=16, operating_margin=None, free_cash_flow=9),
    ]

    result = analyze_predictability(line_items)

    assert result["score"] is None
    assert "보류" in result["details"]


def test_munger_weighted_score_excludes_missing_predictability_weight() -> None:
    score, weight = _weighted_component_score(
        [
            ("moat", {"score": 8}, 0.35),
            ("management", {"score": 6}, 0.25),
            ("predictability", {"score": None}, 0.25),
            ("valuation", {"score": 4}, 0.15),
        ]
    )

    assert score == pytest.approx((8 * 0.35 + 6 * 0.25 + 4 * 0.15) / 0.75)
    assert weight == pytest.approx(0.75)


def test_munger_facts_bundle_shows_data_insufficient_when_score_is_missing() -> None:
    facts = make_munger_facts_bundle(
        {
            "signal": "neutral",
            "score": 6,
            "max_score": 10,
            "moat_analysis": {"score": 7, "details": "Moat detail"},
            "management_analysis": {"score": 6, "details": "Management detail"},
            "predictability_analysis": {
                "score": None,
                "details": "데이터 부족 (4년 미만) - 예측가능성 평가 보류",
            },
            "valuation_analysis": {"score": 5, "details": "Valuation detail"},
        }
    )

    assert "예측가능성 점수" in facts
    assert "데이터 부족" in facts["예측가능성 점수"]
    assert facts["핵심 체크"]["예측가능성"] == "보류"
    assert "예측가능성" in facts["메모"]


def test_munger_prompt_factors_omit_predictability_when_score_is_missing() -> None:
    factors = _munger_decision_factors({"predictability_analysis": {"score": None}})

    assert "predictability" not in factors
    assert factors == "moat strength, management quality, valuation"
