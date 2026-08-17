"""어닝콜 전사(ROIC.ai) 수집 검증.

여기 쓰인 문장은 실제 전사에서 그대로 가져온 것이다(삼성전자·AMD 2026 Q2).
"""

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.earnings_call import (  # noqa: E402
    candidate_identifiers,
    extract_guidance_lines,
    is_roic_enabled,
)

SRC = (ROOT / "src/tools/earnings_call.py").read_text(encoding="utf-8")
LLM = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")


def _turn(speaker: str, text: str) -> dict:
    return {"speaker": speaker, "text": text}


# 실측: 삼성전자 2026 Q2 전사에서 그대로 가져온 진행 안내 문장들.
HOUSEKEEPING = [
    _turn("Operator", "Greetings, and welcome to the Second Quarter 2026 Conference Call."),
    _turn("Daniel Oh", "We expect today's conference call to last approximately 1 hour and we appreciate your patience."),
    _turn("Daniel Oh", "During today's call, EVP Soon-Cheol Park will review our second quarter 2026 financial results and shareholder returns."),
]

# 실측: 같은 전사의 진짜 가이던스 문장.
SUBSTANTIVE = [
    _turn("Jaejune Kim", "Based on our outlook for the second half, HBM4 is expected to account for well over 60% of our total HBM revenue mix."),
    _turn("Sukchae Kang", "Building on this order momentum, we expect our 2-nano project wins to increase by more than double year-over-year in 2026."),
]


class GuidanceExtractionTests(unittest.TestCase):
    def test_call_housekeeping_is_not_guidance(self):
        """'We expect today's conference call to last 1 hour'는 전망이 아니다.
        이런 문장만 뽑히면 근거로서 값이 0이다(실측: 삼성전자에서 그렇게 나왔다)."""
        self.assertEqual(extract_guidance_lines(HOUSEKEEPING), [])

    def test_real_guidance_is_kept_with_speaker(self):
        lines = extract_guidance_lines(SUBSTANTIVE)
        self.assertEqual(len(lines), 2)
        self.assertTrue(all(":" in line for line in lines))
        self.assertTrue(any("HBM4" in line for line in lines))

    def test_explicit_guidance_ranked_first(self):
        """숫자·명시적 가이던스가 있는 문장이 앞에 와야 예산 안에서 살아남는다."""
        weak = _turn("CFO", "We continue to see healthy demand across our end markets and remain focused on execution.")
        lines = extract_guidance_lines([weak] + SUBSTANTIVE, limit=1)
        self.assertEqual(len(lines), 1)
        self.assertIn("HBM4", lines[0])

    def test_operator_turns_dropped(self):
        self.assertEqual(extract_guidance_lines([HOUSEKEEPING[0]]), [])


class IdentifierTests(unittest.TestCase):
    def test_korean_ticker_maps_to_krx(self):
        """실측: KRX:005930(삼성전자)은 전사가 있고, KRX:000660(SK하이닉스)은 없다."""
        self.assertEqual(candidate_identifiers("005930")[0], "KRX:005930")

    def test_us_ticker_tries_nasdaq_first(self):
        self.assertEqual(candidate_identifiers("AMD")[0], "NASDAQ:AMD")

    def test_explicit_identifier_passes_through(self):
        self.assertEqual(candidate_identifiers("NYSE:IBM"), ["NYSE:IBM"])


class WiringTests(unittest.TestCase):
    def test_disabled_without_key(self):
        """키가 없으면 네트워크 호출도 임포트도 하지 않는다(EDINET 과 같은 게이트)."""
        import os

        if not os.environ.get("ROIC_API_KEY"):
            self.assertFalse(is_roic_enabled())
        self.assertIn("if is_roic_enabled():", LLM)

    def test_transcript_uses_identifier_not_call_id(self):
        """목록의 id 를 경로에 넣으면 404('No ticker matches the supplied identifier').
        전사는 식별자 + 회계연도/분기로 조회해야 한다."""
        self.assertIn('f"/earnings-calls/{urllib.parse.quote(result.identifier', SRC)
        self.assertIn('"fiscal_year": result.fiscal_year', SRC)

    def test_rate_limit_is_distinguished_from_missing_data(self):
        """429 를 '자료 없음'으로 처리하면 근거가 조용히 빠진다. 재시도하고, 캐시에 넣지 않는다."""
        self.assertIn("class RateLimited(Exception):", SRC)
        self.assertIn("except RateLimited:", SRC)
        self.assertIn("_MAX_RATE_LIMIT_RETRIES", SRC)

    def test_resolved_identifier_is_remembered(self):
        """거래소 후보를 매번 훑으면 분당 5회 한도를 금방 태운다."""
        self.assertIn("_identifier_cache", SRC)

    def test_fails_soft(self):
        self.assertIn("result.error = ", SRC)


if __name__ == "__main__":
    unittest.main()
