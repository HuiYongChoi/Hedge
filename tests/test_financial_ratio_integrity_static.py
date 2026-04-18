from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BEN_GRAHAM = ROOT / "src/agents/ben_graham.py"
DATA_STANDARDIZER = ROOT / "src/utils/data_standardizer.py"
LLM = ROOT / "src/utils/llm.py"
DART = ROOT / "src/tools/dart_api.py"
WARREN_BUFFETT = ROOT / "src/agents/warren_buffett.py"
FUNDAMENTALS = ROOT / "src/agents/fundamentals.py"
ASWATH_DAMODARAN = ROOT / "src/agents/aswath_damodaran.py"
BILL_ACKMAN = ROOT / "src/agents/bill_ackman.py"
RAKESH_JHUNJHUNWALA = ROOT / "src/agents/rakesh_jhunjhunwala.py"


def test_graham_uses_true_debt_to_equity_separate_from_liability_ratio() -> None:
    source = BEN_GRAHAM.read_text(encoding="utf-8")

    assert '"total_debt"' in source
    assert '"shareholders_equity"' in source
    assert "debt_to_equity" in source
    assert "liabilities_to_assets" in source
    assert "Debt-to-equity" in source
    assert "Liabilities-to-assets" in source
    assert "not the same as debt-to-equity" in source
    assert "Debt ratio =" not in source


def test_standardizer_derives_total_debt_by_summing_short_and_long_debt() -> None:
    source = DATA_STANDARDIZER.read_text(encoding="utf-8")

    assert "def _derive_total_debt" in source
    assert '"short_term_debt"' in source
    assert '"long_term_debt"' in source
    assert "_derive_total_debt(row)" in source
    assert "_safe_div(total_debt, shareholders_equity)" in source
    assert "total_debt if total_debt is not None else total_liabilities" not in source


def test_llm_prompts_preserve_decimal_ratio_scale() -> None:
    source = LLM.read_text(encoding="utf-8")

    assert "RATIO_SCALE_REQUIREMENT" in source
    assert "0.11 means 0.11x" in source
    assert "Do NOT rewrite 0.80 as 080" in source
    assert "RATIO_SCALE_REQUIREMENT" in source[source.index("def _make_system_message") :]
    assert "RATIO_SCALE_REQUIREMENT" in source[source.index("def _append_korean_requirement_to_text") :]


def test_dart_metrics_do_not_label_total_liabilities_as_debt_to_equity() -> None:
    source = DART.read_text(encoding="utf-8")

    assert '"short_term_debt"' in source
    assert '"long_term_debt"' in source
    assert "total_debt = fin.get(\"total_debt\")" in source
    assert "debt_to_equity = safe_div(total_debt, shareholders_equity)" in source
    assert "debt_to_equity = safe_div(total_liabilities, shareholders_equity)" not in source


def test_ratio_checks_treat_zero_as_valid_numeric_data() -> None:
    buffett_source = WARREN_BUFFETT.read_text(encoding="utf-8")
    fundamentals_source = FUNDAMENTALS.read_text(encoding="utf-8")

    assert "latest_metrics.debt_to_equity is not None" in buffett_source
    assert "latest_metrics.current_ratio is not None" in buffett_source
    assert "if latest_metrics.debt_to_equity and" not in buffett_source
    assert "if latest_metrics.current_ratio and" not in buffett_source
    assert "if item.net_income is not None" in buffett_source

    assert "current_ratio is not None and current_ratio > 1.5" in fundamentals_source
    assert "debt_to_equity is not None and debt_to_equity < 0.5" in fundamentals_source
    assert "if current_ratio and" not in fundamentals_source
    assert "if debt_to_equity and" not in fundamentals_source


def test_agent_ratio_labels_keep_debt_to_equity_and_liabilities_separate() -> None:
    aswath_source = ASWATH_DAMODARAN.read_text(encoding="utf-8")
    bill_source = BILL_ACKMAN.read_text(encoding="utf-8")
    rakesh_source = RAKESH_JHUNJHUNWALA.read_text(encoding="utf-8")

    assert "D/E {dte:.2f}x" in aswath_source
    assert "D/E {dte:.1f}" not in aswath_source

    assert "Debt-to-equity trends, with liabilities-to-assets as a separate fallback" in bill_source
    assert "item.total_liabilities is not None and item.total_assets is not None" in bill_source

    assert "Liabilities-to-assets ratio. This is not debt-to-equity." in rakesh_source
    assert "debt_ratio = latest.total_liabilities / latest.total_assets" not in rakesh_source
    assert "liabilities-to-assets ratio" in rakesh_source
