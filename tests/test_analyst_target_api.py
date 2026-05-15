import unittest
from unittest.mock import patch
from src.tools.analyst_target_api import (
    fetch_analyst_target, _CACHE, _compute_distribution_v5, _fetch_fnguide_consensus,
    _fetch_naver_current_price, BrokerTarget
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
        "current_fy_eps": 58.11,
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
        self.assertEqual(result.current_fy_eps, 58.11)
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
            "analyst_count": None, "current_fy_eps": None, "brokers": [], "rec_summary_row": None,
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
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(1.0, 0.14))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_fetch_force_refresh_bypasses_cache(self, mock_fund, _bs, mock_an):
        mock_fund.side_effect = [
            {"current_price": 100.0},
            {"current_price": 110.0},
        ]
        mock_an.return_value = {**self._AN_BASE, "brokers": []}

        first = fetch_analyst_target("MU")
        second = fetch_analyst_target("MU", force_refresh=True)

        self.assertEqual(first.current_price, 100.0)
        self.assertEqual(second.current_price, 110.0)
        self.assertEqual(mock_fund.call_count, 2)

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
            "current_fy_eps": 58.11,
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
            "analyst_count": None, "current_fy_eps": None, "brokers": [], "rec_summary_row": None,
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
            "analyst_count": None, "current_fy_eps": None, "brokers": [], "rec_summary_row": None,
        }
        response = asyncio.run(get_analyst_target("MU", refresh=True))
        for key in ["beta", "sigma_annual", "brokers", "distribution", "current_fy_eps"]:
            self.assertIn(key, response, key)
        self.assertIn("currency", response)

    @patch("src.tools.analyst_target_api.requests.get")
    def test_fnguide_consensus_parses_korean_broker_targets(self, mock_get):
        """FnGuide broker table fills Korean per-broker target list."""
        html = """
        <html><body>
        <table class="us_table_ty1 h_fix">
          <tr><th>추정기관</th><th>추정일자</th><th>적정주가</th><th>투자의견</th></tr>
          <tr><th>적정주가</th><th>직전 적정주가</th><th>증감율</th><th>투자의견</th><th>직전 투자의견</th></tr>
          <tr><td>Consensus</td><td></td><td>2,003,200</td><td>1,564,800</td><td>28.02</td><td>4.00</td><td>3.96</td></tr>
          <tr><td>현대차증권</td><td>2026/05/13</td><td>2,650,000</td><td>1,650,000</td><td>60.61</td><td>4.00</td><td>4.00</td></tr>
          <tr><td>BNK투자증권</td><td>2026/05/12</td><td>1,850,000</td><td>1,300,000</td><td>42.31</td><td>3.00</td><td>3.00</td></tr>
          <tr><td>SK증권</td><td>2026/05/07</td><td>3,000,000</td><td>2,000,000</td><td>50.00</td><td>5.00</td><td>4.00</td></tr>
        </table>
        </body></html>
        """

        class Resp:
            ok = True
            text = html

        mock_get.return_value = Resp()

        result = _fetch_fnguide_consensus("000660.KS")

        self.assertEqual(result["consensus"], 2003200.0)
        self.assertEqual(result["high"], 3000000.0)
        self.assertEqual(result["low"], 1850000.0)
        self.assertEqual(result["analyst_count"], 3)
        self.assertEqual(len(result["brokers"]), 3)
        self.assertEqual(result["brokers"][0].name, "현대차증권")
        self.assertEqual(result["brokers"][0].target_price, 2650000.0)
        self.assertEqual(result["brokers"][0].signal, "BUY")

    @patch("src.tools.analyst_target_api.requests.get")
    def test_naver_current_price_parses_korean_quote(self, mock_get):
        """Naver Finance current quote fills Korean current_price when yfinance misses."""
        html = """
        <html><body>
          <p class="no_today"><span class="blind">1,901,000</span></p>
        </body></html>
        """

        class Resp:
            ok = True
            text = html
            encoding = "EUC-KR"

        mock_get.return_value = Resp()

        self.assertEqual(_fetch_naver_current_price("000660.KS"), 1901000.0)

    @patch("src.tools.analyst_target_api._fetch_fnguide_consensus")
    @patch("src.tools.analyst_target_api._fetch_naver_current_price", return_value=1895000.0)
    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(2.03, 0.67))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_korean_ticker_prefers_fnguide_brokers_and_krw_currency(self, mock_fund, _bs, mock_an, _naver, mock_fg):
        mock_fund.return_value = {"trailing_pe": 40.5, "trailing_eps": 46765.0}
        mock_an.return_value = {
            "consensus": 1946076.9, "high": 3100000.0, "low": 1030000.0, "median": 1850000.0,
            "analyst_count": 38,
            "current_fy_eps": 294399.22,
            "brokers": [],
            "rec_summary_row": {"strongBuy": 16, "buy": 20, "hold": 2, "sell": 0, "strongSell": 0},
        }
        mock_fg.return_value = {
            "consensus": 2003200.0,
            "high": 3000000.0,
            "low": 1850000.0,
            "median": 2650000.0,
            "analyst_count": 3,
            "trailing_pe": 33.52,
            "forward_pe": 6.01,
            "brokers": [
                BrokerTarget("현대차증권", 2650000.0, "BUY", "2026-05-13", 2),
                BrokerTarget("BNK투자증권", 1850000.0, "HOLD", "2026-05-12", 3),
            ],
        }

        result = fetch_analyst_target("000660.KS")

        self.assertEqual(result.currency, "KRW")
        self.assertEqual(result.source, "fnguide+naver+yfinance")
        self.assertEqual(len(result.brokers), 2)
        self.assertEqual(result.consensus, 2003200.0)
        self.assertEqual(result.high, 3100000.0)
        self.assertEqual(result.trailing_pe, 33.52)
        self.assertAlmostEqual(result.trailing_eps, 56533.4, places=1)
        self.assertEqual(result.forward_pe, 6.01)
        self.assertAlmostEqual(result.forward_eps, 315307.8, places=1)

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
            "current_fy_eps": 58.11,
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

    def test_ttm_eps_quarterly_fallback(self):
        """info에 trailingEps 없으면 quarterly_income_stmt 4분기 Diluted EPS 합 사용."""
        from src.tools.analyst_target_api import _compute_ttm_eps_from_quarterly
        import pandas as pd

        class MockTicker:
            @property
            def quarterly_income_stmt(self):
                return pd.DataFrame({
                    "2026-02-28": [12.07, 13.785e9],
                    "2025-11-30": [4.60, 5.24e9],
                    "2025-08-31": [2.83, 3.201e9],
                    "2025-05-31": [1.68, 1.885e9],
                }, index=["Diluted EPS", "Net Income"])

        result = _compute_ttm_eps_from_quarterly(MockTicker())
        self.assertAlmostEqual(result, 21.18, places=1)

    def test_current_fy_eps_extracted(self):
        """earnings_estimate 0y avg → current_fy_eps."""
        from src.tools.analyst_target_api import _fetch_current_fy_eps
        import pandas as pd

        class MockTicker:
            @property
            def earnings_estimate(self):
                return pd.DataFrame(
                    {
                        "avg": [18.97, 22.57, 58.11, 101.78],
                        "low": [7.53, 7.68, 28.42, 70.77],
                        "high": [21.05, 26.90, 64.37, 142.48],
                    },
                    index=["0q", "+1q", "0y", "+1y"],
                )

        result = _fetch_current_fy_eps(MockTicker())
        self.assertAlmostEqual(result, 58.11, places=2)


