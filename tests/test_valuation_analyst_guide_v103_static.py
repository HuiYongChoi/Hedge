from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TAB_CONTENT = ROOT / "app/frontend/src/components/tabs/tab-content.tsx"
AGENT_FORMULA_TOOLTIP = ROOT / "app/frontend/src/components/ui/agent-formula-tooltip.tsx"
AGENT_FORMULAS = ROOT / "app/frontend/src/data/agent-formulas.ts"
REPORT_HELPERS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts"


def _slice_between(source: str, start_marker: str, end_marker: str) -> str:
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    return source[start:end]


def test_main_scoring_guide_describes_v103_valuation_models() -> None:
    source = TAB_CONTENT.read_text(encoding="utf-8")
    block = _slice_between(source, "nameEn: 'Valuation Analyst'", "\n  },\n];")

    for expected in (
        "EBITDA 정규화",
        "ROIC−WACC EVA",
        "PBR Band",
        "Justified PBR",
        "DCF: 24%",
        "DCF: 16%",
        "ROIC−WACC EVA: 10%",
    ):
        assert expected in block


def test_formula_tooltip_describes_valuation_v103_models() -> None:
    source = AGENT_FORMULA_TOOLTIP.read_text(encoding="utf-8")
    block = _slice_between(source, "valuation_analyst: {", "\n  default:")

    for expected in (
        "Normalized EBITDA",
        "EBITDA 정규화",
        "ROIC−WACC EVA",
        "ROIC - WACC",
        "PBR Band",
        "Justified PBR",
    ):
        assert expected in block


def test_formula_drilldown_axes_include_v103_valuation_models() -> None:
    source = AGENT_FORMULAS.read_text(encoding="utf-8")
    block = _slice_between(source, "'Valuation Analyst': {", "\n  'Technical Analyst':")

    for expected in (
        "EBITDA 정규화",
        "Normalized EBITDA",
        "ROIC−WACC EVA",
        "Residual Income / PBR",
        "Justified PBR",
    ):
        assert expected in block


def test_report_agent_meta_uses_full_valuation_analyst_name() -> None:
    source = REPORT_HELPERS.read_text(encoding="utf-8")

    assert (
        "valuation_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', "
        "nameKo: '가치평가 분석가', nameEn: 'Valuation Analyst' }"
    ) in source
