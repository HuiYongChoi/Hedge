from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.life_cycle import (  # noqa: E402
    STAGE_DECLINE,
    STAGE_HIGH_GROWTH,
    STAGE_MATURE_GROWTH,
    STAGE_MATURE_STABLE,
)
from src.tools.narrative_check import check  # noqa: E402
from src.tools.earnings_release import extract_outlook, extract_quotes  # noqa: E402

AGENT = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")
LLM = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")
RELEASE = (ROOT / "src/tools/earnings_release.py").read_text(encoding="utf-8")
NARRATIVE = (ROOT / "src/tools/narrative_check.py").read_text(encoding="utf-8")
SNAPSHOT = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/market-snapshot.ts").read_text(encoding="utf-8")

GROWTH_TEXT = (
    "We are accelerating growth across new markets. " * 8
    + "Our expansion into new opportunities continues to ramp. Record demand supports investment in capacity. " * 4
)
MATURE_TEXT = (
    "We remain focused on margin improvement and cost discipline. " * 6
    + "The board approved a dividend increase and share repurchase program. Return of capital to shareholders is a priority. " * 4
)


class EarningsReleaseTests(unittest.TestCase):
    """8-K Item 2.02 실적 보도자료에서 경영진 발언을 뽑는다."""

    def test_quote_speaker_may_contain_periods(self):
        """화자 이름의 마침표(Dr., Jr.)를 금지하면 인용이 통째로 누락된다
        (실측: AMD CEO 'Dr. Lisa Su' 인용 미검출)."""
        text = (
            'Some intro. “We delivered an excellent quarter with record revenue '
            'and profitability as Data Center revenue more than doubled,” said Dr. Lisa Su, '
            'AMD chair and CEO. More text follows.'
        )
        quotes = extract_quotes(text)
        self.assertEqual(len(quotes), 1)
        self.assertIn("Lisa Su", quotes[0].speaker)

    def test_multiple_speakers_extracted(self):
        text = (
            '“First quote about the quarter and our performance overall this period,” said Dr. A. Kim, CEO. '
            '“Second quote about revenue growth and margins for the reported period,” said Jane Roe, CFO.'
        )
        self.assertEqual(len(extract_quotes(text)), 2)

    def test_section_titles_in_quotes_are_not_management_quotes(self):
        """보도자료의 표·섹션 제목도 따옴표를 쓴다. 'said' 가 없으면 인용이 아니다
        (실측: 알파벳 보도자료는 경영진 인용이 없고 표 제목만 따옴표였다)."""
        text = '“Reconciliation from GAAP Revenues to Non-GAAP Constant Currency Revenues” for more details.'
        self.assertEqual(extract_quotes(text), [])

    def test_outlook_extracted(self):
        text = "Blah blah. Outlook AMD expects revenue of $X billion for the third quarter."
        self.assertIn("Outlook", extract_outlook(text))
        self.assertEqual(extract_outlook("no forward looking section here"), "")

    def test_only_earnings_8k_is_used(self):
        """인사·계약 8-K 를 실적 발표로 오인하면 안 된다 — Item 2.02 만 고른다."""
        self.assertIn('_EARNINGS_ITEM = "2.02"', RELEASE)
        self.assertIn("_EARNINGS_ITEM not in", RELEASE)

    def test_press_release_exhibit_not_cover_page(self):
        """8-K 표지에는 경영진 발언이 없다. 첨부 EX-99.1 을 골라야 한다."""
        self.assertIn("def _pick_press_release_doc(", RELEASE)
        self.assertIn("cover_doc", RELEASE)

    def test_fails_soft(self):
        self.assertIn("except Exception as exc:", RELEASE)
        self.assertIn("result.error = ", RELEASE)


class NarrativeCheckTests(unittest.TestCase):
    """회사가 직접 쓴 서사와 생애주기 단계의 정합성."""

    def test_mature_company_with_growth_story_is_flagged(self):
        """Damodaran 의 핵심 경고 — 성숙 기업의 성장 서사는 과잉투자로 이어진다."""
        result = check(STAGE_MATURE_STABLE, GROWTH_TEXT)
        self.assertFalse(result.aligned)
        self.assertEqual(result.tone, "growth")
        self.assertIn("괴리", result.verdict_ko)

    def test_growth_company_with_return_story_is_flagged(self):
        result = check(STAGE_HIGH_GROWTH, MATURE_TEXT)
        self.assertFalse(result.aligned)

    def test_matching_narrative_passes(self):
        self.assertTrue(check(STAGE_MATURE_STABLE, MATURE_TEXT).aligned)
        self.assertTrue(check(STAGE_HIGH_GROWTH, GROWTH_TEXT).aligned)

    def test_mature_growth_tolerates_both_tones(self):
        """성숙 성장 단계는 성장·효율 서사가 공존하는 게 정상이라 경고하지 않는다."""
        self.assertTrue(check(STAGE_MATURE_GROWTH, GROWTH_TEXT).aligned)
        self.assertTrue(check(STAGE_MATURE_GROWTH, MATURE_TEXT).aligned)

    def test_short_text_is_not_judged(self):
        """근거가 없으면 판정하지 않는다."""
        result = check(STAGE_DECLINE, "too short")
        self.assertTrue(result.insufficient)
        self.assertIsNone(result.aligned)

    def test_evidence_is_company_sentence_not_generated(self):
        """서사를 창작하지 않고 회사가 쓴 문장을 근거로 남긴다."""
        result = check(STAGE_MATURE_STABLE, GROWTH_TEXT)
        self.assertTrue(result.evidence_ko)
        self.assertIn("growth", result.evidence_ko[0].lower())

    def test_korean_terms_supported(self):
        # 실제 '이사의 경영진단'은 수천 자다(실측 삼성전자 7,999자).
        # 최소 표본(400자)을 넘겨야 판정하므로 테스트 문구도 그만큼 준다.
        korean = (
            "당사는 신규 시장 확대와 성장 가속을 추진하고 있습니다. " * 12
            + "증설 투자와 수요 증가에 대응해 확장을 지속합니다. " * 8
        )
        self.assertGreaterEqual(len(korean), 400)
        result = check(STAGE_MATURE_STABLE, korean)
        self.assertEqual(result.tone, "growth")
        self.assertFalse(result.aligned)


