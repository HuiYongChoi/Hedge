from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
QUALITY_BUY_TAB = ROOT / "app/frontend/src/components/tabs/quality-buy-tab.tsx"


class QualityBuyTabStaticTests(unittest.TestCase):

    def test_result_row_shows_current_price(self):
        """스캐너가 돌려주는 price_per_share 를 화면에 '현재가'로 보여 준다."""
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("formatPrice(result.value.price_per_share ?? null, result.market)", src)
        self.assertIn("'현재가'", src)


if __name__ == "__main__":
    unittest.main()
