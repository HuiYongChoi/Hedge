"""매크로(시장 레짐) 연동 검증.

여기서 지키려는 것은 두 가지다.
    1. 공급 측이 없거나 죽어도 분석이 이전과 100% 똑같이 나온다.
    2. 잘못된 값이 할인율로 들어가 적정가를 붕괴시키지 않는다.
"""

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.tools.macro_regime import fetch_macro_regime  # noqa: E402
from src.utils.capm import (  # noqa: E402
    DAMODARAN_ERP,
    DAMODARAN_RISK_FREE,
    VALUATION_ERP,
    VALUATION_RISK_FREE,
    cost_of_equity,
    macro_from_state,
    resolve_risk_free_rate,
)

DAMO = (ROOT / "src/agents/aswath_damodaran.py").read_text(encoding="utf-8")
VAL = (ROOT / "src/agents/valuation.py").read_text(encoding="utf-8")
GRAPH = (ROOT / "app/backend/services/graph.py").read_text(encoding="utf-8")
HELPERS = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text(encoding="utf-8")


class FallbackTests(unittest.TestCase):
    """매크로가 없을 때 기존 동작이 한 자리도 바뀌면 안 된다."""

    def test_no_macro_keeps_damodaran_constant(self):
        rate, source = resolve_risk_free_rate(None, DAMODARAN_RISK_FREE)
        self.assertEqual(rate, 0.04)
        self.assertIsNone(source)

    def test_no_macro_keeps_valuation_constant(self):
        self.assertEqual(resolve_risk_free_rate(None, VALUATION_RISK_FREE)[0], 0.045)

    def test_malformed_payload_falls_back(self):
        for bad in ({}, {"discountInputs": None}, {"discountInputs": {}},
                    {"discountInputs": {"riskFreeRate": None}},
                    {"discountInputs": {"riskFreeRate": "4.72"}}):
            self.assertEqual(resolve_risk_free_rate(bad, 0.04)[0], 0.04, bad)

    def test_endpoint_absent_today_returns_none(self):
        """공급 측은 아직 열리지 않았다(Unknown proxy action). None 은 정상 경로다."""
        self.assertIsNone(fetch_macro_regime("2999-01-01"))

    def test_backtest_does_not_fetch_today_rate(self):
        """과거 분석에 오늘 금리를 넣으면 그 자체로 미래 정보 유입이다."""
        self.assertIsNone(fetch_macro_regime("2020-01-01"))

    def test_macro_from_state_survives_garbage(self):
        for state in (None, {}, {"data": {}}, {"data": {"macro_regime": "x"}}, object()):
            self.assertIsNone(macro_from_state(state))


class UnitAndOutlierTests(unittest.TestCase):
    def test_percent_and_decimal_both_accepted(self):
        self.assertAlmostEqual(resolve_risk_free_rate({"discountInputs": {"riskFreeRate": 4.72}}, 0.04)[0], 0.0472)
        self.assertAlmostEqual(resolve_risk_free_rate({"discountInputs": {"riskFreeRate": 0.0472}}, 0.04)[0], 0.0472)

    def test_absurd_rate_rejected(self):
        """단위 실수(47.2%)가 할인율이 되면 적정가가 통째로 무너진다."""
        for absurd in (47.2, 0.0001, -4.72, 99):
            self.assertEqual(resolve_risk_free_rate({"discountInputs": {"riskFreeRate": absurd}}, 0.04)[0], 0.04, absurd)

    def test_source_is_recorded_for_reproducibility(self):
        _, source = resolve_risk_free_rate(
            {"discountInputs": {"riskFreeRate": 4.72}, "asOf": "2026-08-29"}, 0.04)
        self.assertIn("4.72%", source)
        self.assertIn("2026-08-29", source)


