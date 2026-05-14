from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PANEL_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5/price-compass-panel"
INDEX = PANEL_DIR / "index.tsx"
BAR = PANEL_DIR / "broker-target-bar.tsx"
CALLOUTS = PANEL_DIR / "broker-callouts-row.tsx"
CARD = PANEL_DIR / "broker-callout-card.tsx"
BETA = PANEL_DIR / "beta-volatility-frame.tsx"
OPINION = PANEL_DIR / "opinion-distribution.tsx"
GRID = PANEL_DIR / "broker-detail-grid.tsx"
STACK = PANEL_DIR / "stacking-layout.ts"
TYPES = PANEL_DIR / "types.ts"
UTILS = PANEL_DIR / "utils.ts"
SERVICE = ROOT / "app/frontend/src/services/analyst-target-service.ts"
LAYOUT = ROOT / "app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx"
LANG = ROOT / "app/frontend/src/lib/language-preferences.ts"
BACKEND_ROUTE = ROOT / "app/backend/routes/analyst_targets.py"
BACKEND_TOOL = ROOT / "src/tools/analyst_target_api.py"
OLD_BAR = ROOT / "app/frontend/src/components/reports/analyst-report-v5/price-compass-bar.tsx"


class PriceCompassPanelStaticTests(unittest.TestCase):
    def test_old_bar_file_deleted(self):
        self.assertFalse(OLD_BAR.exists(), "price-compass-bar.tsx must be removed in v4")

    def test_panel_directory_layout(self):
        for path in [INDEX, BAR, CALLOUTS, CARD, BETA, OPINION, GRID, STACK, TYPES, UTILS]:
            self.assertTrue(path.exists(), f"missing {path.name}")

    def test_layout_wires_panel(self):
        src = LAYOUT.read_text(encoding="utf-8")
        self.assertIn("PriceCompassPanel", src)
        self.assertNotIn("PriceCompassBar", src, "old bar reference must be gone")
        self.assertIn("metrics={canonicalMetrics}", src)

    def test_bar_gradient_low_to_high(self):
        """Bar gradient must run green (cheap, left) → red (expensive, right)."""
        src = BAR.read_text(encoding="utf-8")
        self.assertIn("from-emerald", src, "bar must start green on the left")
        self.assertIn("to-rose", src, "bar must end red on the right")
        self.assertIn("bg-gradient-to-r", src)
        self.assertIn("h-9", src, "bar must be visibly thick")
        self.assertIn("rounded-full", src)
        self.assertIn("shadow-inner", src)

    def test_callouts_use_stacking(self):
        callouts_src = CALLOUTS.read_text(encoding="utf-8")
        stack_src = STACK.read_text(encoding="utf-8")
        self.assertIn("stackCallouts", callouts_src)
        self.assertIn("export function stackCallouts", stack_src)
        self.assertIn("rowIndex", stack_src)
        self.assertIn("minPctGap", stack_src)

    def test_card_default_and_hover_states(self):
        src = CARD.read_text(encoding="utf-8")
        # Collapsed identifiers
        self.assertIn("96", src, "collapsed width 96px should be referenced")
        # Hover identifiers
        self.assertIn("isHovered", src)
        self.assertIn("onHoverChange", src)
        # Detail fields shown on hover (camelCase props, checked after lowercasing)
        for needle in ["fwd_pe", "trailingpe", "trailingeps", "upside"]:
            self.assertIn(needle, src.lower(), needle)

    def test_beta_frame_has_slider(self):
        src = BETA.read_text(encoding="utf-8")
        self.assertIn('type="range"', src)
        self.assertIn("simBeta", src)
        self.assertIn("onSimBetaChange", src)

    def test_opinion_distribution_components(self):
        src = OPINION.read_text(encoding="utf-8")
        for needle in ["distribution.buy", "distribution.hold", "distribution.neutral", "distribution.sell", "distribution.average", "distribution.median", "distribution.stdev"]:
            self.assertIn(needle, src, needle)

    def test_service_has_broker_types(self):
        src = SERVICE.read_text(encoding="utf-8")
        for needle in ["BrokerTarget", "TargetDistribution", "brokers:", "distribution:", "beta:", "sigma_annual:"]:
            self.assertIn(needle, src, needle)

    def test_backend_response_includes_new_fields(self):
        src = BACKEND_ROUTE.read_text(encoding="utf-8")
        for needle in ['"beta":', '"sigma_annual":', '"brokers":', '"distribution":']:
            self.assertIn(needle, src, needle)

    def test_tool_module_has_new_helpers(self):
        src = BACKEND_TOOL.read_text(encoding="utf-8")
        for needle in ["BrokerTarget", "TargetDistribution", "_fetch_brokers_fmp", "_fetch_beta_sigma_yf", "_compute_distribution"]:
            self.assertIn(needle, src, needle)

    def test_i18n_keys_present(self):
        src = LANG.read_text(encoding="utf-8")
        for key in ["pcpTitle", "pcpSubtitle", "pcpLegendBear", "pcpLegendBull",
                    "pcpBetaFrameTitle", "pcpOpinionTitle", "pcpBrokerGridTitle",
                    "pcpSignalBuy", "pcpSignalSell", "pcpNoBrokers"]:
            self.assertIn(f"{key}:", src, key)


if __name__ == "__main__":
    unittest.main()
