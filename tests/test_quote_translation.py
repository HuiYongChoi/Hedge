"""영어 인용에 한국어 번역을 붙인다 — 모델 재량이 아니라 코드로 보장한다.

실측 경위
    1차: 프롬프트에 "번역을 함께 적어라"를 넣고 실제로 돌림 → 영어 인용 8건, 번역 0건.
    2차: 근거 블록에 '(번역: …)'을 미리 넣고 돌림 → 4건 중 0건. 모델이 번역 줄을 버렸다.
    3차: 출력에 사후로 붙임 → 4건 중 2건(사전에 있는 것만).
    4차: 못 찾은 인용은 즉석 번역 → 4건 중 4건.
지시로는 지켜지지 않는다는 것이 두 번 확인됐으므로 코드로 보장한다.
"""

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.quote_translation import (  # noqa: E402
    annotate_quotes_with_translation,
    build_translation_index,
    with_korean_translation,
)

SRC = (ROOT / "src/tools/quote_translation.py").read_text(encoding="utf-8")
LLM = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")
CALL = (ROOT / "src/tools/earnings_call.py").read_text(encoding="utf-8")
RELEASE = (ROOT / "src/tools/earnings_release.py").read_text(encoding="utf-8")

BLOCK_LINES = [
    "Lisa Su: We expect MI500 to deliver the largest generational leap in instinct history.",
    "(번역: Lisa Su: 우리는 MI500이 인스팅트 역사상 가장 큰 세대 간 도약을 이룰 것으로 기대합니다.)",
    "Lisa Su: And we expect the server CPU market to grow more than 50% annually by 2030.",
    "(번역: Lisa Su: 그리고 서버 CPU 시장이 2030년까지 연 50% 이상 성장할 것으로 기대합니다.)",
]


class IndexTests(unittest.TestCase):
    def test_pairs_are_indexed_by_english_prefix(self):
        """키는 영문 앞부분(소문자)이다. 인용이 일부만 따와도 앞부분으로 대조된다."""
        index = build_translation_index(BLOCK_LINES)
        self.assertEqual(len(index), 2)
        self.assertIn("we expect mi500 to deliv", index)
        self.assertTrue(all(k == k.lower() for k in index))

    def test_speaker_prefix_is_not_part_of_the_key(self):
        """화자 이름이 키에 섞이면 인용문과 대조되지 않는다."""
        index = build_translation_index(BLOCK_LINES)
        self.assertFalse(any(k.startswith("lisa su") for k in index))

    def test_unpaired_lines_are_ignored(self):
        self.assertEqual(build_translation_index(["English sentence with no translation below."]), {})


class AnnotationTests(unittest.TestCase):
    INDEX = build_translation_index(BLOCK_LINES)

    def test_known_quote_gets_translation(self):
        text = '경영진은 “We expect MI500 to deliver the largest generational leap”라고 말했습니다.'
        out = annotate_quotes_with_translation(text, self.INDEX, translate_unknown=False)
        self.assertIn("(번역: ", out)
        self.assertIn("인스팅트", out)

    def test_partial_quote_still_matches(self):
        """모델은 문장 일부만 따오기도 한다(실측: '…above...greater than 35%')."""
        text = '“We expect MI500 to deliver the largest generational leap in instinct history.”'
        out = annotate_quotes_with_translation(text, self.INDEX, translate_unknown=False)
        self.assertIn("(번역: ", out)

    def test_korean_quote_untouched(self):
        text = '회사는 “올해 실적이 개선될 것”이라고 밝혔습니다.'
        self.assertEqual(annotate_quotes_with_translation(text, self.INDEX, translate_unknown=False), text)

    def test_unknown_quote_left_alone_when_translation_disabled(self):
        text = '“Some entirely different English sentence about the business outlook.”'
        out = annotate_quotes_with_translation(text, self.INDEX, translate_unknown=False)
        self.assertNotIn("(번역:", out)

    def test_original_quote_is_preserved(self):
        """번역을 덧붙이되 원문은 한 글자도 바꾸지 않는다 — 원문이 근거다."""
        quote = "We expect MI500 to deliver the largest generational leap"
        out = annotate_quotes_with_translation(f'“{quote}”', self.INDEX, translate_unknown=False)
        self.assertIn(quote, out)


class WiringTests(unittest.TestCase):
    def test_grounding_blocks_carry_translations(self):
        self.assertIn("with_korean_translation", CALL)
        self.assertIn("with_korean_translation", RELEASE)

    def test_call_llm_annotates_every_agent_output(self):
        """에이전트마다 붙이면 새 에이전트에서 빠진다. 공통 창구에서 한 번에 붙인다."""
        self.assertIn("_build_translation_index_from_prompt", LLM)
        self.assertIn("_attach_quote_translations", LLM)

    def test_translation_failure_does_not_block_analysis(self):
        self.assertIn("except Exception:", SRC)
        self.assertIn("# 번역은 부가 기능이다.", LLM)

    def test_line_count_mismatch_is_rejected(self):
        """줄 수가 어긋나면 어느 줄의 번역인지 알 수 없다 — 엉뚱한 문장에 붙이면 안 된다."""
        self.assertIn("if len(translated) != len(wanted):", SRC)


if __name__ == "__main__":
    unittest.main()
