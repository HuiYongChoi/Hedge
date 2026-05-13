from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
TABS_CTX = ROOT / "app/frontend/src/contexts/tabs-context.tsx"
TOP_BAR = ROOT / "app/frontend/src/components/layout/top-bar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
WORKSPACE_PILL = ROOT / "app/frontend/src/components/layout/workspace-pill.tsx"
LANG_PREFS = ROOT / "app/frontend/src/lib/language-preferences.ts"


class TopBarPolishStaticTests(unittest.TestCase):

    # ── Part A: Flow nav icon ────────────────────────────────────────────────

    def test_tabs_context_exposes_flow_tabs(self):
        src = TABS_CTX.read_text(encoding="utf-8")
        self.assertIn("flowTabs: Tab[]", src)
        self.assertIn("flowTabs = tabs.filter(tab => tab.type === 'flow')", src)

    def test_tabs_context_exposes_focus_first_flow_tab(self):
        src = TABS_CTX.read_text(encoding="utf-8")
        self.assertIn("focusFirstFlowTab: () => void", src)
        self.assertIn("const focusFirstFlowTab = useCallback(", src)

    def test_tabs_context_value_includes_new_keys(self):
        src = TABS_CTX.read_text(encoding="utf-8")
        value_block = src[src.index("const value = {"):]
        self.assertIn("flowTabs,", value_block)
        self.assertIn("focusFirstFlowTab,", value_block)

    def test_top_bar_imports_workflow_icon(self):
        src = TOP_BAR.read_text(encoding="utf-8")
        self.assertIn("Workflow", src)
        self.assertIn("from 'lucide-react'", src)

    def test_top_bar_props_include_new_flow_props(self):
        src = TOP_BAR.read_text(encoding="utf-8")
        self.assertIn("hasFlowTab: boolean", src)
        self.assertIn("isFlowTabActive: boolean", src)
        self.assertIn("onFlowClick: () => void", src)

    def test_top_bar_renders_workflow_button(self):
        src = TOP_BAR.read_text(encoding="utf-8")
        self.assertIn("<Workflow size={16}", src)
        self.assertIn('disabled={!hasFlowTab || isFlowTabActive}', src)
        self.assertIn('aria-label="Focus flow tab"', src)

    def test_layout_wires_flow_props(self):
        src = LAYOUT.read_text(encoding="utf-8")
        self.assertIn("focusFirstFlowTab", src)
        self.assertIn("flowTabs", src)
        self.assertIn("hasFlowTab={hasFlowTab}", src)
        self.assertIn("isFlowTabActive={isFlowTab}", src)
        self.assertIn("onFlowClick={focusFirstFlowTab}", src)

    # ── Part B: WorkspacePill text cleanup ──────────────────────────────────

    def test_workspace_pill_label_span_removed(self):
        src = WORKSPACE_PILL.read_text(encoding="utf-8")
        # The standalone label span should be gone
        self.assertNotIn("'종목 분석'", src)
        self.assertNotIn("'Stock analysis'", src)
        self.assertNotIn(">종목 분석<", src)
        self.assertNotIn(">Stock analysis<", src)

    def test_workspace_pill_has_group_container(self):
        src = WORKSPACE_PILL.read_text(encoding="utf-8")
        self.assertIn('role="group"', src)
        self.assertIn("종목 분석 컨텍스트", src)
        self.assertIn("Stock analysis context", src)

    def test_pill_button_no_max_width_no_truncate(self):
        src = WORKSPACE_PILL.read_text(encoding="utf-8")
        self.assertNotIn("max-w-[220px]", src)
        self.assertNotIn('"truncate', src)
        self.assertIn("whitespace-nowrap", src)

    def test_sandbox_pill_uses_sandbox_label_key(self):
        src = WORKSPACE_PILL.read_text(encoding="utf-8")
        self.assertIn("t('sandboxLabel', language)", src)
        self.assertIn("sandboxValueLabel", src)

    def test_use_data_sandbox_overrides_key_preserved(self):
        src = WORKSPACE_PILL.read_text(encoding="utf-8")
        self.assertIn("t('useDataSandboxOverrides', language)", src)

    def test_sandbox_label_i18n_ko(self):
        src = LANG_PREFS.read_text(encoding="utf-8")
        self.assertIn("sandboxLabel: '샌드박스'", src)

    def test_sandbox_label_i18n_en(self):
        src = LANG_PREFS.read_text(encoding="utf-8")
        self.assertIn("sandboxLabel: 'Sandbox'", src)

    def test_use_data_sandbox_overrides_key_still_in_lang(self):
        src = LANG_PREFS.read_text(encoding="utf-8")
        self.assertIn("useDataSandboxOverrides: 'Data Sandbox 수정값 사용'", src)
        self.assertIn("useDataSandboxOverrides: 'Use Data Sandbox overrides'", src)


if __name__ == "__main__":
    unittest.main()
