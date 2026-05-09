from pathlib import Path


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
