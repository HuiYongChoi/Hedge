"""내재가치는 시가총액과 견주어야 뜻이 생기고, 틀 이름만 남은 카드는 정보가 아니다."""

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.money_ko import describe_valuation_gap, format_krw, format_money_ko  # noqa: E402

AGENT = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")
HELPERS = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text(encoding="utf-8")
NORMALIZER = (ROOT / "app/frontend/src/lib/financial-text-normalizer.ts").read_text(encoding="utf-8")


class MoneyFormatTests(unittest.TestCase):
    def test_huge_amount_reads_in_korean_units(self):
        """972,992,820,105,704.6 은 자릿점을 찍어도 안 읽힌다."""
        self.assertEqual(format_krw(972_992_820_105_704.6), "973조 원")
        self.assertEqual(format_krw(1_802_000_000_000_000), "1,802조 원")
        self.assertEqual(format_krw(425_000_000_000), "4,250억 원")

    def test_missing_value_is_not_fabricated(self):
        self.assertEqual(format_krw(None), "확인 불가")

    def test_dollar_amount_is_not_written_in_won(self):
        """실측(MCD): 달러 기업가치 1,806억 달러가 원 단위로 적혀 크기가 틀렸다."""
        self.assertEqual(format_money_ko(180_643_000_000, "USD"), "1,806억 달러")
        self.assertEqual(format_money_ko(1_200_000_000_000, "usd"), "1.2조 달러")
        self.assertEqual(format_money_ko(3_500_000_000_000, "JPY"), "3.5조 엔")
        # 모르는 통화는 코드를 붙인다 — 원으로 둔갑시키지 않는다.
        self.assertEqual(format_money_ko(250_000_000_000, "CHF"), "2,500억 CHF")
        # 통화를 모르면 종전대로 원화.
        self.assertEqual(format_money_ko(425_000_000_000), "4,250억 원")


class ValuationGapTests(unittest.TestCase):
    def test_expensive_case_states_both_sides_and_verdict(self):
        """실측 카드: '내재가치는 약 973조 원으로 제시됩니다.' — 그래서 싼지 비싼지가 없었다."""
        text = describe_valuation_gap(972_992_820_105_704.6, 1_802_000_000_000_000, None)
        self.assertIn("973조 원", text)          # 계산값
        self.assertIn("1,802조 원", text)        # 시장값
        self.assertIn("비쌉니다", text)          # 판정
        self.assertIn("46%", text)               # 격차

    def test_cheap_case_flips_the_verdict(self):
        text = describe_valuation_gap(2_400_000_000_000_000, 1_800_000_000_000_000, None)
        self.assertIn("싼 편", text)
        self.assertIn("안전마진", text)

    def test_thin_margin_is_not_called_cheap(self):
        """폭이 얇으면 저평가라고 단정하면 안 된다 — 가정 하나에 뒤집힌다."""
        text = describe_valuation_gap(1_850_000_000_000_000, 1_800_000_000_000_000, None)
        self.assertIn("얇아", text)
        self.assertNotIn("싼 편", text)

    def test_missing_market_cap_yields_nothing(self):
        self.assertEqual(describe_valuation_gap(1e15, None, None), "")

    def test_dollar_company_comparison_uses_dollars(self):
        text = describe_valuation_gap(180_643_000_000, 167_725_000_000, None, currency="USD")
        self.assertIn("1,806억 달러", text)
        self.assertIn("1,677억 달러", text)
        self.assertNotIn("억 원", text)
        self.assertNotIn("조 원", text)

    def test_agent_passes_the_report_currency(self):
        """통화를 안 넘기면 달러 종목이 다시 원으로 적힌다."""
        self.assertIn("currency=report_currency", AGENT)
        self.assertIn("'1,806억 달러'", AGENT)

    def test_agent_attaches_the_comparison(self):
        self.assertIn("from src.tools.money_ko import describe_valuation_gap", AGENT)
        self.assertIn('"meaning_ko": gap_text', AGENT)
        self.assertIn("내재가치를 말할 때는 반드시 시가총액과 견주어라", AGENT)

    def test_english_marker_translated(self):
        self.assertIn('"FCFF DCF completed", "FCFF DCF 산출 완료"', AGENT)


class ScaffoldingCardTests(unittest.TestCase):
    """'Story → Numbers', '가치(Value): FCFF DCF + 안전마진 + 상대가치 체크'는 목차다."""

    def test_framework_filter_exists_and_is_applied(self):
        self.assertIn("export function isFrameworkLabelOnly", HELPERS)
        self.assertIn("isFrameworkLabelOnly(item.rawText)", HELPERS)

    def test_substance_check_keeps_real_findings(self):
        """같은 제목이라도 수치·서술이 붙으면 남겨야 한다."""
        self.assertIn("const hasSubstance =", HELPERS)

    def test_prompt_forbids_bare_framework_headings(self):
        self.assertIn("틀(프레임워크) 제목만 적고 끝내지 마라", AGENT)


class UnitDuplicationTests(unittest.TestCase):
    r"""'973조 원원' — 변환된 단위 뒤에 원문 단위가 남았다.
    lookahead 로 뒤를 막으면 조사가 붙는 '원원으로'를 놓친다(실측)."""

    def test_double_won_rule_has_no_trailing_lookahead(self):
        line = next(l for l in NORMALIZER.splitlines() if "원\\s*원" in l)
        self.assertIn("(조|억)(\\s*)원\\s*원", line)

    def test_self_referential_parenthetical_rule_exists(self):
        self.assertIn("export function dropSelfReferentialParenthetical", NORMALIZER)


if __name__ == "__main__":
    unittest.main()
