"""네이버 금융 리서치 기반 증권사 리포트 수집기 파서 테스트.

Price Compass 카드 클릭 → 해당 증권사 리포트 모달의 데이터 소스다.
네트워크를 타지 않도록 목록/상세 HTML을 최소 형태로 넣어 파서만 검증한다.
"""
import os
import unittest
from unittest.mock import patch

from src.tools import broker_reports as br


LIST_HTML = """
<table class="type_1">
  <tr><th>종목명</th><th>제목</th><th>증권사</th><th>첨부</th><th>작성일</th><th>조회수</th></tr>
  <tr>
    <td><a href="/item/main.naver?code=000660">SK하이닉스</a></td>
    <td><a href="company_read.naver?nid=95869&page=1&searchType=itemCode&itemCode=000660">짙은 안개속 선명한 성장</a></td>
    <td>미래에셋증권</td>
    <td><a href="https://stock.pstatic.net/stock-research/company/56/20260826_company_1.pdf">pdf</a></td>
    <td>26.08.26</td>
    <td>50192</td>
  </tr>
  <tr>
    <td><a href="/item/main.naver?code=000660">SK하이닉스</a></td>
    <td><a href="company_read.naver?nid=94745&page=1&searchType=itemCode&itemCode=000660">숨 고르기 후 반등 기대</a></td>
    <td>신한투자증권</td>
    <td></td>
    <td>26.07.30</td>
    <td>25552</td>
  </tr>
</table>
"""

DETAIL_HTML = """
<table class="type_1">
  <tr>
    <th class="view_sbj">
      <span><em>SK하이닉스</em></span>
      짙은 안개속 선명한 성장
      <p class="source">미래에셋증권<b class="bar">|</b>2026.08.26<b class="bar">|</b>조회 50194</p>
    </th>
    <th class="view_report">
      <a href="https://stock.pstatic.net/stock-research/company/56/20260826_company_1.pdf">리포트</a>
    </th>
  </tr>
  <tr><td colspan="2">
    <div class="view_info"><div class="view_info_1">
      목표가 <em class="money"><strong>2,800,000</strong></em>
      <span class="division">|</span>
      투자의견 <em class="coment">매수</em>
    </div></div>
  </td></tr>
  <tr><td colspan="2" class="view_cnt">
    <div><p>첫째 문단.<br>둘째 문단.</p></div>
  </td></tr>
</table>
"""


class NormalizeBrokerTests(unittest.TestCase):
    def test_strips_securities_suffixes(self):
        self.assertEqual(br.normalize_broker("미래에셋증권"), "미래에셋")
        self.assertEqual(br.normalize_broker("IBK투자증권"), "IBK")
        self.assertEqual(br.normalize_broker("IBK 투자증권"), "IBK")
        self.assertEqual(br.normalize_broker("한화투자증권(주)"), "한화")

    def test_distinct_brokers_do_not_collide(self):
        names = [
            "DB증권", "LS증권", "신한투자증권", "삼성증권", "현대차증권", "하나증권",
            "SK증권", "한국투자증권", "키움증권", "미래에셋증권", "한화투자증권",
            "유진투자증권", "IBK투자증권", "대신증권", "교보증권", "NH투자증권",
            "KB증권", "다올투자증권", "iM증권", "DS투자증권", "메리츠증권", "유안타증권",
        ]
        keys = [br.normalize_broker(n) for n in names]
        self.assertEqual(len(keys), len(set(keys)))

    def test_empty_and_suffix_only(self):
        self.assertEqual(br.normalize_broker(""), "")
        # 접미사만 남는 이름은 빈 키가 되지 않고 원문으로 되돌아간다.
        self.assertEqual(br.normalize_broker("증권"), "증권")

    def test_frontend_mirrors_the_same_rule(self):
        """TS 쪽 normalizeBrokerKey가 같은 토큰 집합을 떼어내는지 (드리프트 방지)."""
        path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "app", "frontend", "src", "services", "broker-report-service.ts",
        )
        with open(path, encoding="utf-8") as f:
            source = f.read()
        self.assertIn("normalizeBrokerKey", source)
        for token in ("금융투자", "투자증권", "증권", "홀딩스", "주식회사"):
            self.assertIn(token, source, f"TS 정규화에서 '{token}' 처리가 빠졌다")


