from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LLM_SOURCE = ROOT / "src/utils/llm.py"
BUFFETT_SOURCE = ROOT / "src/agents/warren_buffett.py"
GRAHAM_SOURCE = ROOT / "src/agents/ben_graham.py"
STOCK_SEARCH_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"


def test_financial_language_normalizer_repairs_lost_ratio_decimals() -> None:
    from src.utils.financial_formatting import normalize_financial_language

    raw = (
        "D/E 047x, Current Ratio 121x, Debt-To-Equity 0.123456x. "
        "Graham Number = 212.35, 그레이엄 넘버(21235)를 크게 상회."
    )

    normalized = normalize_financial_language(raw)

    assert "Debt-To-Equity(부채비율) 0.47x" in normalized
    assert "Current Ratio 1.21x" in normalized
    assert "Debt-To-Equity(부채비율) 0.12x" in normalized
    assert "그레이엄 넘버(212.35)" in normalized
    assert "21235" not in normalized


def test_financial_language_normalizer_uses_formal_terms_and_korean_money_units() -> None:
    from src.utils.financial_formatting import normalize_financial_language

    raw = (
        "현금으로 돌아오는 힘이 약하고 D/E 0.06x(낮음). "
        "영업현금흐름(FCF) 수익률이 낮다. 시가총액 123456789000원."
    )

    normalized = normalize_financial_language(raw)

    assert "잉여현금흐름(FCF) 창출력" in normalized
    assert "잉여현금흐름(FCF) 수익률" in normalized
    assert "Debt-To-Equity(부채비율) 0.06x (낮음)" in normalized
    assert "1,234억 원" in normalized
    assert "현금으로 돌아오는 힘" not in normalized
    assert "영업현금흐름(FCF)" not in normalized


def test_llm_output_postprocessing_applies_financial_language_normalizer() -> None:
    source = LLM_SOURCE.read_text(encoding="utf-8")

    assert "from src.utils.financial_formatting import normalize_financial_language" in source
    assert "normalize_financial_language" in source[source.index("def ensure_korean_default_texts") :]
    assert "Use exactly two decimals for x-ratios" in source
    assert "label the period and report period" in source
    assert "official financial terms" in source
    assert "조/억 원" in source


def test_buffett_prompt_includes_formatted_evidence_period_and_valuation_fallback() -> None:
    source = BUFFETT_SOURCE.read_text(encoding="utf-8")

    assert '"current_assets"' in source
    assert '"current_liabilities"' in source
    assert '"total_debt"' in source
    assert '"operating_cash_flow"' in source
    assert "build_buffett_evidence_summary" in source
    assert '"formatted_evidence"' in source
    assert '"period_note"' in source
    assert '"source_note"' in source
    assert '"valuation_summary"' in source
    assert "fallback_owner_earnings" in source
    assert "Free Cash Flow fallback" in source
    assert "Margin Of Safety(안전마진)" in source


def test_graham_output_keeps_decimal_graham_number_and_structured_metrics() -> None:
    source = GRAHAM_SOURCE.read_text(encoding="utf-8")

    assert '"graham_number": graham_number' in source
    assert '"current_price": current_price' in source
    assert '"margin_of_safety": margin_of_safety' in source
    assert '"period_note": _build_graham_period_note' in source
    assert '"source_note": _build_graham_source_note' in source
    assert "Current ratio = {current_ratio:.2f}x" in source
    assert "Copy Graham Number decimals exactly" in source
    assert "Graham Number(그레이엄 넘버)" in source


def test_agent_result_cards_expose_formula_tooltips_next_to_agent_name() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")

    assert "function AgentFormulaTooltip" in source
    assert "getAgentFormulaGuide" in source
    assert "Owner Earnings(소유자 이익)" in source
    assert "Margin Of Safety(안전마진)" in source
    assert "Graham Number(그레이엄 넘버)" in source
    assert "<AgentFormulaTooltip agentKey={result.agentKey} language={language} />" in source
