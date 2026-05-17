"""Regression test: valuation_analyst must emit top-level intrinsic_value
and margin_of_safety so the analyst-report sidebar can display the
'1주당 내재가치' and '안전마진' tiles for any ticker (not only when
warren_buffett or aswath_damodaran agents are included)."""

import unittest
from pathlib import Path


class ValuationTopLevelEmissionTests(unittest.TestCase):
    def test_valuation_emits_top_level_intrinsic_value_and_margin(self):
        src = (Path(__file__).resolve().parents[1] / "src" / "agents" / "valuation.py").read_text(encoding="utf-8")
        # The dict that writes valuation_analysis[ticker] must include both keys
        block_start = src.index("valuation_analysis[ticker] = {")
        block_end = src.index("}", block_start)
        block = src[block_start:block_end + 1]

        self.assertIn('"intrinsic_value": intrinsic_per_share_weighted', block,
                      "valuation_analysis[ticker] must include top-level intrinsic_value (per share, weighted)")
        self.assertIn('"margin_of_safety": weighted_gap', block,
                      "valuation_analysis[ticker] must include top-level margin_of_safety (weighted_gap)")

    def test_valuation_computes_weighted_intrinsic_before_emission(self):
        src = (Path(__file__).resolve().parents[1] / "src" / "agents" / "valuation.py").read_text(encoding="utf-8")
        self.assertIn("weighted_intrinsic_total", src)
        self.assertIn("intrinsic_per_share_weighted", src)


if __name__ == "__main__":
    unittest.main()
