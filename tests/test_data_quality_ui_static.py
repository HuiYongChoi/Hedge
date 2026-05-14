"""Static tests: data quality frontend helpers and i18n keys."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPERS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts"
LANG = ROOT / "app/frontend/src/lib/language-preferences.ts"


class DataQualityUIStaticTests(unittest.TestCase):
    def test_helpers_export_isinsufficient_and_format(self):
        src = HELPERS.read_text(encoding="utf-8")
        self.assertIn("isInsufficient", src)
        self.assertIn("formatScoreOrDash", src)
        self.assertIn("dataCoverageLabel", src)

    def test_i18n_keys_added(self):
        src = LANG.read_text(encoding="utf-8")
        for key in [
            "dataInsufficient",
            "scoreOnHold",
            "dataCoverageLabel",
            "nullScoreTooltip",
            "verdictOnHold",
            "targetDataCoverageLow",
        ]:
            self.assertIn(key, src, f"Missing i18n key: {key}")


if __name__ == "__main__":
    unittest.main()
