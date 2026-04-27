from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
TICKER_INPUT = ROOT / "app/frontend/src/components/ui/ticker-input.tsx"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
DATA_SANDBOX_TAB = ROOT / "app/frontend/src/components/tabs/data-sandbox-tab.tsx"
TAB_CONTENT = ROOT / "app/frontend/src/components/tabs/tab-content.tsx"


class TickerInputTabActivationStaticTests(unittest.TestCase):
    def test_ticker_input_autocomplete_requires_active_tab_and_explicit_enable(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("isActive?: boolean;", source)
        self.assertIn("isActive = true", source)
        self.assertIn("const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);", source)
        self.assertIn("const showDropdown = isActive", source)
        self.assertIn("&& autocompleteEnabled", source)

    def test_ticker_input_enables_after_focus_or_tab_reactivation(self):
        source = TICKER_INPUT.read_text(encoding="utf-8")

        self.assertIn("const hasMountedRef = useRef(false);", source)
        self.assertIn("if (!isActive) {", source)
        self.assertIn("setAutocompleteEnabled(false);", source)
        self.assertIn("if (hasMountedRef.current) {", source)
        self.assertIn("setAutocompleteEnabled(true);", source)
        self.assertIn("onFocus={() => {", source)

    def test_tab_content_injects_active_state_into_each_tab_instance(self):
        source = TAB_CONTENT.read_text(encoding="utf-8")

        self.assertIn("cloneElement", source)
        self.assertIn("isTabActive: isActive", source)
        self.assertIn("tabId: tab.id", source)

    def test_stock_search_passes_active_tab_state_into_ticker_input(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertIn("interface StockSearchTabProps", source)
        self.assertIn("isTabActive?: boolean;", source)
        self.assertIn("export function StockSearchTab({ isTabActive = true", source)
        self.assertIn("isActive={isTabActive}", source)

    def test_data_sandbox_passes_active_tab_state_into_ticker_input(self):
        source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

        self.assertIn("interface DataSandboxTabProps", source)
        self.assertIn("isTabActive?: boolean;", source)
        self.assertIn("export function DataSandboxTab({ isTabActive = true", source)
        self.assertIn("isActive={isTabActive}", source)


if __name__ == "__main__":
    unittest.main()