class AgentWiringTests(unittest.TestCase):
    def test_agent_collects_company_own_words(self):
        self.assertIn("from src.tools.earnings_release import fetch_latest_earnings_release", AGENT)
        self.assertIn("from src.tools.narrative_check import check as check_narrative", AGENT)
        self.assertIn('analysis_data[ticker]["management_said"]', AGENT)
        self.assertIn('analysis_data[ticker]["narrative_check"]', AGENT)

    def test_agent_uses_mdna_section_as_company_text(self):
        """회사가 직접 쓴 서술(MD&A / 이사의 경영진단)만 서사 판정에 넣는다."""
        self.assertIn('s.item == "7"', AGENT)

    def test_prompt_forbids_inventing_story(self):
        self.assertIn("STORY 축", AGENT)
        self.assertIn("서사를 새로 지어내지 마라", AGENT)
        self.assertIn("화자(`speaker`)를 함께 밝혀라", AGENT)
        self.assertIn("narrative_check.insufficient", AGENT)


class BaselineGroundingTests(unittest.TestCase):
    """경영진 발언은 특정 에이전트 전용이 아니라 전 에이전트의 기본 근거다."""

    def test_earnings_injected_for_all_agents(self):
        """call_llm 단일 관문에서 주입되므로 모든 에이전트가 공유한다."""
        self.assertIn("from src.tools.earnings_release import (", LLM)
        self.assertIn("build_earnings_context", LLM)
        self.assertIn("EARNINGS_GROUNDING_ENABLED", LLM)
        self.assertIn("EARNINGS_GROUNDING_BUDGET", LLM)

    def test_earnings_failure_does_not_block_filing_grounding(self):
        """실적 보도자료 조회 실패가 10-K 원문 주입까지 막으면 안 된다."""
        block = LLM[LLM.index("if earnings_enabled:"):LLM.index("if not blocks:")]
        self.assertIn("try:", block)
        self.assertIn("except Exception:", block)

    def test_management_quotes_are_never_sanitized(self):
        """인용문이 정규화로 바뀌면 경영진을 '잘못 인용'하게 된다."""
        self.assertIn('MANAGEMENT_SAID_MARKER = "[MANAGEMENT SAID"', LLM)
        self.assertIn("SOURCE_TEXT_MARKERS = (SEC_SOURCE_TEXT_MARKER, MANAGEMENT_SAID_MARKER)", LLM)
        self.assertIn("cut = min(positions)", LLM)

    def test_duplicate_injection_checks_both_markers(self):
        self.assertIn("any(marker in content for marker in SOURCE_TEXT_MARKERS)", LLM)

    def test_prompt_tells_agents_how_to_use_quotes(self):
        """재료만 주고 쓰는 법을 안 알려주면 무시된다."""
        self.assertIn("[MANAGEMENT SAID", LLM)
        self.assertIn("화자를 함께 밝혀라", LLM)
        self.assertIn("한 글자도 바꾸지 말고", LLM)

    def test_narrative_check_stays_with_damodaran(self):
        """서사 대조는 생애주기 단계가 있어야 성립하므로 전 에이전트로 넓히지 않는다."""
        self.assertNotIn("narrative_check", LLM)
        self.assertIn("check as check_narrative", AGENT)


class GuidanceTrackingInfraTests(unittest.TestCase):
    """3단계(가이던스 이행 추적)의 전제 — 스냅샷에 값이 남아야 다음 분기 비교가 된다."""

    def test_snapshot_stores_stage_and_guidance(self):
        for field_name in ("lifeCycleStage", "lifeCycleStageLabel", "narrativeAligned", "guidanceText"):
            self.assertIn(field_name, SNAPSHOT)

    def test_diff_surfaces_stage_and_narrative_change(self):
        self.assertIn("'생애주기 단계'", SNAPSHOT)
        self.assertIn("'서사 정합성'", SNAPSHOT)


if __name__ == "__main__":
    unittest.main()
