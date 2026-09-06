"""정기공시 목록(사이드바 '사업보고서' 메뉴) 수집기 테스트.

네트워크를 타지 않도록 DART list.json / SEC submissions 응답을 최소 형태로 넣어
분류·기간창·정렬만 검증한다.
"""
import json
import time
import unittest
from unittest.mock import patch

from src.tools import periodic_filings as pf


def _dart_payload(rows):
    return json.dumps({"status": "000", "message": "정상", "list": rows}).encode("utf-8")


DART_ROWS = [
    {"rcept_no": "20260814003509", "report_nm": "반기보고서 (2026.06)", "rcept_dt": "20260814"},
    {"rcept_no": "20260515002287", "report_nm": "분기보고서 (2026.03)", "rcept_dt": "20260515"},
    {"rcept_no": "20260317000635", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260317"},
    # 정기공시 분류에 섞여 들어와도 우리가 다루는 세 종류가 아니면 버린다.
    {"rcept_no": "20260101000001", "report_nm": "주요사항보고서", "rcept_dt": "20260101"},
    # 같은 접수번호가 중복으로 와도 한 번만 담는다.
    {"rcept_no": "20260317000635", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260317"},
]


class KoreanListingTests(unittest.TestCase):
    def setUp(self):
        pf._cache.clear()

    def _fetch(self, rows=DART_ROWS):
        with patch("src.tools.dart_filings._api_key", return_value="key"), \
             patch("src.tools.dart_filings.get_corp_code", return_value="00164779"), \
             patch("src.tools.dart_filings._http_get", return_value=_dart_payload(rows)):
            return pf.list_periodic_filings("000660.KS", months=12)

    def test_classifies_annual_and_quarterly(self):
        result = self._fetch()
        self.assertEqual(result.market, "KR")
        self.assertTrue(result.supported)
        self.assertIsNone(result.error)
        self.assertEqual([f.kind for f in result.filings], ["quarterly", "quarterly", "annual"])
        self.assertEqual([f.form for f in result.filings], ["반기보고서", "분기보고서", "사업보고서"])

    def test_drops_non_periodic_rows_and_duplicates(self):
        result = self._fetch()
        self.assertEqual(len(result.filings), 3)
        self.assertNotIn("주요사항보고서", [f.title for f in result.filings])

    def test_dates_normalized_and_sorted_newest_first(self):
        result = self._fetch()
        self.assertEqual(
            [f.date for f in result.filings],
            ["2026-08-14", "2026-05-15", "2026-03-17"],
        )

    def test_links_point_at_the_dart_viewer(self):
        result = self._fetch()
        self.assertTrue(all(
            f.url == f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={f.id}"
            for f in result.filings
        ))

    def test_query_narrows_to_latest_periodic_disclosures(self):
        """Navigator 에서 가져온 질의 조건 — 빠지면 호출량이 수십 배로 는다."""
        captured = {}

        def fake_get(url, params=None):
            captured.update(params or {})
            return _dart_payload(DART_ROWS)

        with patch("src.tools.dart_filings._api_key", return_value="key"), \
             patch("src.tools.dart_filings.get_corp_code", return_value="00164779"), \
             patch("src.tools.dart_filings._http_get", side_effect=fake_get):
            pf.list_periodic_filings("000660.KS", months=12)

        self.assertEqual(captured.get("pblntf_ty"), "A")
        self.assertEqual(captured.get("last_reprt_at"), "Y")
        self.assertEqual(captured.get("page_count"), "100")
        # 기간창이 실제로 12개월쯤인지 (하루 단위 오차는 허용)
        span_days = (
            time.mktime(time.strptime(captured["end_de"], "%Y%m%d"))
            - time.mktime(time.strptime(captured["bgn_de"], "%Y%m%d"))
        ) / 86400
        self.assertGreater(span_days, 360)
        self.assertLess(span_days, 372)

    def test_no_data_status_is_an_empty_list_not_an_error(self):
        payload = json.dumps({"status": "013", "message": "조회된 데이터가 없습니다."}).encode("utf-8")
        with patch("src.tools.dart_filings._api_key", return_value="key"), \
             patch("src.tools.dart_filings.get_corp_code", return_value="00164779"), \
             patch("src.tools.dart_filings._http_get", return_value=payload):
            result = pf.list_periodic_filings("000660.KS", months=12)
        self.assertEqual(result.filings, [])
        self.assertIsNone(result.error)

    def test_missing_api_key_reports_error_without_crashing(self):
        with patch("src.tools.dart_filings._api_key", return_value=""):
            result = pf.list_periodic_filings("000660.KS", months=12)
        self.assertEqual(result.filings, [])
        self.assertIn("DART_API_KEY", result.error or "")


SEC_SUBMISSIONS = {
    "filings": {
        "recent": {
            "form": ["8-K", "10-Q", "10-K", "10-Q", "4"],
            "filingDate": ["2026-08-26", "2026-06-25", "2025-10-03", "2020-06-29", "2026-08-28"],
            "reportDate": ["2026-08-24", "2026-05-28", "2025-08-28", "2020-05-28", "2026-06-26"],
            "accessionNumber": ["a0", "a1", "a2", "a3", "a4"],
            "primaryDocument": ["x.htm", "mu-20260528.htm", "mu-20250828.htm", "old.htm", "y.htm"],
        }
    }
}


class UsListingTests(unittest.TestCase):
    def setUp(self):
        pf._cache.clear()

    def _fetch(self):
        with patch("src.tools.sec_filings.get_cik_for_ticker", return_value=723125), \
             patch("src.tools.sec_filings._http_get",
                   return_value=json.dumps(SEC_SUBMISSIONS).encode("utf-8")):
            return pf.list_periodic_filings("MU", months=12)

    def test_keeps_only_periodic_forms(self):
        result = self._fetch()
        self.assertEqual([f.form for f in result.filings], ["10-Q", "10-K"])

    def test_drops_filings_outside_the_window(self):
        """2020년 10-Q 는 12개월 창 밖이라 빠진다."""
        result = self._fetch()
        self.assertNotIn("a3", [f.id for f in result.filings])

    def test_title_carries_the_fiscal_period(self):
        result = self._fetch()
        self.assertEqual([f.title for f in result.filings], ["10-Q (2026.05)", "10-K (2025.08)"])

    def test_links_point_at_edgar(self):
        result = self._fetch()
        self.assertEqual(
            result.filings[0].url,
            "https://www.sec.gov/Archives/edgar/data/723125/a1/mu-20260528.htm",
        )


class MarketRoutingTests(unittest.TestCase):
    def setUp(self):
        pf._cache.clear()

    def test_japan_is_marked_unsupported_without_network(self):
        result = pf.list_periodic_filings("7203.T", months=12)
        self.assertEqual(result.market, "JP")
        self.assertFalse(result.supported)
        self.assertEqual(result.filings, [])

    def test_result_is_cached_per_ticker(self):
        calls = []

        def fake_get(url):
            calls.append(url)
            return json.dumps(SEC_SUBMISSIONS).encode("utf-8")

        with patch("src.tools.sec_filings.get_cik_for_ticker", return_value=723125), \
             patch("src.tools.sec_filings._http_get", side_effect=fake_get):
            pf.list_periodic_filings("MU", months=12)
            pf.list_periodic_filings("MU", months=12)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
