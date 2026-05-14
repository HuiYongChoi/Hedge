"""Static tests: Munger analyze_predictability returns score=None when insufficient."""
import unittest
from src.agents.charlie_munger import analyze_predictability, make_munger_facts_bundle


class MungerNullScoreTests(unittest.TestCase):
    def test_predictability_returns_none_when_insufficient(self):
        res = analyze_predictability([])
        self.assertIsNone(res["score"])

    def test_predictability_returns_none_with_few_items(self):
        class _FakeLI:
            revenue = 100.0
            operating_income = None
            operating_margin = None
            free_cash_flow = None
        res = analyze_predictability([_FakeLI(), _FakeLI()])  # only 2, need 4
        self.assertIsNone(res["score"])

    def test_make_facts_bundle_handles_none_pred(self):
        analysis = {
            "predictability_analysis": {"score": None, "details": "데이터 부족"},
            "moat_analysis": {"score": 7.0, "max_score": 10, "details": "moat ok"},
            "management_analysis": {"score": 6.0, "max_score": 10, "details": "mgmt ok"},
            "valuation_analysis": {
                "score": 5.0, "max_score": 10, "details": "val ok",
                "intrinsic_value_range": {},
            },
        }
        bundle = make_munger_facts_bundle(analysis)
        self.assertIn("데이터 부족", bundle.get("예측가능성 점수", ""))
        self.assertEqual(bundle["핵심 체크"]["예측가능성"], "보류")


if __name__ == "__main__":
    unittest.main()
