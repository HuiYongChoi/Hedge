from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TAB_BAR = ROOT / "app/frontend/src/components/tabs/tab-bar.tsx"


def test_tab_bar_localizes_data_sandbox_title_in_korean_mode() -> None:
    source = TAB_BAR.read_text(encoding="utf-8")

    assert "tab.type === 'data-sandbox'" in source
    assert "t('dataSandbox', language)" in source
