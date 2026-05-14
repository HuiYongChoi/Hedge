import unittest
from unittest.mock import patch, MagicMock
from src.tools.analyst_target_api import fetch_analyst_target, _CACHE


class AnalystTargetApiTests(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_returns_parsed_consensus(self, mock_get):
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
        self.assertEqual(result.source, "FMP")

    @patch("src.tools.analyst_target_api.requests.get", side_effect=Exception("boom"))
    def test_fetch_returns_stub_on_failure(self, _):
        result = fetch_analyst_target("XYZ")
        self.assertIsNone(result.consensus)
        self.assertEqual(result.source, "stub")

    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_uses_cache(self, mock_get):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = [{"targetConsensus": 100}]
        mock_get.return_value = mock_resp

        fetch_analyst_target("MU")
        fetch_analyst_target("MU")
        # First call makes 3 HTTP requests (consensus + summary + quote); second call is cached
        self.assertLessEqual(mock_get.call_count, 3)


if __name__ == "__main__":
    unittest.main()
