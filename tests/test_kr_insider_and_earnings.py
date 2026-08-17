"""한국 내부신호·기업 발언 반영 검증.

여기 쓰인 원문 조각은 DART 에서 실제로 받아온 공시 본문이다(가공하지 않음).
"""

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.dart_insider import is_discretionary, parse_detail_rows  # noqa: E402

DART_INSIDER = (ROOT / "src/tools/dart_insider.py").read_text(encoding="utf-8")
DART_EARNINGS = (ROOT / "src/tools/dart_earnings.py").read_text(encoding="utf-8")
API = (ROOT / "src/tools/api.py").read_text(encoding="utf-8")
LLM = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")

_HEAD = ("세부변동내역 보고사유 변동일* 특정증권등의종류 소 유 주 식 수 (주) "
         "취득/처분단가(원)** 비 고 거래계획보고일자 변동전 증감 변동후 ")

# 삼성전자 여명구 부사장 — 장내매도 2건(접수 2026-08-11, 실제 거래 2026-08-04)
SAMSUNG_SELL = _HEAD + (
    "장내매도(-) 2026년 08월 04일 보통주 9,805 -95 9,710 259,750( 원) - - "
    "장내매도(-) 2026년 08월 04일 보통주 9,710 -905 8,805 259,500(원) - - "
    "합 계 9,805 -1,000 8,805 259,625( 원) - "
)

# SK하이닉스 최태원 회장 — 진짜 장내매수
SK_BUY = _HEAD + "장내매수(+) 2026.07.30 보통주 - 3,620 3,620 1,353,677 - - 합 계 - 3,620 3,620 1,353,677 - "

# SK하이닉스 곽노정 사장 — 요약 API 로는 '+5,878주 매수'로 보이지만 실제는 상여금
SK_BONUS = _HEAD + "자사주상여금(+) 2026년 05월 04일 보통주 8,434 5,878 14,312 - - - 합 계 8,434 5,878 14,312 - - "

# SK하이닉스 주영표 — 304주 중 259주는 우리사주 인출, 실제 매수는 45주뿐
SK_MIXED = _HEAD + (
    "기타(+) 2026년 06월 01일 보통주 296 259 555 - 우리사주조합 명의 계좌에서 개인 계좌로 인출 - "
    "장내매수(+) 2026년 06월 01일 보통주 555 45 600 2,391,000 - - "
    "합 계 296 304 600 2,391,000 - "
)


class DiscretionaryFilterTests(unittest.TestCase):
    """요약 API 의 증감 수량만 쓰면 보상 지급이 '내부자 매수'가 된다."""

    def test_stock_bonus_is_not_a_purchase(self):
        """실측: 곽노정 사장 +5,878주는 자사주상여금이다. 매수로 세면 거짓 강세 신호."""
        self.assertEqual(parse_detail_rows(SK_BONUS), [])
        self.assertFalse(is_discretionary("자사주상여금"))

    def test_employee_stock_withdrawal_excluded_but_real_buy_kept(self):
        """한 공시 안에 기계적 이동과 실제 매수가 섞여 있다. 45주만 남아야 한다."""
        rows = parse_detail_rows(SK_MIXED)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["shares"], 45)
        self.assertEqual(rows[0]["reason"], "장내매수")

    def test_option_exercise_not_counted_as_purchase(self):
        """'주식매수선택권행사'는 '매수'를 포함한다 — 단순 포함 검사로는 걸러지지 않는다."""
        self.assertFalse(is_discretionary("주식매수선택권행사"))
        self.assertTrue(is_discretionary("장내매수"))
        self.assertTrue(is_discretionary("시간외매도"))


class DetailRowParsingTests(unittest.TestCase):
    def test_sale_is_negative(self):
        """에이전트는 transaction_shares < 0 을 매도로 읽는다(sentiment.py)."""
        rows = parse_detail_rows(SAMSUNG_SELL)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["shares"] < 0 for r in rows))
        self.assertEqual(sorted(r["shares"] for r in rows), [-905, -95])

    def test_buy_is_positive_and_priced(self):
        rows = parse_detail_rows(SK_BUY)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["shares"], 3620)
        self.assertEqual(rows[0]["price"], 1353677)

    def test_transaction_date_is_trade_date_not_filing_date(self):
        """접수일 2026-08-11, 실제 거래일 2026-08-04. 접수일을 쓰면 시점이 어긋난다."""
        self.assertEqual(parse_detail_rows(SAMSUNG_SELL)[0]["date"], "2026-08-04")

    def test_total_row_not_double_counted(self):
        """'합 계' 행을 거래로 세면 수량이 두 배가 된다."""
        self.assertEqual(sum(r["shares"] for r in parse_detail_rows(SAMSUNG_SELL)), -1000)

    def test_garbage_yields_nothing(self):
        self.assertEqual(parse_detail_rows(""), [])
        self.assertEqual(parse_detail_rows("공시 원문을 찾을 수 없습니다"), [])


class WiringTests(unittest.TestCase):
    def test_amendments_deduped(self):
        """정정공시는 같은 거래를 다시 신고한다(삼성 박태훈 1건 → 4건으로 관측)."""
        self.assertIn("_AMENDMENT_RE", DART_INSIDER)
        self.assertIn("if key in seen:", DART_INSIDER)

    def test_scan_is_bounded(self):
        """삼성전자만 3,395건이다. 전수 조회는 불가능하다."""
        self.assertIn("DEFAULT_MAX_FILINGS = 25", DART_INSIDER)
        self.assertIn("scanned >= max_filings", DART_INSIDER)

    def test_api_dispatches_kr_to_dart(self):
        self.assertIn("from src.tools.dart_insider import fetch_insider_trades_from_dart", API)
        self.assertIn('if detect_market(ticker) == "KR":', API)

    def test_llm_injects_kr_earnings_as_management_said(self):
        self.assertIn("build_kr_earnings_context", LLM)
        self.assertIn("[MANAGEMENT SAID", DART_EARNINGS)

    def test_fails_soft(self):
        self.assertIn("except Exception:", DART_INSIDER)
        self.assertIn("result.error = ", DART_EARNINGS)


if __name__ == "__main__":
    unittest.main()
