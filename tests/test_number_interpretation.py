"""숫자·단계를 제시했으면 '그래서 무슨 뜻인지'까지 붙는지 검증.

배포본 리포트에서 카드가 이렇게 나왔다:
    "재투자 수익성 점수 41.5 — 세후 ROIC 약 7.3% vs 자본비용 9.0% (초과수익 -1.7%p)"
    "5단계 · 성숙 안정."
숫자와 단계만 있고 해석이 없으면 읽는 사람이 해석을 떠안는다.
"""

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.life_cycle import (  # noqa: E402
    STAGE_MATURE_STABLE,
    STAGE_PLAYBOOK,
    LifeCycleDiagnosis,
)
from src.tools.management_scorecard import ScoreAxis  # noqa: E402

SCORECARD = (ROOT / "src/tools/management_scorecard.py").read_text(encoding="utf-8")
AGENT = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")
HELPERS = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text(encoding="utf-8")
NORMALIZER = (ROOT / "app/frontend/src/lib/financial-text-normalizer.ts").read_text(encoding="utf-8")


class ScoreAxisMeaningTests(unittest.TestCase):
    def test_full_ko_joins_number_and_meaning(self):
        axis = ScoreAxis("roic_spread", "재투자 수익성", 41.5, "세후 ROIC 7.3%", "재투자할수록 가치가 깎입니다.")
        self.assertIn("세후 ROIC 7.3%", axis.full_ko)
        self.assertIn("가치가 깎입니다", axis.full_ko)

    def test_bare_number_survives_when_no_meaning(self):
        """해석을 못 만든 경우까지 억지로 문장을 붙이지는 않는다."""
        axis = ScoreAxis("x", "축", None, "데이터 부족")
        self.assertEqual(axis.full_ko, "데이터 부족")

    def test_every_scored_axis_supplies_meaning(self):
        """다섯 축 모두 점수를 낼 때는 해석을 함께 만들어야 한다."""
        for key in ("roic_spread", "incremental_roic", "share_discipline", "leverage", "cash_conversion"):
            marker = f'ScoreAxis("{key}"'
            self.assertIn(marker, SCORECARD)
        # 점수와 함께 5개 축 모두 meaning 인자를 넘긴다
        self.assertEqual(SCORECARD.count("round(score, 1), detail, meaning"), 5)

    def test_negative_spread_meaning_states_the_consequence(self):
        self.assertIn("주주 가치가 깎입니다", SCORECARD)
        self.assertIn("배당·자사주로 돌려주는 편이 나은 국면", SCORECARD)

    def test_dict_exposes_meaning(self):
        self.assertIn('"meaning_ko": a.meaning_ko', SCORECARD)
        self.assertIn('"detail_ko": a.full_ko', SCORECARD)
        self.assertIn('"scale_ko": a.scale_ko', SCORECARD)

    def test_score_scale_is_stated(self):
        """'41.5점'만으로는 좋은지 나쁜지 알 수 없다. 몇 점이 본전인지 밝혀야 한다."""
        axis = ScoreAxis("roic_spread", "재투자 수익성", 41.5, "세후 ROIC 7.3%",
                         "재투자할수록 가치가 깎입니다.", "0~100점. 50점이 본전입니다.")
        self.assertIn("점수 눈금: 0~100점. 50점이 본전입니다.", axis.full_ko)
        # 숫자 → 눈금 → 해석 순서
        self.assertLess(axis.full_ko.index("세후 ROIC"), axis.full_ko.index("점수 눈금"))
        self.assertLess(axis.full_ko.index("점수 눈금"), axis.full_ko.index("깎입니다"))

    def test_every_scored_axis_states_its_own_scale(self):
        """축마다 산식이 다르다 — 공통 '0~100' 문구로 뭉뚱그리면 틀린 안내가 된다."""
        for anchor in ("50점이 수익률과 자본비용이 딱 맞는 본전",
                       "50점이 새로 넣은 돈의 수익 0%",
                       "60점이 주식수 변화 없음",
                       "무차입이 100점",
                       "순이익의 125% 이상이 현금으로"):
            self.assertIn(anchor, SCORECARD)


