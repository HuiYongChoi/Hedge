from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "src/data/models.py"
API = ROOT / "src/tools/api.py"
DART = ROOT / "src/tools/dart_api.py"
LLM = ROOT / "src/utils/llm.py"
DAMODARAN = ROOT / "src/agents/aswath_damodaran.py"


class DataPipelineStandardizerStaticTests(unittest.TestCase):
    def test_financial_metrics_accepts_agent_required_raw_fields(self):
        source = MODELS.read_text(encoding="utf-8")

        self.assertIn('model_config = {"extra": "allow"}', source)
        for field in [
            "revenue",
            "gross_profit",
            "operating_income",
            "net_income",
            "free_cash_flow",
            "operating_cash_flow",
            "capital_expenditure",
            "depreciation_and_amortization",
            "interest_expense",
            "total_debt",
            "cash_and_equivalents",
            "outstanding_shares",
            "beta",
        ]:
            self.assertRegex(source, rf"\b{field}: float \| None = None")

    def test_api_builds_complete_metrics_payloads_before_pydantic_parse(self):
        source = API.read_text(encoding="utf-8")

        self.assertIn("DEFAULT_FINANCIAL_METRIC_FIELDS", source)
        self.assertIn("def _build_financial_metric", source)
        self.assertIn("standardize_financial_metric_payload", source)
        self.assertIn("FinancialMetrics(**_build_financial_metric", source)
        self.assertIn("payload.setdefault(field_name, None)", source)

    def test_line_items_are_standardized_and_requested_fields_are_materialized(self):
        source = API.read_text(encoding="utf-8")

        self.assertIn("standardize_line_items", source)
        self.assertRegex(
            source,
            re.compile(r"return standardize_line_items\(\s*search_results\[:limit\],\s*line_items", re.S),
        )
        for derived_field in [
            "gross_margin",
            "operating_margin",
            "debt_to_equity",
            "return_on_invested_capital",
            "goodwill_and_intangible_assets",
            "operating_expense",
            "owner_earnings",
        ]:
            self.assertIn(derived_field, source)

    def test_korean_dart_maps_innovation_and_cashflow_fields(self):
        source = DART.read_text(encoding="utf-8")

        for field in [
            "research_and_development",
            "operating_expense",
            "depreciation_and_amortization",
            "goodwill_and_intangible_assets",
        ]:
            self.assertIn(field, source)
        self.assertIn("연구개발비", source)
        self.assertIn("판매비와관리비", source)

    def test_damodaran_uses_line_item_fcff_revenue_and_interest_inputs(self):
        source = DAMODARAN.read_text(encoding="utf-8")

        self.assertIn('"revenue"', source)
        self.assertIn("fcff0 = getattr(latest_li, \"free_cash_flow\", None)", source)
        self.assertIn("revs = [li.revenue for li in reversed(line_items)", source)
        self.assertIn("interest = getattr(latest_li, \"interest_expense\", None)", source)

    def test_llm_enforces_no_complaint_no_hallucination_data_gap_policy(self):
        source = LLM.read_text(encoding="utf-8")

        self.assertIn("DATA_GAP_HANDLING_REQUIREMENT", source)
        self.assertIn("Do NOT write phrases like", source)
        self.assertIn("Never invent numbers", source)
        self.assertIn("N/A", source)
        self.assertIn("sanitize_data_gap_language", source)


if __name__ == "__main__":
    unittest.main()
