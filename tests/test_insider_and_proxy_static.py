from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.insider_filings import parse_form4  # noqa: E402
from src.tools.proxy_statement import extract_say_on_pay, extract_sections  # noqa: E402

INSIDER = (ROOT / "src/tools/insider_filings.py").read_text(encoding="utf-8")
PROXY = (ROOT / "src/tools/proxy_statement.py").read_text(encoding="utf-8")
API = (ROOT / "src/tools/api.py").read_text(encoding="utf-8")
AGENT = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")


def _form4(code: str, disposed: str, shares: str = "1000", price: str = "100") -> str:
    return f"""<ownershipDocument>
      <issuerName>ACME CORP</issuerName>
      <rptOwnerName>Roe Jane</rptOwnerName>
      <officerTitle>SVP, GC &amp; Corporate Secretary</officerTitle>
      <isDirector>0</isDirector>
      <nonDerivativeTransaction>
        <securityTitle><value>Common Stock</value></securityTitle>
        <transactionDate><value>2026-08-11</value></transactionDate>
        <transactionCode>{code}</transactionCode>
        <transactionShares><value>{shares}</value></transactionShares>
        <transactionPricePerShare><value>{price}</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>{disposed}</value></transactionAcquiredDisposedCode>
        <sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction>
      </nonDerivativeTransaction>
    </ownershipDocument>"""


class InsiderForm4Tests(unittest.TestCase):
    """SEC Form 4 파싱 — 외부 API가 전 종목 0건을 반환하던 결함의 대체 경로."""

    def test_sale_is_negative_buy_is_positive(self):
        """에이전트는 transaction_shares < 0 을 매도(bearish)로 읽는다(sentiment.py).
        부호가 뒤집히면 매도를 매수로 오독한다."""
        sell = parse_form4(_form4("S", "D"), "ACME", "2026-08-11")
        self.assertEqual(len(sell), 1)
        self.assertLess(sell[0].transaction_shares, 0)

        buy = parse_form4(_form4("P", "A"), "ACME", "2026-08-11")
        self.assertGreater(buy[0].transaction_shares, 0)

    def test_awards_and_option_exercises_excluded_by_default(self):
        """스톡 어워드(A)·옵션행사(M)·세금원천징수(F)·증여(G)는 보상 일정에 따른
        기계적 거래다. 이를 '내부자 매수'로 세면 없는 강세 신호가 만들어진다.
        실측: NVDA 13건이 전부 A/G 였다 — 그대로 세면 '매수 11건'이 된다."""
        for code in ("A", "M", "F", "G"):
            self.assertEqual(
                parse_form4(_form4(code, "A"), "ACME", "2026-08-11"), [],
                f"code {code} must be excluded from the signal",
            )

    def test_non_discretionary_kept_when_requested(self):
        trades = parse_form4(_form4("A", "A"), "ACME", "2026-08-11", discretionary_only=False)
        self.assertEqual(len(trades), 1)
        self.assertIn("[A]", trades[0].security_title)

    def test_html_entities_decoded_in_title(self):
        """직함이 'SVP, GC &amp; Corporate Secretary' 로 깨져 보이면 안 된다."""
        trades = parse_form4(_form4("S", "D"), "ACME", "2026-08-11")
        self.assertIn("&", trades[0].title)
        self.assertNotIn("&amp;", trades[0].title)

    def test_transaction_value_sign_matches_direction(self):
        sell = parse_form4(_form4("S", "D"), "ACME", "2026-08-11")[0]
        self.assertLess(sell.transaction_value, 0)

    def test_scan_is_bounded_and_exits_early(self):
        """공시 1건마다 HTTP 요청이 든다. 전수 스캔은 비현실적이다(실측 14~18초)."""
        self.assertIn("ENOUGH_TRADES", INSIDER)
        self.assertIn("if len(trades) >= ENOUGH_TRADES:", INSIDER)
        self.assertIn("DEFAULT_MAX_FILINGS = 20", INSIDER)

    def test_api_falls_back_to_sec_when_provider_empty(self):
        """공급자가 빈 배열을 주면 조용히 '없음'이 되어 8개 에이전트가 중립으로 돈다."""
        self.assertIn("from src.tools.insider_filings import fetch_insider_trades_from_sec", API)
        self.assertIn("if sec_trades:", API)

    def test_fails_soft(self):
        self.assertIn("except Exception:", INSIDER)


class ProxyCompensationTests(unittest.TestCase):
    """DEF 14A 보상 구조 — 자본배분 '결과'를 만든 '인센티브'."""

    def test_sections_need_prose_not_toc_lines(self):
        """목차 줄('Summary Compensation Table .... 45')을 본문으로 오인하면 안 된다."""
        toc = "Summary Compensation Table 45 Pay Ratio 47 Other Item 49 " * 3
        self.assertEqual(extract_sections(toc), [])

    def test_real_section_extracted(self):
        body = (
            "Pay Versus Performance. The amounts reported as Compensation Actually Paid "
            "do not reflect the actual amount realized. We describe the relationship below. "
        ) * 12
        sections = extract_sections(body)
        self.assertTrue(sections)
        self.assertEqual(sections[0].key, "pay_vs_performance")

    def test_say_on_pay_parsed_or_none(self):
        text = "Our say-on-pay proposal was approved by 95.3% of the votes cast at the meeting."
        self.assertAlmostEqual(extract_say_on_pay(text), 0.953, places=3)
        # 못 찾으면 지어내지 않고 None
        self.assertIsNone(extract_say_on_pay("no compensation vote language here"))

    def test_fails_soft_and_no_key_needed(self):
        self.assertIn("except Exception as exc:", PROXY)
        self.assertIn("result.error = ", PROXY)


class AgentWiringTests(unittest.TestCase):
    def test_agent_attaches_compensation(self):
        self.assertIn("from src.tools.proxy_statement import fetch_latest_proxy", AGENT)
        self.assertIn('analysis_data[ticker]["compensation"]', AGENT)

    def test_prompt_links_incentives_to_capital_allocation(self):
        self.assertIn("인센티브", AGENT)
        self.assertIn("제공된 자료에서 확인 불가", AGENT)


if __name__ == "__main__":
    unittest.main()