class JapaneseTickerTests(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    def test_is_japanese_ticker_with_dot_t(self):
        from src.tools.analyst_target_api import _is_japanese_ticker
        self.assertTrue(_is_japanese_ticker("7203.T"))
        self.assertTrue(_is_japanese_ticker("6758.T"))
        self.assertTrue(_is_japanese_ticker("9984.T"))

    def test_is_japanese_ticker_with_4digit_code(self):
        from src.tools.analyst_target_api import _is_japanese_ticker
        self.assertTrue(_is_japanese_ticker("7203"))
        self.assertTrue(_is_japanese_ticker("6758"))

    def test_is_japanese_ticker_negative(self):
        from src.tools.analyst_target_api import _is_japanese_ticker
        self.assertFalse(_is_japanese_ticker("AAPL"))
        self.assertFalse(_is_japanese_ticker("005930"))    # 6자리 → 한국
        self.assertFalse(_is_japanese_ticker("005930.KS")) # 한국
        self.assertFalse(_is_japanese_ticker(""))
        self.assertFalse(_is_japanese_ticker("MSFT"))

    def test_yahoo_japan_symbol_normalization(self):
        from src.tools.analyst_target_api import _yahoo_japan_symbol
        self.assertEqual(_yahoo_japan_symbol("7203"),   "7203.T")
        self.assertEqual(_yahoo_japan_symbol("7203.T"), "7203.T")
        self.assertEqual(_yahoo_japan_symbol("7203.t"), "7203.T")  # case-insensitive

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(0.33, 0.18))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_japanese_ticker_uses_yfinance_with_jpy(self, mock_fund, _bs, mock_an):
        mock_fund.return_value = {
            "current_price": 3085.0,
            "trailing_pe": 10.44,
            "trailing_eps": 295.39,
            "forward_pe": 9.52,
            "forward_eps": 324.22,
            "beta": 0.33,
            "currency": "JPY",
        }
        mock_an.return_value = {
            "consensus": 3849.67, "high": 4500.0, "low": 3050.0, "median": 3900.0,
            "analyst_count": 18,
            "brokers": [],   # yfinance가 일본은 broker별 안 줌
            "rec_summary_row": {"strongBuy": 5, "buy": 8, "hold": 4, "sell": 1, "strongSell": 0},
            "current_fy_eps": 307.63,
        }

        result = fetch_analyst_target("7203.T")
        self.assertEqual(result.currency, "JPY")
        self.assertEqual(result.current_price, 3085.0)
        self.assertEqual(result.consensus, 3849.67)
        self.assertEqual(result.brokers, [])           # 일본은 비어도 OK
        self.assertIsNotNone(result.distribution)      # rec_summary로 distribution 구성됨
        self.assertEqual(result.distribution.total, 18)
        self.assertEqual(result.source, "yfinance")

    @patch("src.tools.analyst_target_api._fetch_yfinance_analyst")
    @patch("src.tools.analyst_target_api._fetch_beta_sigma_yf", return_value=(None, None))
    @patch("src.tools.analyst_target_api._fetch_yfinance_data")
    def test_japanese_ticker_4digit_normalized_to_dot_t(self, mock_fund, _bs, mock_an):
        """사용자가 '7203'만 입력해도 내부적으로 '7203.T'로 yfinance 호출."""
        mock_fund.return_value = {"currency": "JPY"}
        mock_an.return_value = {
            "consensus": None, "high": None, "low": None, "median": None,
            "analyst_count": None, "brokers": [], "rec_summary_row": None,
            "current_fy_eps": None,
        }
        fetch_analyst_target("7203")
        # _fetch_yfinance_data가 정규화된 '7203.T'로 호출됐는지
        mock_fund.assert_called_with("7203.T")
        mock_an.assert_called_with("7203.T")


if __name__ == "__main__":
    unittest.main()
