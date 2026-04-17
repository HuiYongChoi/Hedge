from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
REQUIREMENT = (
    "CRITICAL REQUIREMENT: You MUST write your entire analysis, reasoning, "
    "and summary exclusively in Korean (한국어). Do NOT output any English sentences."
)


class KoreanOutputRequirementStaticTests(unittest.TestCase):
    def test_call_llm_appends_korean_requirement_before_invocation(self):
        source = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")

        self.assertIn(REQUIREMENT, source)
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

        self.assertIn("현재 실행 가능한 거래가 없어 관망합니다.", source)
        self.assertIn("모델 응답 실패로 관망 결정을 적용했습니다.", source)


if __name__ == "__main__":
    unittest.main()
