from pathlib import Path
from types import SimpleNamespace as S
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.life_cycle import (  # noqa: E402
    STAGE_DECLINE,
    STAGE_MATURE_STABLE,
    STAGE_YOUNG,
    diagnose,
)
from src.tools.management_scorecard import assess  # noqa: E402

AGENT_SRC = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")


def _items(rev, op, fcf, capex, dep, shares, eq, debt, ni):
    """실제 line_items 처럼 최신이 앞(index 0)."""
    return [
        S(revenue=rev[i], operating_income=op[i], ebit=op[i], free_cash_flow=fcf[i],
          capital_expenditure=-capex[i], depreciation_and_amortization=dep[i],
          outstanding_shares=shares[i], shareholders_equity=eq[i],
          total_debt=debt[i], net_income=ni[i])
        for i in range(len(rev))
    ]


YOUNG = _items(
    [1000, 700, 480, 320, 200], [-30, -40, -45, -40, -30], [-120, -140, -150, -120, -90],
    [300, 260, 220, 180, 140], [80, 60, 45, 32, 22], [120, 118, 115, 110, 100],
    [900, 850, 800, 700, 600], [300, 280, 250, 200, 150], [-40, -50, -55, -48, -35])

MATURE = _items(
    [5200, 5100, 5000, 4950, 4800], [1300, 1250, 1230, 1200, 1150], [1100, 1050, 1000, 980, 930],
    [300, 310, 300, 290, 280], [320, 315, 310, 300, 290], [80, 84, 88, 92, 100],
    [4000, 3900, 3800, 3700, 3600], [1200, 1200, 1150, 1100, 1000], [980, 940, 920, 900, 860])

DECLINE = _items(
    [3000, 3300, 3600, 3900, 4200], [120, 220, 330, 450, 560], [-50, 20, 90, 160, 240],
    [420, 400, 380, 360, 340], [250, 250, 250, 250, 250], [110, 106, 103, 101, 100],
    [2000, 2100, 2200, 2300, 2400], [1800, 1700, 1600, 1500, 1400], [60, 150, 240, 340, 430])


class LifeCycleTests(unittest.TestCase):
    """Damodaran 생애주기 진단의 회귀 방지."""

    def test_stage_classification(self):
        self.assertEqual(diagnose(YOUNG).stage, STAGE_YOUNG)
        self.assertEqual(diagnose(MATURE).stage, STAGE_MATURE_STABLE)
        self.assertEqual(diagnose(DECLINE).stage, STAGE_DECLINE)

    def test_revenue_trajectory_gates_the_stage(self):
        """매출이 역성장인데 마진·투자 신호가 성장으로 투표해 '초기 성장'으로
        오판되던 문제(실측). 매출 궤적이 1차 축이어야 한다."""
        diagnosis = diagnose(DECLINE)
        self.assertIn(diagnosis.stage, (STAGE_DECLINE, STAGE_MATURE_STABLE))
        self.assertNotEqual(diagnosis.stage, STAGE_YOUNG)

    def test_stage_playbook_is_attached(self):
        """단계별 '맞는 가치평가법'이 함께 나와야 리포트에서 쓸 수 있다."""
        for items in (YOUNG, MATURE, DECLINE):
            playbook = diagnose(items).playbook
            for key in ("valuation_ko", "strategy_ko", "management_ko", "key_risk_ko"):
                self.assertIn(key, playbook)

    def test_stage_strategy_mismatch_is_penalised(self):
        """책의 핵심 주장 — 쇠퇴기에 과잉 재투자하면 전략 이행도가 떨어져야 한다."""
        decline = diagnose(DECLINE)
        self.assertIsNotNone(decline.alignment_score)
        self.assertLess(decline.alignment_score, 60)
        self.assertTrue(any("과잉 재투자" in note for note in decline.alignment_notes_ko))

        mature = diagnose(MATURE)
        self.assertGreaterEqual(mature.alignment_score, 80)

    def test_insufficient_data_is_flagged_not_guessed(self):
        empty = diagnose([])
        self.assertTrue(empty.insufficient)


