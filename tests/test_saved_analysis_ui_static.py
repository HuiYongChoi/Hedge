from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_SANDBOX_TAB = ROOT / "app/frontend/src/components/tabs/data-sandbox-tab.tsx"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"


def test_data_sandbox_tab_wires_explicit_save_to_db_action() -> None:
    source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

    assert "savedAnalysisService.saveAnalysis" in source
    assert "saveToDbButton" in source
    assert "savedToDbSuccess" in source
    assert "savedToDbError" in source
    assert "'data_sandbox'" in source or '"data_sandbox"' in source
    assert "metricsOverrides" in source
    assert "lineItemsOverrides" in source
    assert "selectedModel" in source
    assert "startDate" in source
    assert "endDate" in source
    assert "Array.from(agentResults.values())" in source
    assert "completeResult" in source


def test_stock_analysis_tab_wires_explicit_save_to_db_action() -> None:
    source = STOCK_TAB.read_text(encoding="utf-8")

    assert "savedAnalysisService.saveAnalysis" in source
    assert "useToastManager" in source
    assert "saveToDbButton" in source
    assert "savedToDbSuccess" in source
    assert "savedToDbError" in source
    assert "'stock_analysis'" in source or '"stock_analysis"' in source
    assert "selectedAgents" in source
    assert "selectedModel" in source
    assert "startDate" in source
    assert "endDate" in source
    assert "Array.from(agentResults.values())" in source
    assert "completeResult" in source
