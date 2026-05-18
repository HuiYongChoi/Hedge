"""PBR band must enrich a sparse history from yfinance so US tickers don't
fall into the degenerate 'single_snapshot' branch when financialdatasets.ai
only returns one row."""

from __future__ import annotations

import unittest
from dataclasses import dataclass
from unittest import mock


@dataclass
class _StubMetric:
    """Minimal stand-in for FinancialMetrics — only the fields calculate_pbr_band reads."""
    price_to_book_ratio: float | None = None
    book_value_per_share: float | None = None
    report_period: str = ""


class CalculatePbrBandTests(unittest.TestCase):
    def test_single_snapshot_falls_back_to_yfinance_when_ticker_provided(self):
        """1 row of primary history + yfinance returns 5 quarters → percentile mode."""
        from src.agents.valuation import calculate_pbr_band

        sparse_metrics = [
            _StubMetric(price_to_book_ratio=11.28, book_value_per_share=15.97, report_period="2026-02-28"),
        ]
        # Mock the yfinance fallback to return 5 quarters of historical PBR data
        yf_series = [
            {"report_period": "2026-02-28", "price_to_book_ratio": 5.26, "book_value_per_share": 64.24},
            {"report_period": "2025-11-30", "price_to_book_ratio": 5.46, "book_value_per_share": 52.23},
            {"report_period": "2025-08-31", "price_to_book_ratio": 3.46, "book_value_per_share": 48.28},
            {"report_period": "2025-05-31", "price_to_book_ratio": 2.71, "book_value_per_share": 45.35},
            {"report_period": "2025-02-28", "price_to_book_ratio": 1.99, "book_value_per_share": 43.50},
        ]
        with mock.patch("src.tools.api._fetch_yfinance_pbr_history", return_value=yf_series):
            result = calculate_pbr_band(
                financial_metrics=sparse_metrics,
                current_price=337.70,
                shares_outstanding=1_190_000_000,
                revenue_growth=0.10,
                ticker="MU",
            )

        self.assertIsNotNone(result)
        # current PBR 5.26 lands at p75 (linear interp on [1.99,2.71,3.46,5.26,5.46])
        # → position_label is 'p50_p75', not the degenerate 'single_snapshot'.
        self.assertEqual(result["position_label"], "p50_p75")
        self.assertNotEqual(result["position_label"], "single_snapshot")
        self.assertEqual(result["history_source"], "yfinance")
        # bvps swapped to yfinance-derived value for internal consistency
        self.assertAlmostEqual(result["bvps"], 64.24, places=2)
        # percentile fields populated (not degenerate)
        self.assertNotEqual(result["percentiles"]["p10"], result["percentiles"]["p90"])

    def test_falls_through_to_single_snapshot_when_yfinance_empty(self):
        """If yfinance returns nothing, must still produce the legacy single_snapshot result."""
        from src.agents.valuation import calculate_pbr_band

        sparse_metrics = [
            _StubMetric(price_to_book_ratio=11.28, book_value_per_share=15.97, report_period="2026-02-28"),
        ]
        with mock.patch("src.tools.api._fetch_yfinance_pbr_history", return_value=[]):
            result = calculate_pbr_band(
                financial_metrics=sparse_metrics,
                current_price=180.0,
                shares_outstanding=1_190_000_000,
                revenue_growth=0.10,
                ticker="UNKNOWN",
            )

        self.assertIsNotNone(result)
        self.assertEqual(result["position_label"], "single_snapshot")
        self.assertEqual(result["history_source"], "snapshot")
        self.assertEqual(result["rerating_note"], "PBR 히스토리 부족 — 현재 PBR 스냅샷 기준")

    def test_skips_yfinance_fallback_when_history_already_sufficient(self):
        """If primary source already returned ≥4 PBR points, do NOT call yfinance."""
        from src.agents.valuation import calculate_pbr_band

        rich_metrics = [
            _StubMetric(price_to_book_ratio=1.5, book_value_per_share=100.0, report_period="2026-02-28"),
            _StubMetric(price_to_book_ratio=1.6, book_value_per_share=98.0, report_period="2025-11-30"),
            _StubMetric(price_to_book_ratio=1.4, book_value_per_share=95.0, report_period="2025-08-31"),
            _StubMetric(price_to_book_ratio=1.2, book_value_per_share=92.0, report_period="2025-05-31"),
            _StubMetric(price_to_book_ratio=1.3, book_value_per_share=90.0, report_period="2025-02-28"),
        ]
        with mock.patch("src.tools.api._fetch_yfinance_pbr_history") as mocked:
            result = calculate_pbr_band(
                financial_metrics=rich_metrics,
                current_price=150.0,
                shares_outstanding=1_000_000,
                revenue_growth=0.05,
                ticker="000660.KS",
            )
            mocked.assert_not_called()

        self.assertIsNotNone(result)
        self.assertEqual(result["history_source"], "primary")
        # bvps stays from primary source (100.0)
        self.assertAlmostEqual(result["bvps"], 100.0)

    def test_no_ticker_arg_skips_yfinance(self):
        """Backwards-compat: callers that omit `ticker` get the legacy snapshot path."""
        from src.agents.valuation import calculate_pbr_band

        sparse_metrics = [
            _StubMetric(price_to_book_ratio=2.0, book_value_per_share=50.0, report_period="2026-02-28"),
        ]
        with mock.patch("src.tools.api._fetch_yfinance_pbr_history") as mocked:
            result = calculate_pbr_band(
                financial_metrics=sparse_metrics,
                current_price=100.0,
                shares_outstanding=1_000_000,
                revenue_growth=0.10,
                # No ticker arg
            )
            mocked.assert_not_called()

        self.assertEqual(result["position_label"], "single_snapshot")


if __name__ == "__main__":
    unittest.main()
