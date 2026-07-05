from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_CONTEXT = ROOT / "app/frontend/src/contexts/workspace-context.tsx"
WORKSPACE_STORAGE = ROOT / "app/frontend/src/services/workspace-storage.ts"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
STOCK_SEARCH_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"


def test_workspace_context_and_storage_files_exist() -> None:
    assert WORKSPACE_CONTEXT.exists(), "workspace-context.tsx should be added"
    assert WORKSPACE_STORAGE.exists(), "workspace-storage.ts should be added"


def test_workspace_storage_uses_versioned_localstorage_key_and_serializes_sets() -> None:
    source = WORKSPACE_STORAGE.read_text(encoding="utf-8")

    assert "hedgefund.workspace.v1" in source
    assert "selectedAgents" in source
    assert "Array.from(workspace.selectedAgents)" in source
    assert "new Set(parsed.selectedAgents" in source


def test_workspace_context_exposes_patch_and_reset_actions() -> None:
    source = WORKSPACE_CONTEXT.read_text(encoding="utf-8")

    assert "createContext" in source
    assert "WorkspaceContextType" in source
    assert "patchWorkspace" in source
    assert "resetWorkspace" in source
    assert "setTickers" in source
    assert "setDateRange" in source
    assert "setSelectedModel" in source
    assert "setSelectedAgents" in source
    assert "setUseDataSandboxOverrides" in source


def test_layout_mounts_workspace_provider() -> None:
    source = LAYOUT.read_text(encoding="utf-8")

    assert "WorkspaceProvider" in source
    assert "<WorkspaceProvider>" in source
    assert "</WorkspaceProvider>" in source


def test_stock_search_tab_reads_input_state_from_workspace_context() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")

    assert "useWorkspace" in source
    assert "const { workspace" in source
    assert "const [selectedAgents, setSelectedAgents] = useState" not in source
    assert "const [selectedModel, setSelectedModel] = useState" not in source
    assert "const [tickers, setTickers] = useState" not in source
    assert "const [startDate, setStartDate] = useState" not in source
    assert "const [endDate, setEndDate] = useState" not in source
    assert "const [useDataSandboxOverrides, setUseDataSandboxOverrides] = useState" not in source


def test_stock_search_tab_persists_inputs_in_request_data_not_ui_state() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")
    serialize_source = source[source.index("function serializeStockAnalysisState") : source.index("function restoreStockAnalysisState")]

    assert "tickers:" not in serialize_source
    assert "startDate:" not in serialize_source
    assert "endDate:" not in serialize_source
    assert "selectedAgentKeys" not in serialize_source
    assert "selectedModel:" not in serialize_source
    assert "useDataSandboxOverrides" not in serialize_source
    assert "latestRun.request_data" in source


def test_stock_search_restores_display_input_before_canonical_code() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")

    assert "state.input_ticker === 'string'" in source
    assert "toDisplayTickerInput(rawTickers)" in source
    assert "input_ticker: tickerDisplayInput" in source
    assert "tickers: firstTicker ? [firstTicker] : []" in source
