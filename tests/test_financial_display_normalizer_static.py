from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NORMALIZER = ROOT / "app/frontend/src/lib/financial-text-normalizer.ts"
MARKDOWN_BLOCKS = ROOT / "app/frontend/src/lib/markdown-blocks.tsx"
V5_HELPERS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts"
INLINE_CHIPS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/inline-data-chip.tsx"


def test_frontend_financial_text_normalizer_repairs_broken_debt_ratio_sequences() -> None:
    assert NORMALIZER.exists()
    source = NORMALIZER.read_text(encoding="utf-8")

    assert "normalizeFinancialDisplayText" in source
    assert "BROKEN_DEBT_PERCENT_SEQUENCE" in source
    assert "pickDebtPercent" in source
    assert "normalizeBrokenKoreanDecimalSeparators" in source
    assert "normalizeNestedDebtRatioLabels" in source
    assert "10000%0%0%5%" in source
    assert "이자부채비율 5%" in source
    assert "Debt-To-Equity(이자부채비율) 5%" in source


def test_all_report_render_paths_apply_financial_text_normalizer() -> None:
    markdown = MARKDOWN_BLOCKS.read_text(encoding="utf-8")
    helpers = V5_HELPERS.read_text(encoding="utf-8")
    inline = INLINE_CHIPS.read_text(encoding="utf-8")

    assert "from '@/lib/financial-text-normalizer'" in markdown
    assert "normalizeFinancialDisplayText(markdown)" in markdown
    assert "from '@/lib/financial-text-normalizer'" in helpers
    assert "normalizeFinancialDisplayText(extractReasoningText" in helpers
    assert "normalizeFinancialDisplayText(sectionText" in helpers
    assert "from '@/lib/financial-text-normalizer'" in inline
    assert "normalizeFinancialDisplayText(text)" in inline


def test_v5_marker_headings_do_not_rebuild_decimal_numbers_with_korean_sentence_endings() -> None:
    helpers = V5_HELPERS.read_text(encoding="utf-8")

    assert "findSafeHeadingBoundary" in helpers
    assert "isDecimalPoint" in helpers
    # deriveMarkerHeading 은 splitLeadSentenceHeading 으로 대체됐다(b7693d8) —
    # 첫 문장을 제목으로 올리면서 본문을 그대로 두어 제목=본문 중복이 나던 버그.
    # 지켜야 할 것은 이름이 아니라 '소수점에서 제목을 자르지 않는다'는 규칙이다.
    assert "deriveMarkerHeading" not in helpers
    assert "splitLeadSentenceHeading" in helpers
    assert "itemText.includes('다')" not in helpers
