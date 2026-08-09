from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
LLM_SRC = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"


class SourceGroundingStaticTests(unittest.TestCase):
    """원문 그라운딩 지침 + '확인 불가' 표기의 회귀 방지.

    배경: 리포트에 근거 없는 서술(경영진 발언 창작, 1인칭 페르소나 내레이션)이
    섞여 나오던 문제. 지표가 N/A인 것(DATA GAP)과 사실 근거가 없는 것(GROUNDING)은
    다르게 취급해야 한다.
    """

    def test_grounding_requirement_exists_and_is_injected(self):
        self.assertIn("SOURCE_GROUNDING_MARKER", LLM_SRC)
        self.assertIn("SOURCE_GROUNDING_REQUIREMENT = (", LLM_SRC)
        self.assertIn("if SOURCE_GROUNDING_MARKER not in text:", LLM_SRC)
        self.assertIn("requirements.append(SOURCE_GROUNDING_REQUIREMENT)", LLM_SRC)

    def test_grounding_forbids_fabrication_and_persona(self):
        # 창작 금지 + 1인칭 페르소나 금지 + 출처불명 일반화 금지
        self.assertIn("제공된 자료에서 확인 불가", LLM_SRC)
        self.assertIn("management remarks, earnings-call quotes", LLM_SRC)
        self.assertIn("Do NOT narrate yourself as an investor persona", LLM_SRC)
        self.assertIn("알려진 바에 따르면", LLM_SRC)
        # 사실과 해석의 표현 분리
        self.assertIn("로 해석된다", LLM_SRC)

    def test_grounding_does_not_contradict_data_gap_rule(self):
        # DATA GAP(수치 N/A)과 GROUNDING(사실 근거 없음)의 역할 분리를 명시해야 한다.
        self.assertIn("it does not override DATA GAP HANDLING", LLM_SRC)
        self.assertIn("an N/A metric means keep analyzing with proxies", LLM_SRC)

    def test_grounding_text_avoids_sanitizer_trigger_words(self):
        """지침 본문이 sanitize_data_gap_language 패턴에 걸리면 문구가 치환되어
        중복 주입 방지가 깨진다. 트리거 단어를 쓰지 않았는지 확인한다."""
        match = re.search(
            r"SOURCE_GROUNDING_REQUIREMENT = \((.*?)\n\)\n", LLM_SRC, re.S
        )
        self.assertIsNotNone(match, "SOURCE_GROUNDING_REQUIREMENT block not found")
        body = match.group(1)
        # 주석 줄은 제외하고 실제 프롬프트 문자열만 검사
        prompt_body = "\n".join(
            line for line in body.splitlines() if not line.strip().startswith("#")
        )
        for trigger in ("missing ", "insufficient data", "data not available"):
            self.assertNotIn(
                trigger, prompt_body,
                f"grounding text must avoid sanitizer trigger: {trigger!r}",
            )

    def test_requirements_use_stable_markers_no_duplicate_injection(self):
        """전체 문자열 비교는 sanitize 로 한 글자만 바뀌어도 실패해 지침이 매 호출마다
        중복 누적된다(프롬프트 비대화). 모든 지침이 마커 기반이어야 한다."""
        self.assertIn("REQUIREMENT_MARKERS = (", LLM_SRC)
        for marker_check in (
            'if "DATA GAP HANDLING REQUIREMENT:" not in text:',
            'if "RATIO SCALE REQUIREMENT:" not in text:',
            'if "[추가 지시사항: 부채의 질적 평가]" not in text:',
            'if "[추가 지시사항: 원문 대조 가이드 작성]" not in text:',
            'if "[추가 지시사항: 결과 보고 품질]" not in text:',
            'if "스키마 호환 지시사항:" not in text:',
        ):
            self.assertIn(marker_check, LLM_SRC)
        # 전체 문자열 비교 방식이 남아 있으면 안 된다
        self.assertNotIn("if DATA_GAP_HANDLING_REQUIREMENT not in text:", LLM_SRC)
        self.assertNotIn("if RATIO_SCALE_REQUIREMENT not in text:", LLM_SRC)

    def test_appended_instructions_are_not_re_sanitized(self):
        """지침 블록에는 'insufficient data' 같은 금지 예시가 그대로 들어 있어서,
        재정규화하면 예시가 치환돼 지침 자체가 훼손된다(이자부채비율 100%4% 등)."""
        self.assertIn("def _split_at_appended_requirements(", LLM_SRC)
        self.assertIn("body, already_appended = _split_at_appended_requirements(text)", LLM_SRC)
        self.assertIn("body = sanitize_data_gap_language(body)", LLM_SRC)

    def test_render_keeps_not_verifiable_phrase(self):
        """'제공된 자료에서 확인 불가'는 15자 한글에 종결어미가 없어 기존
        heading-only 필터에 걸려 화면에서 사라진다. 예외 처리돼 있어야 한다."""
        for fname in ("helpers.ts", "evidence-item.tsx"):
            src = (V5_DIR / fname).read_text(encoding="utf-8")
            self.assertIn(
                "if (/확인\\s*불가|확인할\\s*수\\s*없/u.test(clean)) return false;",
                src,
                f"{fname} must keep the not-verifiable phrase visible",
            )


if __name__ == "__main__":
    unittest.main()
