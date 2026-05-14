import unittest
from unittest.mock import patch, MagicMock
from src.tools.analyst_target_api import (
    fetch_analyst_target, _CACHE, _compute_distribution, BrokerTarget
)


class AnalystTargetApiTests(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    def _make_mock_get(self, consensus_val=130, summary_val=18):
        def side_effect(url, **_):
            mock = MagicMock(ok=True)
            if "price-target-consensus" in url:
                mock.json.return_value = [{"targetConsensus": consensus_val, "targetHigh": 175, "targetLow": 80, "targetMedian": 128}]
            elif "price-target-summary" in url:
                mock.json.return_value = [{"lastQuarter": summary_val}]
            elif "grades-consensus" in url:
                mock.json.return_value = [{"strongBuy": 2, "buy": 1, "hold": 1, "sell": 0, "strongSell": 0}]
            elif "price-target" in url:
                mock.json.return_value = []
            else:
                mock.json.return_value = []
            return mock
        return side_effect

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.5, 0.21))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={"current_price": 125.5, "trailing_pe": 27.5, "trailing_eps": 4.73, "forward_eps": 6.2, "forward_pe": 21.0, "beta": 1.5})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_returns_parsed_consensus(self, mock_get, _yf, _bs):
        mock_get.side_effect = self._make_mock_get()
        result = fetch_analyst_target("MU")
        self.assertEqual(result.consensus, 130)
        self.assertEqual(result.high, 175)
        self.assertEqual(result.low, 80)
        self.assertEqual(result.analyst_count, 18)
        self.assertEqual(result.current_price, 125.5)
        self.assertEqual(result.source, "FMP")
        # distribution from grades-consensus
        self.assertIsNotNone(result.distribution)
        self.assertEqual(result.distribution.buy, 3)   # strongBuy=2 + buy=1
        self.assertEqual(result.distribution.hold, 1)

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.5, 0.21))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={"current_price": 130.0, "trailing_pe": 27.5, "trailing_eps": 4.73, "forward_eps": 6.2, "forward_pe": 21.0})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_returns_yfinance_fundamental_fields(self, mock_get, _yf, _bs):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp
        result = fetch_analyst_target("GOOGL")
        self.assertEqual(result.current_price, 130.0)
        self.assertEqual(result.trailing_pe, 27.5)
        self.assertEqual(result.forward_eps, 6.2)

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={})
    @patch("src.tools.analyst_target_api.requests.get", side_effect=Exception("boom"))
    def test_fetch_returns_stub_on_failure(self, _, _yf, _bs):
        result = fetch_analyst_target("XYZ")
        self.assertIsNone(result.consensus)
        self.assertEqual(result.source, "stub")
        self.assertEqual(result.brokers, [])
        self.assertIsNone(result.distribution)

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.0, 0.14))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_uses_cache(self, mock_get, _yf, _bs):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp

        fetch_analyst_target("MU")
        first_count = mock_get.call_count
        fetch_analyst_target("MU")
        self.assertEqual(mock_get.call_count, first_count, "second call must hit cache")

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.92, 0.269))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={"current_price": 800.0})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_brokers_parsed(self, mock_get, _yf, _bs):
        """Per-broker targets are parsed and grouped by company."""
        from datetime import date
        today_str = date.today().isoformat()

        def side_effect(url, **_):
            mock = MagicMock(ok=True)
            if "price-target-consensus" in url:
                mock.json.return_value = [{"targetConsensus": 880}]
            elif "price-target-summary" in url:
                mock.json.return_value = [{"lastQuarter": 2}]
            elif "grades-consensus" in url:
                mock.json.return_value = []
            elif "price-target" in url:
                mock.json.return_value = [
                    {"gradingCompany": "Citi", "priceTarget": 720, "newGrade": "Sell", "publishedDate": today_str},
                    {"gradingCompany": "Citi", "priceTarget": 700, "newGrade": "Sell", "publishedDate": "2026-01-01"},
                    {"gradingCompany": "JPMorgan", "priceTarget": 830, "newGrade": "Neutral", "publishedDate": today_str},
                ]
            else:
                mock.json.return_value = []
            return mock
        mock_get.side_effect = side_effect

        result = fetch_analyst_target("MU")
        self.assertEqual(len(result.brokers), 2)
        names = {b.name for b in result.brokers}
        self.assertIn("Citi", names)
        self.assertIn("JPMorgan", names)
        citi = next(b for b in result.brokers if b.name == "Citi")
        self.assertEqual(citi.target_price, 720)   # most recent, not 700
        self.assertEqual(citi.signal, "SELL")
        self.assertEqual(citi.days_ago, 0)

    def test_compute_distribution_from_brokers(self):
        brokers = [
            BrokerTarget("A", 100, "BUY", "2026-01-01", 10),
            BrokerTarget("B", 90, "SELL", "2026-01-01", 10),
            BrokerTarget("C", 95, "HOLD", "2026-01-01", 10),
            BrokerTarget("D", 110, "BUY", "2026-01-01", 10),
        ]
        dist = _compute_distribution(brokers)
        self.assertIsNotNone(dist)
        self.assertEqual(dist.buy, 2)
        self.assertEqual(dist.sell, 1)
        self.assertEqual(dist.hold, 1)
        self.assertEqual(dist.total, 4)
        self.assertAlmostEqual(dist.average, 98.75, places=1)

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_new_fields_present_in_result(self, mock_get, _yf, _bs):
        """beta, sigma_annual, brokers, distribution attributes exist."""
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp
        result = fetch_analyst_target("TEST")
        self.assertTrue(hasattr(result, "beta"))
        self.assertTrue(hasattr(result, "sigma_annual"))
        self.assertTrue(hasattr(result, "brokers"))
        self.assertTrue(hasattr(result, "distribution"))
        self.assertIsInstance(result.brokers, list)

    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_backend_route_fields(self, mock_get, _yf, _bs):
        """Route serialization has all new keys."""
        from app.backend.routes.analyst_targets import get_analyst_target
        import asyncio
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp
        response = asyncio.run(get_analyst_target("MU"))
        for key in ["beta", "sigma_annual", "brokers", "distribution"]:
            self.assertIn(key, response, key)


if __name__ == "__main__":
    unittest.main()
