from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
LANGUAGE_PREFERENCES = ROOT / "app/frontend/src/lib/language-preferences.ts"
WORKSPACE_CONTEXT = ROOT / "app/frontend/src/contexts/workspace-context.tsx"
WORKSPACE_PILL = ROOT / "app/frontend/src/components/layout/workspace-pill.tsx"
WORKSPACE_SYNC = ROOT / "app/frontend/src/hooks/use-workspace-sync.ts"
STOCK_ANALYZER_NODE = ROOT / "app/frontend/src/nodes/components/stock-analyzer-node.tsx"


def test_workspace_pill_and_sync_files_exist() -> None:
    assert WORKSPACE_PILL.exists(), "workspace-pill.tsx should be added"
    assert WORKSPACE_SYNC.exists(), "use-workspace-sync.ts should be added"


def test_layout_mounts_workspace_pill_next_to_tab_bar() -> None:
    source = LAYOUT.read_text(encoding="utf-8")

    assert "WorkspacePill" in source
    assert "<WorkspacePill />" in source
    assert "<TabBar" in source


def test_language_preferences_include_workspace_pill_labels() -> None:
    source = LANGUAGE_PREFERENCES.read_text(encoding="utf-8")

    for key in [
        "activeTicker",
        "period",
        "workspaceSync",
        "workspaceSyncOn",
        "workspaceSyncOff",
    ]:
        assert f"{key}:" in source

    for removed_key in [
        "agentsSelected",
        "workspaceModel",
        "noAgentsSelected",
        "selectAgentsInStockSearch",
    ]:
        assert f"{removed_key}:" not in source


def test_workspace_context_stabilizes_actions_with_usecallback() -> None:
    source = WORKSPACE_CONTEXT.read_text(encoding="utf-8")

    assert "useCallback" in source
    assert "const setTickers = useCallback" in source
    assert "const patchWorkspace = useCallback" in source
    assert "const value = useMemo<WorkspaceContextType>" in source


def test_stock_analyzer_node_uses_workspace_sync_and_bind_toggle() -> None:
    source = STOCK_ANALYZER_NODE.read_text(encoding="utf-8")

    assert "useWorkspaceSync" in source
    assert "bindToWorkspace" in source
    assert "setBindToWorkspace" in source


def test_workspace_sync_hook_patches_workspace_and_updates_node_fields() -> None:
    source = WORKSPACE_SYNC.read_text(encoding="utf-8")

    assert "patchWorkspace" in source
    assert "setNodeTickers" in source
    assert "setNodeStartDate" in source
    assert "setNodeEndDate" in source


def test_workspace_pill_exposes_data_sandbox_override_toggle() -> None:
    source = WORKSPACE_PILL.read_text(encoding="utf-8")

    assert "setUseDataSandboxOverrides" in source
    assert "loadDataSandboxOverrideSnapshot" in source
    assert "DATA_SANDBOX_OVERRIDES_EVENT" in source
    assert "dataSandboxOverridesAvailable" in source


def test_workspace_pill_displays_company_name_before_code() -> None:
    source = WORKSPACE_PILL.read_text(encoding="utf-8")

    assert "getTickerDisplayName" in source
    assert "displayName === resolvedTicker" in source
    assert "`${displayName} · ${resolvedTicker}`" in source
