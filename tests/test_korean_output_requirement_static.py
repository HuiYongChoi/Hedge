from pathlib import Path
import unittest

from src.utils.llm import KOREAN_OUTPUT_REQUIREMENT


ROOT = Path(__file__).resolve().parents[1]
REQUIREMENT = (
    "CRITICAL REQUIREMENT: You MUST write your entire analysis, reasoning, "
    "and summary exclusively in Korean (한국어). Do NOT output any English sentences."
)


class KoreanOutputRequirementStaticTests(unittest.TestCase):
    def test_call_llm_appends_korean_requirement_before_invocation(self):
        source = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")

        # 소스 텍스트가 아니라 실제 상수 값을 본다. 원문 문자열을 소스에서 찾으면
        # 지침이 길어져 줄이 나뉘는 순간 통과하지 못하고, 그러면 이 검사를
        # 지키느라 지침을 못 고치게 된다.
        self.assertIn(REQUIREMENT, KOREAN_OUTPUT_REQUIREMENT)
        self.assertIn("def enforce_korean_output_requirement", source)
        self.assertLess(
            source.index("prompt = enforce_korean_output_requirement(prompt)"),
            source.index("llm.invoke(prompt)"),
        )

    def test_sse_events_emit_utf8_json_without_ascii_escaping(self):
        source = (ROOT / "app/backend/models/events.py").read_text(encoding="utf-8")

        self.assertIn("ensure_ascii=False", source)
        self.assertIn("model_dump(mode=\"json\")", source)

    def test_hedge_fund_response_parser_accepts_utf8_bytes(self):
        source = (ROOT / "app/backend/services/graph.py").read_text(encoding="utf-8")

        self.assertIn("response.decode(\"utf-8\")", source)

    def test_portfolio_manager_default_reasoning_is_korean(self):
        source = (ROOT / "src/agents/portfolio_manager.py").read_text(encoding="utf-8")

        self.assertIn("에이전트 신호 기준 강세", source)
        self.assertIn("보수적 관망 판단입니다.", source)
        self.assertNotIn("현재 실행 가능한 거래가 없어 관망합니다.", source)
        self.assertNotIn("모델 응답 실패로 관망합니다.", source)


if __name__ == "__main__":
    unittest.main()
