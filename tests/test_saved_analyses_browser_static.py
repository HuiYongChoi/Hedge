from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
TAB = ROOT / "app/frontend/src/components/tabs/saved-analyses-tab.tsx"
DIR = ROOT / "app/frontend/src/components/saved-analyses"
SERVICE = ROOT / "app/frontend/src/services/saved-analyses-service.ts"
TABS_CTX = ROOT / "app/frontend/src/contexts/tabs-context.tsx"
TAB_SERVICE = ROOT / "app/frontend/src/services/tab-service.ts"
TOP_BAR = ROOT / "app/frontend/src/components/layout/top-bar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
TAB_BAR = ROOT / "app/frontend/src/components/tabs/tab-bar.tsx"
LANG = ROOT / "app/frontend/src/lib/language-preferences.ts"
BACKEND_ROUTE = ROOT / "app/backend/routes/saved_analyses.py"
BACKEND_REPO = ROOT / "app/backend/repositories/saved_analysis_repository.py"


class SavedAnalysesBrowserStaticTests(unittest.TestCase):
    def test_new_tab_component_exists(self):
        self.assertTrue(TAB.exists())
        for fname in [
            'saved-list-panel.tsx',
            'saved-list-row.tsx',
            'saved-filters-bar.tsx',
            'saved-detail-panel.tsx',
            'saved-stock-detail.tsx',
            'saved-sandbox-detail.tsx',
            'saved-empty-state.tsx',
            'helpers.ts',
        ]:
            self.assertTrue((DIR / fname).exists(), fname)

    def test_tab_type_extended(self):
        src = TABS_CTX.read_text(encoding='utf-8')
        self.assertIn("'saved-analyses'", src)

    def test_tab_service_has_saved_analyses(self):
        src = TAB_SERVICE.read_text(encoding='utf-8')
        self.assertIn("createSavedAnalysesTab", src)
        self.assertIn("SavedAnalysesTab", src)

    def test_top_bar_has_saved_analyses_button(self):
        src = TOP_BAR.read_text(encoding='utf-8')
        self.assertIn("onSavedAnalysesClick", src)
        self.assertIn("Archive", src)

    def test_layout_wires_saved_analyses_handler(self):
        src = LAYOUT.read_text(encoding='utf-8')
        self.assertIn("handleSavedAnalysesClick", src)
        self.assertIn("createSavedAnalysesTab", src)

    def test_tab_bar_icon_and_title(self):
        src = TAB_BAR.read_text(encoding='utf-8')
        self.assertIn("'saved-analyses'", src)
        self.assertIn("savedAnalyses", src)

    def test_service_has_filter_and_delete(self):
        src = SERVICE.read_text(encoding='utf-8')
        self.assertIn("listAnalyses", src)
        self.assertIn("deleteAnalysis", src)
        self.assertIn("source_tab", src)
        self.assertIn("created_from", src)

    def test_i18n_keys_added(self):
        src = LANG.read_text(encoding='utf-8')
        for key in [
            'savedAnalyses',
            'savedAnalysesEmpty',
            'restoreToTab',
            'exportJson',
            'filterSource',
            'filterSourceStock',
            'filterSourceSandbox',
            'filterTicker',
            'filterFrom',
            'filterTo',
            'confirmDelete',
            'savedDetailEmpty',
        ]:
            self.assertIn(f"{key}:", src, key)

    def test_backend_delete_endpoint(self):
        src = BACKEND_ROUTE.read_text(encoding='utf-8')
        self.assertIn('@router.delete', src)
        self.assertIn('delete_saved_analysis', src)

    def test_backend_filter_query_params(self):
        src = BACKEND_ROUTE.read_text(encoding='utf-8')
        self.assertIn('source_tab: Optional[str]', src)
        self.assertIn('ticker: Optional[str]', src)
        self.assertIn('created_from', src)
        self.assertIn('created_to', src)
        self.assertIn('X-Total-Count', src)

    def test_repository_has_delete_and_count(self):
        src = BACKEND_REPO.read_text(encoding='utf-8')
        self.assertIn('def delete', src)
        self.assertIn('def count', src)


if __name__ == "__main__":
    unittest.main()
