from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOP_BAR = ROOT / "app/frontend/src/components/layout/top-bar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
TABS_CONTEXT = ROOT / "app/frontend/src/contexts/tabs-context.tsx"
WORKSPACE_PILL = ROOT / "app/frontend/src/components/layout/workspace-pill.tsx"
WORKSPACE_CONTEXT = ROOT / "app/frontend/src/contexts/workspace-context.tsx"
LANGUAGE_PREFERENCES = ROOT / "app/frontend/src/lib/language-preferences.ts"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_tabs_context_exposes_active_tab_and_type() -> None:
    source = _read(TABS_CONTEXT)

    assert "activeTab: Tab | null" in source
    assert "activeTabType: TabType | null" in source
    assert "const activeTab = activeTabId ? tabs.find" in source
    assert "const activeTabType = activeTab?.type ?? null" in source


def test_top_bar_gates_flow_panel_toggles_only() -> None:
    source = _read(TOP_BAR)

    assert "isFlowTab: boolean" in source
    assert "isFlowTab &&" in source
    gated_block = source[source.index("isFlowTab &&") : source.index("{/* Data Sandbox */}")]
    assert "PanelLeft" in gated_block
    assert "PanelBottom" in gated_block
    assert "PanelRight" in gated_block
    assert "bg-ramp-grey-700 mx-1" in gated_block


def test_layout_collapses_and_restores_flow_panel_state() -> None:
    source = _read(LAYOUT)

    assert "activeTabType" in source
    assert "const isFlowTab = activeTabType === 'flow'" in source
    assert "savedFlowPanelState" in source
    assert "setSavedFlowPanelState(prev => prev ?? {" in source
    assert "collapseBottomPanel();" in source
    assert "expandBottomPanel();" in source
    assert "const effectiveIsLeftCollapsed = isFlowTab ? isLeftCollapsed : true" in source
    assert "const effectiveIsRightCollapsed = isFlowTab ? isRightCollapsed : true" in source
    assert "const effectiveIsBottomCollapsed = isFlowTab ? isBottomCollapsed : true" in source
    assert "}, [activeTabType]);" in source


def test_layout_shortcuts_are_guarded_to_flow_tabs() -> None:
    source = _read(LAYOUT)

    assert "if (isFlowTab) setIsRightCollapsed" in source
    assert "if (isFlowTab) setIsLeftCollapsed" in source
    assert "if (isFlowTab) toggleBottomPanel" in source
    assert "isFlowTab={isFlowTab}" in source


def test_top_bar_navigation_is_labeled_and_not_disabled_without_flow_tab() -> None:
    source = _read(TOP_BAR)

    assert "t('mainHome', language)" in source
    assert "t('flows', language)" in source
    assert "t('dataSandbox', language)" in source
    assert "t('stockAnalysis', language)" in source
    assert "isOpeningFlow" in source
    assert "disabled={isOpeningFlow}" in source
    assert "disabled={!hasFlowTab || isFlowTabActive}" not in source
    assert "absolute top-0 right-0" not in source


def test_top_bar_main_home_menu_focuses_guide_without_closing_tabs() -> None:
    top_bar_source = _read(TOP_BAR)
    layout_source = _read(LAYOUT)
    tabs_source = _read(TABS_CONTEXT)
    language_source = _read(LANGUAGE_PREFERENCES)

    assert "House" in top_bar_source
    assert "onHomeClick: () => void" in top_bar_source
    assert "isHomeActive: boolean" in top_bar_source
    assert "aria-label=\"Open Main Home\"" in top_bar_source

    assert "focusHome" in layout_source
    assert "const isHomeActive = activeTabType === null" in layout_source
    assert "onHomeClick={focusHome}" in layout_source

    assert "focusHome: () => void" in tabs_source
    assert "const focusHome = useCallback(() => {" in tabs_source
    assert "setActiveTabId(null);" in tabs_source
    assert "setTabs([])" not in tabs_source[tabs_source.index("const focusHome = useCallback"):tabs_source.index("const value = {")]

    assert language_source.count("mainHome:") >= 2


def test_layout_keeps_tabs_workspace_and_navigation_in_one_header_rail() -> None:
    source = _read(LAYOUT)

    assert "const handleFlowClick = useCallback(async () => {" in source
    assert "flowService.getFlows()" in source
    assert "flowService.createDefaultFlow" in source
    assert "<WorkspacePill />" in source
    assert source.index("<WorkspacePill />") < source.index("<TopBar")
    assert "items-stretch gap-2 border-b bg-panel" in source
    assert "pr-2 transition-all duration-200" in source


def test_workspace_pill_only_appears_on_context_driven_tabs() -> None:
    source = _read(LAYOUT)

    assert "const showWorkspacePill = activeTabType === 'flow';" in source
    assert "contextDrivenTabTypes" not in source
    assert "'stock-search'" not in source[source.index("const showWorkspacePill") : source.index("const hasFlowTab")]
    assert "'data-sandbox'" not in source[source.index("const showWorkspacePill") : source.index("const hasFlowTab")]


def test_workspace_pill_hides_inactive_sandbox_state_and_scopes_to_flow() -> None:
    source = _read(WORKSPACE_PILL)

    assert source.count("<PillButton") == 3
    assert "title?: string" in source
    assert "플로우 노드의 워크스페이스 동기화가 켜진 경우에만 적용됩니다" in source
    assert "Data Sandbox 수정값이 실제로 적용 중일 때만 표시됩니다" in source
    assert "workspace.useDataSandboxOverrides && sandboxOverrideCount > 0" in source
    assert "'미사용'" not in source
    assert "'Off'" not in source


def test_workspace_pill_removes_agent_and_model_chip_dependencies() -> None:
    source = _read(WORKSPACE_PILL)

    assert "ModelSelector" not in source
    assert "from '@/data/agents'" not in source
    assert "from '@/data/models'" not in source
    assert "getAgents" not in source
    assert "getModels" not in source
    assert "Users" not in source
    assert "Cpu" not in source
    assert "setSelectedModel" not in source
    assert "workspace.selectedAgents" not in source
    assert "workspace.selectedModel" not in source


def test_workspace_context_is_left_intact_for_stock_search() -> None:
    source = _read(WORKSPACE_CONTEXT)

    assert "setSelectedAgents" in source
    assert "toggleAgent" in source
    assert "setSelectedModel" in source
    assert "selectedAgents" in source
    assert "selectedModel" in source


def test_removed_workspace_pill_i18n_keys_are_not_in_dictionary() -> None:
    source = _read(LANGUAGE_PREFERENCES)

    assert "agentsSelected:" not in source
    assert "workspaceModel:" not in source
    assert "noAgentsSelected:" not in source
    assert "selectAgentsInStockSearch:" not in source