class ErpMisinjectionTests(unittest.TestCase):
    """ERP 자리에 '이익수익률 − 국채금리'(Fed 모델 갭)를 넣는 사고 방지.

    실측(삼성전자 β 1.55, FCFF 69.55조): ERP 를 갭(-1.36%)으로 바꾸면
    할인율 12.47% → 2.61%, 분모(ke − g) 0.0011, 적정가 758조 → 68,443조.
    90배다. β 가 2 를 넘으면 분모가 음수가 되어 적정가가 음수로 나온다.
    """

    def test_negative_erp_is_rejected(self):
        with self.assertRaises(ValueError):
            cost_of_equity(1.55, 0.0472, -0.0136)

    def test_zero_erp_is_rejected(self):
        with self.assertRaises(ValueError):
            cost_of_equity(1.55, 0.0472, 0.0)

    def test_discount_rate_stays_above_terminal_growth(self):
        """정상 입력이면 어떤 β 에서도 할인율이 영구성장률(2.5%)을 넘는다."""
        for beta in (0.3, 1.0, 1.55, 2.5):
            for rf, erp in ((DAMODARAN_RISK_FREE, DAMODARAN_ERP), (VALUATION_RISK_FREE, VALUATION_ERP)):
                self.assertGreater(cost_of_equity(beta, rf, erp), 0.025 + 0.02)

    def test_live_rate_moves_value_modestly_not_catastrophically(self):
        """실시간 금리 주입은 적정가를 한 자릿수 % 움직여야 한다(실측 -7.3%)."""
        fcff, g, years = 69.55e12, 0.025, 5

        def intrinsic(ke):
            pv = sum(fcff * (1 + g) ** t / (1 + ke) ** t for t in range(1, years + 1))
            terminal = fcff * (1 + g) ** years * (1 + g) / (ke - g)
            return pv + terminal / (1 + ke) ** years

        base = intrinsic(cost_of_equity(1.55, DAMODARAN_RISK_FREE, DAMODARAN_ERP))
        live = intrinsic(cost_of_equity(1.55, 0.0472, DAMODARAN_ERP))
        self.assertLess(abs(live / base - 1), 0.15)


class WiringTests(unittest.TestCase):
    def test_both_engines_share_the_risk_free_source(self):
        """한 리포트에 서로 다른 금리로 계산된 적정가 두 개가 뜨면 안 된다."""
        for src in (DAMO, VAL):
            self.assertIn("from src.utils.capm import", src)
            self.assertIn("resolve_risk_free_rate", src)

    def test_erp_is_not_unified(self):
        """ERP 는 관측값이 아니라 모형 가정이다. 합치면 기존 밸류에이션이 조용히 바뀐다."""
        self.assertNotEqual(DAMODARAN_ERP, VALUATION_ERP)

    def test_both_engines_record_the_rate_used(self):
        for src in (DAMO, VAL):
            self.assertIn('"risk_free_rate"', src)
            self.assertIn('"risk_free_source"', src)

    def test_rate_is_recorded_only_when_actually_injected(self):
        """이 dict 는 그대로 LLM 프롬프트에 들어간다.

        상수를 쓴 날에도 필드를 넣으면 프롬프트에 'risk_free_source: null' 이
        실리고, 그 찌꺼기가 본문으로 새어 나온 전례가 있다. 그래서 실시간 금리를
        실제로 쓴 경우에만 기록한다 — 덕분에 매크로 부재 시 프롬프트가
        연동 이전과 바이트 단위로 같다.
        """
        for src in (DAMO, VAL):
            self.assertIn("if risk_free_source:", src)

    def test_macro_runs_before_analysts(self):
        self.assertIn('graph.add_node("macro_prefetch", macro_prefetch_node)', GRAPH)
        self.assertIn('graph.add_edge("forward_prefetch", "macro_prefetch")', GRAPH)
        self.assertIn('graph.add_edge("macro_prefetch", agent_id)', GRAPH)
        self.assertNotIn('graph.add_edge("forward_prefetch", agent_id)', GRAPH)

    def test_prefetch_node_is_not_a_report_tab(self):
        self.assertIn("baseKey !== 'macro_prefetch'", HELPERS)

    def test_macro_failure_cannot_stop_analysis(self):
        node = (ROOT / "src/agents/macro_prefetch.py").read_text(encoding="utf-8")
        self.assertIn("except Exception:", node)
        self.assertIn('data["macro_regime"] = None', node)


if __name__ == "__main__":
    unittest.main()
