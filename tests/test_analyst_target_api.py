import unittest
from unittest.mock import patch, MagicMock
from src.tools.analyst_target_api import fetch_analyst_target, _CACHE


class AnalystTargetApiTests(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={"current_price": 125.5})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_returns_parsed_consensus(self, mock_get, _mock_yfinance):
        def side_effect(url, **_):
            mock = MagicMock(ok=True)
            if "consensus" in url:
                mock.json.return_value = [{"targetConsensus": 130, "targetHigh": 175, "targetLow": 80, "targetMedian": 128}]
            else:
                mock.json.return_value = [{"lastQuarter": 18}]
            return mock
        mock_get.side_effect = side_effect

        result = fetch_analyst_target("MU")
        self.assertEqual(result.consensus, 130)
        self.assertEqual(result.high, 175)
        self.assertEqual(result.low, 80)
        self.assertEqual(result.analyst_count, 18)
        self.assertEqual(result.current_price, 125.5)
        self.assertEqual(result.source, "FMP")

    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_returns_yfinance_fundamental_fields(self, mock_get, mock_yfinance):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp
        mock_yfinance.return_value = {
            "current_price": 130.0,
            "trailing_pe": 27.5,
            "trailing_eps": 4.73,
            "forward_eps": 6.2,
            "forward_pe": 21.0,
        }

        result = fetch_analyst_target("GOOGL")

        self.assertEqual(result.current_price, 130.0)
        self.assertEqual(result.trailing_pe, 27.5)
        self.assertEqual(result.trailing_eps, 4.73)
        self.assertEqual(result.forward_eps, 6.2)
        self.assertEqual(result.forward_pe, 21.0)

    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={})
    @patch("src.tools.analyst_target_api.requests.get", side_effect=Exception("boom"))
    def test_fetch_returns_stub_on_failure(self, _, _mock_yfinance):
        result = fetch_analyst_target("XYZ")
        self.assertIsNone(result.consensus)
        self.assertEqual(result.source, "stub")

    @patch("src.tools.analyst_target_api._fetch_yfinance_data", return_value={})
    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_uses_cache(self, mock_get, _mock_yfinance):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = [{"targetConsensus": 100}]
        mock_get.return_value = mock_resp

        fetch_analyst_target("MU")
        fetch_analyst_target("MU")
        # First call makes 2 HTTP requests (consensus + summary); second call is cached.
        self.assertLessEqual(mock_get.call_count, 2)


if __name__ == "__main__":
    unittest.main()