class MarketSupportTests(unittest.TestCase):
    def test_korean_tickers_supported(self):
        for ticker in ("000660.KS", "000660", "247540.KQ"):
            self.assertTrue(br.is_supported_ticker(ticker), ticker)

    def test_foreign_tickers_unsupported(self):
        for ticker in ("AAPL", "7203.T", ""):
            self.assertFalse(br.is_supported_ticker(ticker), ticker)

    def test_unsupported_market_returns_empty_index_without_network(self):
        with patch.object(br, "_get", side_effect=AssertionError("no network")):
            index = br.fetch_broker_reports("AAPL")
        self.assertEqual(index.reports, [])
        self.assertEqual(index.source, "unsupported-market")


class ListParsingTests(unittest.TestCase):
    def test_parses_rows_with_and_without_pdf(self):
        reports = br._parse_list_page(LIST_HTML, "000660")
        self.assertEqual(len(reports), 2)
        first, second = reports
        self.assertEqual(first.id, "95869")
        self.assertEqual(first.broker, "미래에셋증권")
        self.assertEqual(first.broker_key, "미래에셋")
        self.assertEqual(first.title, "짙은 안개속 선명한 성장")
        self.assertEqual(first.published_date, "2026-08-26")
        self.assertTrue(first.pdf_url.endswith(".pdf"))
        self.assertIn("nid=95869", first.detail_url)
        # 첨부 PDF가 없는 리포트도 목록에는 남는다 (원문 페이지로 연결)
        self.assertIsNone(second.pdf_url)
        self.assertEqual(second.published_date, "2026-07-30")

    def test_two_digit_year_expands(self):
        self.assertEqual(br._normalize_date("26.08.26"), "2026-08-26")
        self.assertEqual(br._normalize_date("2026.08.06"), "2026-08-06")
        self.assertEqual(br._normalize_date(""), "")

    def test_fetch_dedupes_and_sorts_newest_first(self):
        br._LIST_CACHE.clear()
        with patch.object(br, "_get", return_value=LIST_HTML):
            index = br.fetch_broker_reports("000660.KS", pages=2)
        # 같은 HTML을 2페이지로 받아도 nid 기준으로 중복 제거
        self.assertEqual([r.id for r in index.reports], ["95869", "94745"])
        self.assertEqual(index.item_code, "000660")
        self.assertIn("itemCode=000660", index.list_url)


class DetailParsingTests(unittest.TestCase):
    def test_parses_target_opinion_and_body(self):
        detail = br._parse_detail(DETAIL_HTML, "95869", "000660")
        self.assertIsNotNone(detail)
        self.assertEqual(detail.broker, "미래에셋증권")
        self.assertEqual(detail.title, "짙은 안개속 선명한 성장")
        self.assertEqual(detail.published_date, "2026-08-26")
        self.assertEqual(detail.target_price, 2800000.0)
        self.assertEqual(detail.opinion, "매수")
        self.assertEqual(detail.signal, "BUY")
        self.assertEqual(detail.views, 50194)
        self.assertEqual(detail.body, ["첫째 문단.", "둘째 문단."])
        self.assertTrue(detail.pdf_url.endswith(".pdf"))

    def test_returns_none_for_unrelated_html(self):
        self.assertIsNone(br._parse_detail("<html><body>없음</body></html>", "1", "000660"))

    def test_fetch_detail_rejects_non_numeric_id(self):
        with patch.object(br, "_get", side_effect=AssertionError("no network")):
            self.assertIsNone(br.fetch_broker_report_detail("000660.KS", "abc"))


if __name__ == "__main__":
    unittest.main()