class LifeCycleMeaningTests(unittest.TestCase):
    def test_stage_meaning_explains_what_to_do(self):
        """'5단계 · 성숙 안정.' 만으로는 좋은지 나쁜지 알 수 없다."""
        diagnosis = LifeCycleDiagnosis(
            stage=STAGE_MATURE_STABLE,
            stage_label_ko="5단계 · 성숙 안정",
            confidence=0.8,
            playbook=STAGE_PLAYBOOK[STAGE_MATURE_STABLE],
        )
        meaning = diagnosis.stage_meaning_ko
        self.assertIn("5단계 · 성숙 안정", meaning)
        self.assertIn("값을 매길 때는", meaning)
        self.assertIn("가장 조심할 것은", meaning)
        self.assertIn("stage_meaning_ko", str(diagnosis.to_dict().keys()))

    def test_no_playbook_yields_empty_not_fabricated(self):
        diagnosis = LifeCycleDiagnosis(stage="x", stage_label_ko="미상", confidence=0.0)
        self.assertEqual(diagnosis.stage_meaning_ko, "")


class ToneContradictionTests(unittest.TestCase):
    def test_negative_excess_return_cannot_be_bullish(self):
        """실측: '[+] 재투자 수익성 … 초과수익 -1.7%p' 카드가 ✓강세로 표시됐다.
        모델이 마커를 잘못 붙여도 숫자는 반대를 말한다 — 사실이 마커를 이겨야 한다."""
        self.assertIn("초과수익\\s*[-−]\\d", HELPERS)
        guard = HELPERS.index("초과수익\\s*[-−]\\d")
        marker_rule = HELPERS.index("if (/^\\s*\\[\\+\\]/.test(text))")
        self.assertLess(guard, marker_rule, "모순 가드가 마커 규칙보다 앞에 있어야 한다")


class RawSignalWordTests(unittest.TestCase):
    def test_raw_signal_values_translated(self):
        """실측: '종합 신호 bearish. 신뢰도: 56.0점.'"""
        for raw in ("bearish", "bullish", "neutral"):
            self.assertIn(f"\\b{raw}\\b", NORMALIZER)

    def test_prompt_requires_interpretation(self):
        self.assertIn("숫자와 단계는 그 자체로 결론이 아니다", AGENT)
        self.assertIn("meaning_ko", AGENT)
        self.assertIn("stage_meaning_ko", AGENT)
        self.assertIn("점수를 적을 때는 눈금을 함께 밝혀라", AGENT)
        self.assertIn("scale_ko", AGENT)
        self.assertIn("신뢰도(confidence)도 마찬가지다", AGENT)


class SourceDisclosureTests(unittest.TestCase):
    """본문에 '실제 표현 확인' 숙제를 남기는 대신, 원문을 접어 두고 필요할 때 펼친다."""

    DISCLOSURE = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/filing-source-disclosure.tsx")
    SECTION = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/report-section.tsx")

    def test_disclosure_component_exists(self):
        self.assertTrue(self.DISCLOSURE.exists())

    def test_fetches_lazily_on_first_open(self):
        """원문은 수십만 자다. 미리 받으면 화면이 느려진다."""
        src = self.DISCLOSURE.read_text(encoding="utf-8")
        self.assertIn("if (!next || payload || loading || !ticker) return;", src)
        self.assertIn("/sec-filings/", src)

    def test_mounted_only_in_source_section(self):
        src = self.SECTION.read_text(encoding="utf-8")
        self.assertIn("section.id === 'section-06'", src)
        self.assertIn("FilingSourceDisclosure", src)

    def test_homework_items_dropped_from_evidence(self):
        """'검토 필요 … 실제 표현 확인.'은 분석 결과가 아니라 작성자에게 남긴 숙제다."""
        self.assertIn("isHomeworkEvidenceText", HELPERS)
        self.assertIn("HOMEWORK_HEAD_RE", HELPERS)
        self.assertIn("HOMEWORK_TAIL_RE", HELPERS)

    def test_homework_head_avoids_korean_word_boundary(self):
        r"""JS 정규식의 \b 는 한글 뒤에서 성립하지 않는다 — 규칙이 조용히 안 걸린다."""
        head_line = next(l for l in HELPERS.splitlines() if "HOMEWORK_HEAD_RE =" in l)
        self.assertNotIn("필요\\b", head_line)
        self.assertIn("필요(?![가-힣])", head_line)

    def test_cross_check_guide_is_three_short_lines(self):
        """크로스체크는 '다음에 뭘 볼지'만 짚는다. 길면 본문과 겹친다."""
        self.assertIn("1. **핵심 숫자 재확인:**", HELPERS)
        self.assertIn("아래 출처 섹션에서 바로 펼쳐 볼 수 있습니다", HELPERS)


if __name__ == "__main__":
    unittest.main()
