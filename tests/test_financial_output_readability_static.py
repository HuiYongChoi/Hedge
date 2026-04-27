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

    assert "부채비율 (debt-to-equity) 0.47" in normalized
    assert "유동비율 (current ratio) 1.21x" in normalized
    assert "부채비율 (debt-to-equity) 0.12" in normalized
    assert "그레이엄 넘버 (Graham Number) 212.35" in normalized
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
    assert "부채비율 (debt-to-equity) 0.06 (낮음)" in normalized
    assert "1,234억 원" in normalized
    assert "현금으로 돌아오는 힘" not in normalized
    assert "영업현금흐름(FCF)" not in normalized


def test_financial_language_normalizer_handles_decimal_korean_won_amounts() -> None:
    from src.utils.financial_formatting import normalize_financial_language

    normalized = normalize_financial_language("시가총액 62,863,252,250.34원")

    assert normalized == "시가총액: 628억 원"
    assert ".34원" not in normalized


def test_financial_language_normalizer_rewrites_machine_style_report_terms() -> None:
    from src.utils.financial_formatting import normalize_financial_language

    raw = (
        "Margin Of Safety(안전마진), moat_strong=false, moat_score=4.44, "
        "predictability_score=0, flags.predictable=false, valuation_score=3.0, "
        "fcf_yield=0.0043, margin_of_safety_vs_fair_value=-0.936, reasonable_value=19593750000"
    )

    normalized = normalize_financial_language(raw)

    assert "안전마진 (margin of safety)" in normalized
    assert "moat_strong" not in normalized
    assert "predictability_score" not in normalized
    assert "valuation_score" not in normalized
    assert "해자 점수 4.4점" in normalized
    assert "예측가능성 낮음" in normalized
    assert "밸류에이션 점수 3.0점" in normalized
    assert "FCF 수익률 43%" in normalized
    assert "적정가 대비 -93.6%" in normalized
    assert "적정가 추정치" in normalized


def test_llm_output_postprocessing_applies_financial_language_normalizer() -> None:
    source = LLM_SOURCE.read_text(encoding="utf-8")

    assert "from src.utils.financial_formatting import normalize_financial_language" in source
    assert "normalize_financial_language" in source[source.index("def ensure_korean_default_texts") :]
    assert "Use exactly two decimals for x-ratios" in source
    assert "label the period and report period" in source
    assert "official financial terms" in source
    assert "조/억 원" in source
    assert "Do not expose raw snake_case field names" in source
    assert "Korean first with English in parentheses" in source
    assert "Start with the conclusion in the first paragraph" in source


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
    assert "안전마진 (margin of safety)" in source


def test_graham_output_keeps_decimal_graham_number_and_structured_metrics() -> None:
    source = GRAHAM_SOURCE.read_text(encoding="utf-8")

    assert '"graham_number": graham_number' in source
    assert '"current_price": current_price' in source
    assert '"margin_of_safety": margin_of_safety' in source
    assert '"period_note": _build_graham_period_note' in source
    assert '"source_note": _build_graham_source_note' in source
    assert "Current ratio = {current_ratio:.2f}x" in source
    assert "Copy Graham Number decimals exactly" in source
    assert "그레이엄 넘버 (Graham Number)" in source


def test_agent_result_cards_expose_formula_tooltips_next_to_agent_name() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")
    guide_source = (ROOT / "app/frontend/src/components/ui/agent-formula-tooltip.tsx").read_text(encoding="utf-8")

    assert "from '@/components/ui/agent-formula-tooltip'" in source
    assert "export function AgentFormulaTooltip" in guide_source
    assert "getAgentFormulaGuide" in guide_source
    assert "소유자 이익 (owner earnings)" in guide_source
    assert "안전마진 (margin of safety)" in guide_source
    assert "그레이엄 넘버 (Graham Number)" in guide_source
    assert "<AgentFormulaTooltip agentKey={result.agentKey} language={language} />" in source
