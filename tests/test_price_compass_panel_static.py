from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPERS = ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
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
        self.assertIn("effectiveMetrics", src)
        self.assertIn("metrics={effectiveMetrics}", src)

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
        self.assertIn("width: '112px'", src, "single-state card width should be fixed at 112px")
        self.assertIn("minHeight: '60px'", src, "single-state card min height should be compact")
        self.assertIn("isHovered", src)
        self.assertIn("onHoverChange", src)
        self.assertIn("shadow-lg", src, "hover should only add visual emphasis")
        for needle in ["shortName", "broker.target_price", "upside"]:
            self.assertIn(needle, src, needle)
        for removed in ["min-w-[180px]", "EXPANDED VIEW", "trailingPe", "trailingEps", "forwardEps"]:
            self.assertNotIn(removed, src, removed)

    def test_beta_frame_has_slider(self):
        src = BETA.read_text(encoding="utf-8")
        self.assertIn('type="range"', src)
        self.assertIn("simBeta", src)
        self.assertIn("onSimBetaChange", src)

    def test_opinion_distribution_components(self):
        src = OPINION.read_text(encoding="utf-8")
        for needle in ["distribution.buy", "distribution.hold", "distribution.neutral",
                       "distribution.sell", "distribution.average", "distribution.median",
                       "distribution.stdev"]:
            self.assertIn(needle, src, needle)

    def test_service_has_broker_types(self):
        src = SERVICE.read_text(encoding="utf-8")
        for needle in ["BrokerTarget", "TargetDistribution", "brokers:", "distribution:",
                       "beta:", "sigma_annual:", "current_fy_eps:", "currency:"]:
            self.assertIn(needle, src, needle)

    def test_backend_response_includes_new_fields(self):
        src = BACKEND_ROUTE.read_text(encoding="utf-8")
        for needle in ['"beta":', '"sigma_annual":', '"brokers":', '"distribution":', '"current_fy_eps":', '"currency":']:
            self.assertIn(needle, src, needle)

    def test_tool_module_has_new_helpers(self):
        """v5: yfinance-only helpers. FMP helpers gone. JP helpers added."""
        src = BACKEND_TOOL.read_text(encoding="utf-8")
        for needle in ["BrokerTarget", "TargetDistribution", "_fetch_yfinance_analyst",
                       "_fetch_beta_sigma_yf", "_compute_distribution_v5",
                       "_compute_ttm_eps_from_quarterly", "_fetch_current_fy_eps",
                       "_fetch_fnguide_consensus", "_fetch_naver_current_price",
                       "_is_japanese_ticker", "_yahoo_japan_symbol"]:
            self.assertIn(needle, src, needle)

    def test_i18n_keys_present(self):
        src = LANG.read_text(encoding="utf-8")
        for key in ["pcpTitle", "pcpSubtitle", "pcpLegendBear", "pcpLegendBull",
                    "pcpBetaFrameTitle", "pcpOpinionTitle", "pcpBrokerGridTitle",
                    "pcpSignalBuy", "pcpSignalSell", "pcpNoBrokers",
                    "pcpPerTtm", "pcpEpsTtm", "pcpFwdEps", "pcpEpsCurFy", "pcpPerCurFy",
                    "pcpHighTarget", "pcpTtmHelp", "pcpCurFyHelp", "pcpFwdHelp", "pcpTargetsHelp"]:
            self.assertIn(f"{key}:", src, key)

    def test_fundamentals_row_in_header(self):
        """v5.1: repeated fundamentals move from broker cards to the panel header."""
        src = INDEX.read_text(encoding="utf-8")
        for needle in ["FundamentalsRow", "pcpPerTtm", "pcpEpsTtm",
                       "pcpEpsCurFy", "pcpFwdEps", "pcpHighTarget",
                       "currentFyEps", "highTarget"]:
            self.assertIn(needle, src, needle)

    def test_fundamentals_row_groups_related_eps_and_per(self):
        """EPS/PER pairs should be vertically grouped for scanability."""
        src = INDEX.read_text(encoding="utf-8")
        self.assertIn("FundamentalsGroup", src)
        self.assertRegex(src, r"const ttmItems[\s\S]*pcpEpsTtm[\s\S]*pcpPerTtm")
        self.assertRegex(src, r"const currentFyItems[\s\S]*pcpEpsCurFy[\s\S]*pcpPerCurFy")
        self.assertRegex(src, r"const forwardItems[\s\S]*pcpFwdEps[\s\S]*pcpBrokerFwdPer")
        self.assertIn("pcpGroupTargets", src)

    def test_fundamentals_groups_have_hover_help_badges(self):
        """Each fundamentals group should expose a visible ! hover explanation."""
        src = INDEX.read_text(encoding="utf-8")
        self.assertIn("help:", src)
        self.assertIn('title={help}', src)
        self.assertIn('aria-label={help}', src)
        self.assertIn(">!<", src)
        for key in ["pcpTtmHelp", "pcpCurFyHelp", "pcpFwdHelp", "pcpTargetsHelp"]:
            self.assertIn(key, src, key)

    def test_sigma_labels_are_larger_and_white(self):
        """Bar sigma labels and dollar labels should be white and easier to read."""
        src = BAR.read_text(encoding="utf-8")
        self.assertIn("text-sm font-bold text-white", src)
        self.assertIn("text-xs font-semibold text-white/85", src)
        self.assertIn("font-mono text-sm font-bold text-white", src)

    def test_currency_flows_through_price_compass(self):
        """KRX tickers must render KRW instead of hard-coded dollars."""
        index_src = INDEX.read_text(encoding="utf-8")
        utils_src = UTILS.read_text(encoding="utf-8")
        self.assertIn("currency={currency}", index_src)
        self.assertIn("formatMoney", index_src)
        self.assertIn("₩", utils_src)
        for path in [BAR, CARD, GRID, OPINION, BETA]:
            src = path.read_text(encoding="utf-8")
            self.assertIn("currency", src, f"{path.name} must accept currency")
            self.assertIn("formatMoney", src, f"{path.name} must format money via currency")

    def test_no_per_eps_in_cards(self):
        """v5.1: broker cards/grid must not repeat ticker-level PER/EPS labels."""
        for path in [CARD, GRID]:
            src = path.read_text(encoding="utf-8")
            for removed in ["PER (TTM)", "EPS (TTM)", "FWD EPS"]:
                self.assertNotIn(removed, src, f"{path.name}: {removed}")

    # ── v5 new tests ────────────────────────────────────────────────────────────

    def test_no_fmp_references_remain(self):
        """v5: all FMP code must be purged from the backend tool."""
        src = BACKEND_TOOL.read_text(encoding="utf-8")
        self.assertNotIn("financialmodelingprep", src.lower(),
                         "FMP base URL must not appear in v5 code")
        self.assertNotIn("_FMP_", src,
                         "_FMP_ constants must be removed in v5")

    def test_current_price_marker_is_vertical_line(self):
        """v5: current price marker must be a vertical line, not a white circle."""
        src = BAR.read_text(encoding="utf-8")
        # New marker uses w-[2px] and h-12
        self.assertIn("w-[2px]", src, "current price marker must be a 2px-wide vertical line")
        self.assertIn("h-12", src, "current price line must extend 48px (h-12) through bar")
        # Old white circle must be gone
        self.assertNotIn("h-3 w-3 rounded-full bg-white",
                         src, "old white circle marker must be removed in v5")

    def test_readable_text_sizes(self):
        """v5: all panel components must use legible text sizes (text-sm/text-xs/text-base)."""
        files_to_check = [BAR, CARD, GRID, OPINION, BETA, INDEX]
        for path in files_to_check:
            src = path.read_text(encoding="utf-8")
            has_readable = (
                "text-sm" in src or
                "text-xs" in src or
                "text-base" in src
            )
            self.assertTrue(
                has_readable,
                f"{path.name} must contain at least one of text-sm/text-xs/text-base"
            )


    # ── Phase J2 new tests ───────────────────────────────────────────────────────

    def test_japanese_helpers_present_in_tool(self):
        """Phase J2-A: Yahoo JP scraper helpers exist in backend tool."""
        src = BACKEND_TOOL.read_text(encoding="utf-8")
        for needle in ["_fetch_yahoo_japan_brokers", "YAHOO_JP_RATING_MAP",
                       "_normalize_yahoo_jp_signal", "_days_ago_from_jp_date"]:
            self.assertIn(needle, src, needle)

    def test_citation_regex_includes_japanese_report(self):
        """Phase J2-B: citation 'a' regex covers 有価証券報告書."""
        src = HELPERS.read_text(encoding="utf-8")
        self.assertIn("有価証券報告書", src)
        self.assertIn("有報", src)
        self.assertIn("isJapaneseTicker", src)

    def test_stock_search_tab_has_edinet_link(self):
        """Phase J2-B: stock-search-tab.tsx exposes EDINET link for JP tickers."""
        src = STOCK_TAB.read_text(encoding="utf-8")
        self.assertIn("isJapaneseStock", src)
        self.assertIn("EDINET", src)
        # UI now uses Korean label (per user preference: no Japanese in UI)
        self.assertIn("유가증권보고서", src)


if __name__ == "__main__":
    unittest.main()
