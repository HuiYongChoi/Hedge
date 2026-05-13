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
    assert "10000%0%0%5%" in source
    assert "부채비율 5%" in source
    assert "Debt-To-Equity(부채비율) 5%" in source


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
