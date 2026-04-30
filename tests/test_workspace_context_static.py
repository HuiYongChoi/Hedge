from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_CONTEXT = ROOT / "app/frontend/src/contexts/workspace-context.tsx"
WORKSPACE_STORAGE = ROOT / "app/frontend/src/services/workspace-storage.ts"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"


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
