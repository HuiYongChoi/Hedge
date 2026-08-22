"""보고서 본문이 '읽히는 글'인지 검증.

배포본 두 건(삼성전자·SK하이닉스)에서 실제로 인쇄된 문장을 그대로 쓴다.
전문용어는 그대로 두고, 그 주변 서술만 대중적인 말로 바꾸는 것이 목표다.
"""

from pathlib import Path
import re
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

NORMALIZER = (ROOT / "app/frontend/src/lib/financial-text-normalizer.ts").read_text(encoding="utf-8")


class GlossaryOrderTests(unittest.TestCase):
    def test_specific_rule_precedes_broad_rule(self):
        """넓은 규칙이 앞서면 'insufficient: true' 에서 ': true' 가 남는다(실측)."""
        specific = NORMALIZER.index(r"[/\binsufficient\s*[:：]\s*true\b/gi")
        broad = NORMALIZER.index(r"[/\binsufficient\b/gi")
        self.assertLess(specific, broad)


class KoreanWordBoundaryTests(unittest.TestCase):
    r"""JS 정규식의 \b 는 한글 뒤에서 성립하지 않는다. 규칙이 조용히 안 걸린다.
    이 세션에서만 세 번 재발했다: '경영진\b', '필요\b', 'leverage 축\b'."""

    def test_no_word_boundary_after_hangul(self):
        offenders = [
            line.strip()
            for line in NORMALIZER.splitlines()
            if re.search(r"[가-힣]\\\\b", line) and not line.strip().startswith("//")
        ]
        self.assertEqual(offenders, [], f"한글 뒤 \\b 사용: {offenders}")


class PipelineShapeTests(unittest.TestCase):
    def test_stages_are_named_and_ordered(self):
        """찌꺼기 제거 → 용어 → 숫자 → 문체 순서가 아니면 결과가 뒤집힌다.
        (예: 문체를 먼저 바꾸면 원시 필드명이 문장으로 굳어 버린다.)"""
        for stage in ("const cleaned =", "const worded =", "const numbered =", "const phrased ="):
            self.assertIn(stage, NORMALIZER)
        order = [NORMALIZER.index(s) for s in
                 ("const cleaned =", "const worded =", "const numbered =", "const phrased =")]
        self.assertEqual(order, sorted(order))

    def test_quotes_are_left_alone(self):
        """인용부호 안은 회사가 쓴 말이다. 고치면 근거가 아니게 된다."""
        self.assertIn("mapOutsideQuotes", NORMALIZER)
        # 따옴표 짝이 안 맞아도 문단 전체를 삼키지 않도록 길이를 제한한다
        self.assertIn('[“"][^“”"]{0,300}[”"]', NORMALIZER)


class RuleCoverageTests(unittest.TestCase):
    """실측 결함마다 규칙이 있는지 — 규칙이 사라지면 결함이 돌아온다."""

    CASES = {
        "문어체 종결": "'제시된다': '나와 있습니다'",
        "딱딱한 표현": "확인이\\s*제한된다",
        "비율을 소수로": "normalizeRatiosWrittenAsDecimals",
        "자릿점 없는 큰 수": "function groupLargeAmounts",
        "깨진 퍼센트": "function repairFragmentedPercents",
        "중첩 라벨": "function collapseRepeatedRatioLabels",
        "통화 단위 불일치": "function stripMismatchedCurrencyPrefix",
        "체크박스 마커": "function stripLeftoverMarkers",
        "그라운딩 마커": "function stripLeakedSourceMarkers",
    }

    def test_every_observed_defect_has_a_rule(self):
        for label, needle in self.CASES.items():
            with self.subTest(label):
                self.assertIn(needle, NORMALIZER)


if __name__ == "__main__":
    unittest.main()
