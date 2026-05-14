from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "app/frontend/src/components/reports/analyst-report-v5/price-compass-bar.tsx"
SERVICE = ROOT / "app/frontend/src/services/analyst-target-service.ts"
SIDEBAR = ROOT / "app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx"
LANG = ROOT / "app/frontend/src/lib/language-preferences.ts"
BACKEND_ROUTE = ROOT / "app/backend/routes/analyst_targets.py"
BACKEND_TOOL = ROOT / "src/tools/analyst_target_api.py"


class PriceCompassBarStaticTests(unittest.TestCase):
    def test_component_exists(self):
        self.assertTrue(COMPONENT.exists())
        src = COMPONENT.read_text(encoding="utf-8")
        for needle in [
            "PriceCompassBar", "MarkerSpec", "betaBand", "pctFor",
            "editedPerFy0", "editedPerFy1",
            "pickFurthestAnnual", "fwdPerFy0", "fwdPerFy1",
            "fy0FiscalYear", "fy1FiscalYear",
        ]:
            self.assertIn(needle, src, needle)

    def test_canonical_metrics_extended(self):
        types_src = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/types.ts").read_text(encoding="utf-8")
        for needle in ["forwardEpsFy1", "forwardPeFy1", "fy0FiscalYear", "fy1FiscalYear"]:
            self.assertIn(needle, types_src, needle)
        helpers_src = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text(encoding="utf-8")
        for needle in ["forward_eps_fy1", "forward_pe_fy1", "fy0_fiscal_year", "fy1_fiscal_year"]:
            self.assertIn(needle, helpers_src, needle)

    def test_service_exists(self):
        self.assertTrue(SERVICE.exists())
        src = SERVICE.read_text(encoding="utf-8")
        self.assertIn("analystTargetService", src)
        self.assertIn("/analyst-targets/", src)

    def test_pcb_in_layout_not_sidebar(self):
        """v3: PriceCompassBar must be in report-layout, NOT imported in sidebar."""
        layout_src = LAYOUT.read_text(encoding="utf-8")
        self.assertIn("PriceCompassBar", layout_src, "layout must import PriceCompassBar")
        self.assertIn("metrics={canonicalMetrics}", layout_src, "layout must pass metrics to PriceCompassBar")
        sidebar_src = SIDEBAR.read_text(encoding="utf-8")
        self.assertNotIn("PriceCompassBar", sidebar_src, "sidebar must NOT render PriceCompassBar in v3")

    def test_pcb_responsive_grid(self):
        """v3: marker list uses responsive grid instead of space-y-1."""
        src = COMPONENT.read_text(encoding="utf-8")
        self.assertIn("sm:grid-cols-2", src, "responsive 2-col grid must be present")
        self.assertIn("lg:grid-cols-3", src, "responsive 3-col grid must be present")
        self.assertNotIn("space-y-1", src, "old space-y-1 list must be replaced by grid")

    def test_pcb_visual_polish(self):
        """v3: bar height h-16, glyph text-lg, container padding p-4."""
        src = COMPONENT.read_text(encoding="utf-8")
        self.assertIn("h-16", src, "bar track height must be h-16")
        self.assertIn("text-lg", src, "marker glyph must be text-lg")
        self.assertIn("p-4", src, "container padding must be p-4")

    def test_backend_endpoint(self):
        self.assertTrue(BACKEND_ROUTE.exists())
        src = BACKEND_ROUTE.read_text(encoding="utf-8")
        self.assertIn("analyst-targets", src)
        self.assertIn("def get_analyst_target", src)

    def test_tool_module(self):
        self.assertTrue(BACKEND_TOOL.exists())
        src = BACKEND_TOOL.read_text(encoding="utf-8")
        self.assertIn("fetch_analyst_target", src)
        self.assertIn("AnalystTarget", src)
        self.assertIn("price-target-consensus", src)

    def test_i18n_keys(self):
        src = LANG.read_text(encoding="utf-8")
        for key in [
            "pcbTitle", "pcbCurrent", "pcbDcf", "pcbMosBuy",
            "pcbConsensus", "pcbFwdPerFy0", "pcbFwdPerFyN",
            "pcbBetaBand", "pcbEditPer", "pcbResetPer", "pcbMissing",
        ]:
            self.assertIn(f"{key}:", src, key)


if __name__ == "__main__":
    unittest.main()
