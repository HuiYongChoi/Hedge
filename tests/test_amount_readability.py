"""큰 금액은 통화에 맞는 한국어 단위로 읽혀야 한다.

실측(미국 종목 카드): "forward 관점에서는 “내재가치 250,173,866,221.35”로 커지고.16%, …"
  - 1조 미만이라 기존 규칙(1조 이상만, 항상 '원')을 빠져나가 긴 숫자가 그대로 인쇄됐다.
  - 안전마진 규칙이 "28.16%"의 소수부(.16)를 잡아 숫자가 깨졌다("2816%%").
  - "#### 2 경영진이 말한 …" 소제목이 앞 카드 본문에 붙어 인쇄됐다.
"""

from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.money_ko import currency_unit_for, describe_valuation_gap, format_money  # noqa: E402

NORMALIZER = ROOT / "app/frontend/src/lib/financial-text-normalizer.ts"
HELPERS = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text(encoding="utf-8")
LAYOUT = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx").read_text(encoding="utf-8")
AGENT = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")


class BackendMoneyTests(unittest.TestCase):
    def test_us_amount_uses_dollars(self):
        self.assertEqual(format_money(250_173_866_221.35, "달러"), "2,502억 달러")
        self.assertEqual(currency_unit_for("MCD"), "달러")
        self.assertEqual(currency_unit_for("005930.KS"), "원")
        self.assertEqual(currency_unit_for("7203.T"), "엔")

    def test_valuation_gap_follows_currency(self):
        text = describe_valuation_gap(250e9, 200e9, None, "달러")
        self.assertIn("2,500억 달러", text)
        self.assertNotIn("원", text.split("입니다")[0])

    def test_agent_hands_readable_value_to_model(self):
        """모델은 받은 원시 숫자를 그대로 옮겨 적는다 — 읽히는 표기를 함께 준다."""
        self.assertIn('"intrinsic_value_readable"', AGENT)
        self.assertIn("currency_unit_for(ticker)", AGENT)


def _node_supports_ts() -> bool:
    node = shutil.which("node")
    if not node:
        return False
    out = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    major, minor = (int(x) for x in out.split(".")[:2])
    return major > 22 or (major == 22 and minor >= 18)


@unittest.skipUnless(_node_supports_ts(), "node >= 22.18 (type stripping) 필요")
class NormalizerRuntimeTests(unittest.TestCase):
    """정규식은 문자열 검사로는 검증이 안 된다. 실제로 돌려 본다."""

    CASES = [
        # (통화 힌트, 입력, 기대 출력에 포함, 기대 출력에 없어야 함)
        ("달러", "forward 관점에서는 “내재가치 250,173,866,221.35”로 커지고", "약 2,502억 달러", "250,173"),
        ("", "10-K 기준 FCFF 내재가치 250173866221.35 달러로", "약 2,502억 달러로", "250173"),
        ("", "내재가치 $250,173,866,221.35", "내재가치 약 2,502억 달러", "$"),
        ("원", "FCFF DCF 내재가치 972,992,820,105,704.6 (제공된 값)", "약 973조 원", "972,992"),
        ("", "시가총액 1,802,000,000,000,000원", "약 1,802조 원", "원원"),
        ("", "내재가치 250,173,866,221.35", "약 2,502억", "250,173"),
        ("", "발행주식수 711,000,000주", "711,000,000주", "억"),
        ("", "종목코드 005930, 목표가 185,000원", "005930", "억"),
        ("", "커지고(안전마진 약 28.16%), 이는", "안전마진 약 28.16%", "2816"),
        ("", "안전마진 -0.43", "안전마진 -43%", "0.43"),
        ("", "전망 문장(투자 후 효과): [원문] “And while”", "원문 “And while”", "원문]"),
    ]

    def test_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            module = Path(tmp) / "n.ts"
            module.write_text(NORMALIZER.read_text(encoding="utf-8"), encoding="utf-8")
            runner = Path(tmp) / "run.ts"
            runner.write_text(
                "import { normalizeFinancialDisplayText as n, setAmountCurrencyHint as h } from './n.ts';\n"
                f"const cases = {json.dumps([[c[0], c[1]] for c in self.CASES], ensure_ascii=False)};\n"
                "console.log(JSON.stringify(cases.map(([u, t]) => { h(u); return n(t); })));\n",
                encoding="utf-8",
            )
            out = subprocess.run(["node", str(runner)], capture_output=True, text=True, check=True).stdout
        results = json.loads(out)
        for (hint, text, expected, forbidden), got in zip(self.CASES, results):
            with self.subTest(text=text, hint=hint):
                self.assertIn(expected, got)
                self.assertNotIn(forbidden, got)


class SubHeadingTests(unittest.TestCase):
    def test_level_four_headings_become_items(self):
        self.assertIn("function demoteSubHeadings", HELPERS)
        self.assertIn("return demoteSubHeadings(normalizeFinancialDisplayText(sectionText)", HELPERS)
        self.assertIn("return demoteSubHeadings(text.replace", HELPERS)

    def test_report_layout_sets_currency_hint(self):
        self.assertIn("setAmountCurrencyHint(AMOUNT_UNIT_BY_COUNTRY[countryFromTicker(activeTicker)])", LAYOUT)


if __name__ == "__main__":
    unittest.main()