class ManagementScorecardTests(unittest.TestCase):
    """자본배분 기반 경영진 평가의 회귀 방지."""

    def test_early_stage_exempt_from_maturity_yardsticks(self):
        """적자가 정상인 초기 단계를 ROIC·차입배수로 재단하면 안 된다
        (Damodaran 이 지적한 '나이에 안 맞는 평가')."""
        staged = assess(YOUNG, wacc=0.09, stage="young_growth")
        for axis in staged.axes:
            if axis.key in ("roic_spread", "incremental_roic", "leverage"):
                self.assertIsNone(axis.score, f"{axis.key} must be exempt for early stage")

    def test_single_axis_does_not_produce_verdict(self):
        """근거 1개로 경영진 등급을 단정하지 않는다."""
        staged = assess(YOUNG, wacc=0.09, stage="young_growth")
        scored = [a for a in staged.axes if a.score is not None]
        if len(scored) < 2:
            self.assertTrue(staged.insufficient)
            self.assertIn("보류", staged.grade_ko)

    def test_incremental_roic_needs_material_capital_change(self):
        """투하자본이 거의 안 변했는데 이익이 흔들리면 증분 수익률이 폭주한다
        (실측: 자본 +20에 이익 -252 → -1260%)."""
        flat_capital = _items(
            [3010, 2589, 3022, 3773, 2796], [320, 65, 656, 433, 516], [180, -30, 380, 210, 290],
            [480, 530, 490, 530, 470], [400, 380, 360, 340, 320], [5919, 5919, 5969, 5969, 5969],
            [3630, 3450, 3630, 3450, 3040], [120, 110, 100, 95, 90], [340, 154, 554, 556, 399])
        result = assess(flat_capital, wacc=0.105, stage="mature_stable")
        axis = next(a for a in result.axes if a.key == "incremental_roic")
        self.assertIsNone(axis.score, "미미한 자본 변화로 증분 수익률을 산정하면 안 된다")

    def test_mature_good_allocator_scores_well(self):
        result = assess(MATURE, wacc=0.09, stage="mature_stable")
        self.assertIsNotNone(result.overall)
        self.assertGreater(result.overall, 70)

    def test_no_score_is_invented_without_data(self):
        result = assess([], wacc=0.09)
        self.assertTrue(result.insufficient)
        self.assertIsNone(result.overall)


class AgentWiringTests(unittest.TestCase):
    """Damodaran 에이전트에 실제로 연결됐는지."""

    def test_agent_computes_and_attaches(self):
        self.assertIn("from src.tools.life_cycle import diagnose as diagnose_life_cycle", AGENT_SRC)
        self.assertIn("from src.tools.management_scorecard import assess as assess_management", AGENT_SRC)
        self.assertIn('analysis_data[ticker]["life_cycle"]', AGENT_SRC)
        self.assertIn('analysis_data[ticker]["management_assessment"]', AGENT_SRC)
        # 단계를 경영진 평가에 넘겨야 단계 인식이 작동한다
        self.assertIn("stage=life_cycle.stage", AGENT_SRC)

    def test_prompt_instructs_use_of_computed_values(self):
        """계산된 값을 쓰라고 지시하지 않으면 LLM 이 무시하거나 지어낸다."""
        self.assertIn("CORPORATE LIFE CYCLE REQUIREMENT", AGENT_SRC)
        self.assertIn("life_cycle.playbook.valuation_ko", AGENT_SRC)
        self.assertIn("life_cycle.alignment_score", AGENT_SRC)
        self.assertIn("management_assessment", AGENT_SRC)
        # 검증 불가 항목 창작 금지
        self.assertIn("절대 지어내지 마라", AGENT_SRC)


if __name__ == "__main__":
    unittest.main()
