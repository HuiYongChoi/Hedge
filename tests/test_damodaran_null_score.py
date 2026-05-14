"""Static tests: Damodaran sub-analyses return score=None when data is insufficient."""
import unittest
from src.agents.aswath_damodaran import (
    analyze_growth_and_reinvestment,
    analyze_risk_profile,
    analyze_relative_valuation,
)


class DamodaranNullScoreTests(unittest.TestCase):
    def test_growth_returns_insufficient_when_no_history(self):
        res = analyze_growth_and_reinvestment(metrics=[], line_items=[])
        self.assertIsNone(res["score"])
        self.assertEqual(res["data_quality"], "insufficient")
        self.assertIn("보류", res["details"])

    def test_risk_returns_insufficient_when_empty(self):
        res = analyze_risk_profile(metrics=[], line_items=[])
        self.assertIsNone(res["score"])
        self.assertEqual(res["data_quality"], "insufficient")

    def test_relative_val_returns_insufficient_short_history(self):
        class _FakeM:
            price_to_earnings_ratio = 15.0
        res = analyze_relative_valuation([_FakeM()])
        self.assertIsNone(res["score"])
        self.assertEqual(res["data_quality"], "insufficient")


if __name__ == "__main__":
    unittest.main()
