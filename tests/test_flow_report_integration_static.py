from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FE = ROOT / "app/frontend/src"
ADAPTER = (FE / "components/reports/analyst-report-v5/flow-result-adapter.ts").read_text(encoding="utf-8")
REPORT_OUT = (FE / "components/panels/bottom/tabs/flow-report-output.tsx").read_text(encoding="utf-8")
OUTPUT_TAB = (FE / "components/panels/bottom/tabs/output-tab.tsx").read_text(encoding="utf-8")
SAVED_SVC = (FE / "services/saved-analyses-service.ts").read_text(encoding="utf-8")
SAVED_HELPERS = (FE / "components/saved-analyses/helpers.ts").read_text(encoding="utf-8")
SAVED_DETAIL = (FE / "components/saved-analyses/saved-detail-panel.tsx").read_text(encoding="utf-8")


class FlowReportIntegrationStaticTests(unittest.TestCase):
    """플로우 ↔ 종목분석 통합의 회귀 방지.

    배경: 플로우와 종목분석은 백엔드가 같다(/hedge-fund/run + graph_nodes/edges).
    갈라진 건 결과 표현뿐이라, 어댑터 한 겹으로 v5 리포트를 공유한다.
    """

    def test_adapter_exists_and_maps_shapes(self):
        self.assertIn("export function buildFlowReportInput(", ADAPTER)
        self.assertIn("export function toCompleteResult(", ADAPTER)
        self.assertIn("export function toAgentResults(", ADAPTER)
        self.assertIn("export function resolveFlowTickers(", ADAPTER)

    def test_adapter_excludes_backtest_node(self):
        """백테스트 진행 노드는 분석 근거가 아니므로 리포트에 넣지 않는다."""
        self.assertIn("if (agentKey === 'backtest') continue;", ADAPTER)

    def test_adapter_uses_signal_for_the_selected_ticker(self):
        """근거 카드 본문은 해당 종목에 대한 신호에서 온다."""
        self.assertIn("signals?.[agentKey]?.[ticker]", ADAPTER)

    def test_adapter_degrades_when_no_result(self):
        """실행 전이거나 판단이 비면 null — 호출부가 안내 문구를 띄운다."""
        self.assertIn("if (!completeResult) return null;", ADAPTER)
        self.assertIn("if (tickers.length === 0) return null;", ADAPTER)

    def test_flow_output_reuses_v5_dashboard(self):
        """플로우 전용 렌더를 새로 만들지 않고 종목분석 리포트를 그대로 쓴다."""
        self.assertIn("import { AnalystReportDashboard }", REPORT_OUT)
        self.assertIn("<AnalystReportDashboard", REPORT_OUT)
        self.assertIn("calculateCompositeScore", REPORT_OUT)

    def test_output_tab_has_report_view_toggle(self):
        self.assertIn("FlowReportOutput", OUTPUT_TAB)
        self.assertIn("view === 'report'", OUTPUT_TAB)
        self.assertIn("view === 'raw'", OUTPUT_TAB)
        # 백테스트 실행에는 리포트 보기를 띄우지 않는다
        self.assertIn("const canShowReport = !isBacktestRun && Boolean(outputData?.decisions);", OUTPUT_TAB)

    def test_flow_results_can_be_archived(self):
        """저장 분석이 flow 를 받아야 이전에 만든 변화 추적 diff 를 플로우에도 쓸 수 있다."""
        self.assertIn("'stock_compare' | 'flow'", SAVED_SVC)
        self.assertIn("saveAnalysis(\n        'flow',", REPORT_OUT)
        # 시장 스냅샷도 함께 저장해야 diff 가 동작한다
        self.assertIn("market_snapshot: marketSnapshot ?? null", REPORT_OUT)

    def test_saved_analyses_renders_flow_like_stock_analysis(self):
        self.assertIn("source === 'flow'", SAVED_HELPERS)
        self.assertIn("detail.source_tab === 'flow'", SAVED_DETAIL)
        # 종목분석과 동일하게 diff 패널 + 리포트를 붙인다
        self.assertIn("<SnapshotDiffPanel current={detail} language={language} />", SAVED_DETAIL)


if __name__ == "__main__":
    unittest.main()
