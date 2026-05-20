from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"
LANGUAGE_PREFS = ROOT / "app/frontend/src/lib/language-preferences.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_sticky_analysis_header_component_exists_and_uses_core_metrics():
    src = read(V5_DIR / "sticky-analysis-header.tsx")

    assert "export function StickyAnalysisHeader" in src
    assert "sticky top-0" in src
    assert "targetMarginLabel" in src
    assert "targetWaccLabel" in src
    assert "stickyConfidenceLabel" in src
    assert "formatCurrency" in src
    assert "formatPercent" in src


def test_report_layout_mounts_sticky_header_before_existing_report_sections():
    src = read(V5_DIR / "report-layout.tsx")

    assert "import { StickyAnalysisHeader } from './sticky-analysis-header';" in src
    assert "<StickyAnalysisHeader" in src
    assert src.index("<StickyAnalysisHeader") < src.index("<TickerSwitcher")
    assert "isJapaneseTicker" in src


def test_sticky_header_i18n_keys_exist_in_ko_and_en():
    src = read(LANGUAGE_PREFS)

    assert "stickyConfidenceLabel: '신뢰도'" in src
    assert "stickyConfidenceLabel: 'Confidence'" in src
    assert "stickyPriceUnavailable: '현재가 없음'" in src
    assert "stickyPriceUnavailable: 'No price'" in src
