import unittest
from unittest.mock import patch
from src.tools.analyst_target_api import (
    fetch_analyst_target, _CACHE, _compute_distribution_v5, BrokerTarget
)


class AnalystTargetApiTests(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    # ── Phase A: helper stubs ──────────────────────────────────────────────────

    _FUND_BASE = {
        "current_price": 125.5,
        "trailing_pe": 27.5,
        "trailing_eps": 4.73,
        "forward_eps": 6.2,
        "forward_pe": 21.0,
        "beta": 1.5,
    }

    _AN_BASE = {
        "consensus": 130.0,
        "high": 175.0,
        "low": 80.0,
        "median": 128.0,
        "analyst_count": 18,
        "brokers": [],
        "rec_summary_row": {"strongBuy": 2, "buy": 1, "hold": 1, "sell": 0, "strongSell": 0},
    }

    # ── Tests ──────────────────────────────────────────────────────────────────

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.5, 0.21))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_fetch_returns_parsed_consensus(self, mock_fund, _bs, mock_an):
        mock_fund.return_value = self._FUND_BASE.copy()
        mock_an.return_value = self._AN_BASE.copy()
        result = fetch_analyst_target("MU")
        self.assertEqual(result.consensus, 130.0)
        self.assertEqual(result.high, 175.0)
        self.assertEqual(result.low, 80.0)
        self.assertEqual(result.analyst_count, 18)
        self.assertEqual(result.current_price, 125.5)
        self.assertEqual(result.source, "yfinance")
        self.assertIsNotNone(result.distribution)
        self.assertEqual(result.distribution.buy, 3)   # strongBuy=2 + buy=1
        self.assertEqual(result.distribution.hold, 1)

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.5, 0.21))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_fetch_returns_yfinance_fundamental_fields(self, mock_fund, _bs, mock_an):
        mock_fund.return_value = {"current_price": 130.0, "trailing_pe": 27.5, "trailing_eps": 4.73, "forward_eps": 6.2, "forward_pe": 21.0}
        mock_an.return_value = {**self._AN_BASE, "brokers": [], "rec_summary_row": None, "consensus": None}
        result = fetch_analyst_target("GOOGL")
        self.assertEqual(result.current_price, 130.0)
        self.assertEqual(result.trailing_pe, 27.5)
        self.assertEqual(result.forward_eps, 6.2)

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_fetch_returns_stub_on_failure(self, mock_fund, _bs, mock_an):
        mock_fund.return_value = {}
        mock_an.return_value = {
            "consensus": None, "high": None, "low": None, "median": None,
            "analyst_count": None, "brokers": [], "rec_summary_row": None,
        }
        result = fetch_analyst_target("XYZ")
        self.assertIsNone(result.consensus)
        self.assertEqual(result.source, "stub")
        self.assertEqual(result.brokers, [])
        self.assertIsNone(result.distribution)

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.0, 0.14))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_fetch_uses_cache(self, mock_fund, _bs, mock_an):
        mock_fund.return_value = {}
        mock_an.return_value = {**self._AN_BASE, "brokers": []}

        fetch_analyst_target("MU")
        first_fund_count = mock_fund.call_count
        first_an_count = mock_an.call_count
        fetch_analyst_target("MU")
        self.assertEqual(mock_fund.call_count, first_fund_count, "second call must hit cache (fund)")
        self.assertEqual(mock_an.call_count, first_an_count, "second call must hit cache (an)")

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.92, 0.269))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_fetch_brokers_parsed(self, mock_fund, _bs, mock_an):
        """Per-broker targets are returned and grouped by firm."""
        from datetime import date
        today_str = date.today().isoformat()

        mock_fund.return_value = {"current_price": 800.0}
        mock_an.return_value = {
            "consensus": 880.0,
            "high": 900.0,
            "low": 700.0,
            "median": 870.0,
            "analyst_count": 2,
            "brokers": [
                BrokerTarget("Citi", 720.0, "SELL", today_str, 0),
                BrokerTarget("JPMorgan", 830.0, "NEUTRAL", today_str, 0),
            ],
            "rec_summary_row": None,
        }

        result = fetch_analyst_target("MU")
        self.assertEqual(len(result.brokers), 2)
        names = {b.name for b in result.brokers}
        self.assertIn("Citi", names)
        self.assertIn("JPMorgan", names)
        citi = next(b for b in result.brokers if b.name == "Citi")
        self.assertEqual(citi.target_price, 720.0)
        self.assertEqual(citi.signal, "SELL")

    def test_compute_distribution_v5_from_brokers(self):
        brokers = [
            BrokerTarget("A", 100, "BUY", "2026-01-01", 10),
            BrokerTarget("B", 90, "SELL", "2026-01-01", 10),
            BrokerTarget("C", 95, "HOLD", "2026-01-01", 10),
            BrokerTarget("D", 110, "BUY", "2026-01-01", 10),
        ]
        dist = _compute_distribution_v5(brokers, rec_summary=None, consensus=None)
        self.assertIsNotNone(dist)
        self.assertEqual(dist.buy, 2)
        self.assertEqual(dist.sell, 1)
        self.assertEqual(dist.hold, 1)
        self.assertEqual(dist.total, 4)
        self.assertAlmostEqual(dist.average, 98.75, places=1)

    def test_compute_distribution_v5_rec_summary_dominates(self):
        """rec_summary 있으면 broker 집계보다 우선, avg는 broker prices로 계산."""
        brokers = [
            BrokerTarget("Evercore", 365.0, "BUY", "2026-05-14", 1),
            BrokerTarget("Wedbush",  400.0, "BUY", "2026-05-08", 7),
            BrokerTarget("UBS",      296.0, "HOLD", "2026-05-01", 14),
        ]
        rec = {"strongBuy": 7, "buy": 24, "hold": 15, "sell": 1, "strongSell": 1}
        dist = _compute_distribution_v5(brokers, rec_summary=rec, consensus=310.0)
        self.assertEqual(dist.buy, 31)       # 7 + 24
        self.assertEqual(dist.sell, 2)       # 1 + 1
        self.assertEqual(dist.total, 48)     # 31 + 15 + 0 + 2
        self.assertAlmostEqual(dist.average, (365 + 400 + 296) / 3, places=1)

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_new_fields_present_in_result(self, mock_fund, _bs, mock_an):
        """beta, sigma_annual, brokers, distribution attributes exist."""
        mock_fund.return_value = {}
        mock_an.return_value = {
            "consensus": None, "high": None, "low": None, "median": None,
            "analyst_count": None, "brokers": [], "rec_summary_row": None,
        }
        result = fetch_analyst_target("TEST")
        self.assertTrue(hasattr(result, "beta"))
        self.assertTrue(hasattr(result, "sigma_annual"))
        self.assertTrue(hasattr(result, "brokers"))
        self.assertTrue(hasattr(result, "distribution"))
        self.assertIsInstance(result.brokers, list)

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_backend_route_fields(self, mock_fund, _bs, mock_an):
        """Route serialization has all required keys."""
        from app.backend.routes.analyst_targets import get_analyst_target
        import asyncio
        mock_fund.return_value = {}
        mock_an.return_value = {
            "consensus": None, "high": None, "low": None, "median": None,
            "analyst_count": None, "brokers": [], "rec_summary_row": None,
        }
        response = asyncio.run(get_analyst_target("MU"))
        for key in ["beta", "sigma_annual", "brokers", "distribution"]:
            self.assertIn(key, response, key)

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.5, 0.21))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_returns_brokers_and_distribution(self, mock_fund, _bs, mock_an):
        """Full integration: brokers + distribution populated from yfinance."""
        mock_fund.return_value = {
            "current_price": 300.0, "trailing_pe": 36.0, "trailing_eps": 8.0,
            "forward_pe": 31.0, "forward_eps": 9.5, "beta": 1.2,
        }
        mock_an.return_value = {
            "consensus": 310.0, "high": 400.0, "low": 215.0, "median": 305.0,
            "analyst_count": 48,
            "brokers": [
                BrokerTarget("Evercore", 365.0, "BUY", "2026-05-14", 1),
                BrokerTarget("Wedbush",  400.0, "BUY", "2026-05-08", 7),
                BrokerTarget("UBS",      296.0, "HOLD", "2026-05-01", 14),
            ],
            "rec_summary_row": {"strongBuy": 7, "buy": 24, "hold": 15, "sell": 1, "strongSell": 1},
        }
        result = fetch_analyst_target("AAPL")
        self.assertEqual(result.source, "yfinance")
        self.assertEqual(len(result.brokers), 3)
        self.assertEqual(result.distribution.buy, 31)   # strongBuy + buy
        self.assertEqual(result.distribution.sell, 2)   # sell + strongSell
        self.assertEqual(result.distribution.total, 48)
        self.assertAlmostEqual(result.distribution.average, (365 + 400 + 296) / 3, places=1)


if __name__ == "__main__":
    unittest.main()
