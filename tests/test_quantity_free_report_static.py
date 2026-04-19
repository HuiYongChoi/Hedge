from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
INVESTMENT_REPORT = ROOT / "app/frontend/src/nodes/components/investment-report-dialog.tsx"
REGULAR_OUTPUT = ROOT / "app/frontend/src/components/panels/bottom/tabs/regular-output.tsx"
PORTFOLIO_MANAGER = ROOT / "src/agents/portfolio_manager.py"


class QuantityFreeReportStaticTests(unittest.TestCase):
    def test_stock_search_final_decision_does_not_render_quantity(self):
        source = STOCK_TAB.read_text(encoding="utf-8")

        self.assertNotIn("Reference Qty", source)
        self.assertNotIn("참고 수량", source)
        self.assertNotIn("참고 주문 수량", source)
        self.assertNotIn("Reference order size", source)

    def test_investment_report_removes_quantity_column_and_summary_text(self):
        source = INVESTMENT_REPORT.read_text(encoding="utf-8")

        self.assertNotIn("quantityCol", source)
        self.assertNotIn("decision.quantity", source)
        self.assertNotIn("t('shares')", source)

    def test_regular_output_removes_trade_quantity_from_report_tables(self):
        source = REGULAR_OUTPUT.read_text(encoding="utf-8")

        self.assertNotIn("<TableHead>Quantity</TableHead>", source)
        self.assertNotIn("<TableCell>{decision.quantity || 0}</TableCell>", source)
        self.assertNotIn("<TableCell className=\"font-medium\">Quantity</TableCell>", source)

    def test_portfolio_manager_treats_quantity_as_schema_placeholder(self):
        source = PORTFOLIO_MANAGER.read_text(encoding="utf-8")

        self.assertIn("quantity is a schema-compatibility placeholder", source)
        self.assertIn("reasoning must not mention order quantity", source)
        self.assertNotIn("max qty", source)
        self.assertNotIn("최대 수량", source)


if __name__ == "__main__":
    unittest.main()
