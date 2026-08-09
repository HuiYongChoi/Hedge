from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
V5_DIR = ROOT / "app/frontend/src/components/reports/analyst-report-v5"
SAVED_DIR = ROOT / "app/frontend/src/components/saved-analyses"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"


class SnapshotDiffStaticTests(unittest.TestCase):
    """저장 시점 시장 스냅샷 + 이전 분석 대비 변화(diff) 기능의 회귀 방지.

    배경: 저장 분석을 나중에 열면 liveTarget이 재조회되어 목표가/컨센 EPS/현재가가
    '오늘 값'으로 덮인다. 그래서 저장 시점 값을 result_data.market_snapshot에
    따로 남겨야 무엇이 언제 어떻게 변했는지 추적할 수 있다.
    """

    def test_market_snapshot_module_exists(self):
        src = (V5_DIR / "market-snapshot.ts").read_text(encoding="utf-8")
        self.assertIn("export interface MarketSnapshot", src)
        self.assertIn("export function buildMarketSnapshot(", src)
        self.assertIn("export function readMarketSnapshot(", src)
        self.assertIn("export function diffMarketSnapshots(", src)

    def test_snapshot_captures_cycle_relevant_fields(self):
        # 하락장 판단에 필요한 필드: 컨센 EPS·목표가·PER·PBR·변동성이 모두 있어야 한다.
        src = (V5_DIR / "market-snapshot.ts").read_text(encoding="utf-8")
        for field in (
            "currentPrice", "consensusTarget", "forwardEps", "forwardPer",
            "trailingPer", "pbr", "sigmaAnnual", "signal", "compositeScore",
        ):
            self.assertIn(f"{field}:", src, f"snapshot missing field: {field}")

    def test_price_move_attribution_present(self):
        # 주가 변화를 이익(EPS) 요인과 배수(심리) 요인으로 분해 — 하락장 핵심 판단 도구.
        src = (V5_DIR / "market-snapshot.ts").read_text(encoding="utf-8")
        self.assertIn("export function attributePriceMove(", src)
        self.assertIn("multipleChangePct", src)
        self.assertIn("'earnings'", src)
        self.assertIn("'multiple'", src)

    def test_save_path_persists_snapshot(self):
        # onSave가 스냅샷을 받아 result_data.market_snapshot에 저장해야 한다.
        layout = (V5_DIR / "report-layout.tsx").read_text(encoding="utf-8")
        self.assertIn("buildMarketSnapshot({", layout)
        self.assertIn("onSave={handleSaveWithSnapshot}", layout)

        types_src = (V5_DIR / "types.ts").read_text(encoding="utf-8")
        self.assertIn("onSave?: (marketSnapshot?:", types_src)

        tab = STOCK_TAB.read_text(encoding="utf-8")
        self.assertIn("handleSaveAnalysis = async (marketSnapshot?: MarketSnapshot)", tab)
        self.assertIn("market_snapshot: snapshotToSave ?? null", tab)
        # 탭 상단 저장 버튼은 리포트 내부 liveTarget 에 접근할 수 없다 —
        # 리포트가 올려준 스냅샷을 ref 로 들고 있다가 저장 시 사용해야 한다.
        self.assertIn("latestMarketSnapshotRef", tab)
        self.assertIn("onMarketSnapshotChange={snapshot =>", tab)
        self.assertIn(
            "marketSnapshot ?? latestMarketSnapshotRef.current ?? undefined", tab
        )
        # MouseEvent 가 marketSnapshot 자리로 들어가지 않도록 인자 없이 호출
        self.assertIn("onClick={() => handleSaveAnalysis()}", tab)
        self.assertNotIn("onClick={handleSaveAnalysis}", tab)

    def test_diff_panel_wired_into_saved_detail(self):
        panel = (SAVED_DIR / "snapshot-diff-panel.tsx").read_text(encoding="utf-8")
        self.assertIn("export function SnapshotDiffPanel(", panel)
        # 스냅샷이 없는 과거 저장분에서도 깨지지 않고 안내를 띄운다
        self.assertIn("if (!currentSnap) {", panel)
        # 부모 의존 없이 같은 종목 이력을 직접 조회
        self.assertIn("savedAnalysisService", panel)
        self.assertIn("source_tab: 'stock_analysis'", panel)

        detail = (SAVED_DIR / "saved-detail-panel.tsx").read_text(encoding="utf-8")
        self.assertIn("<SnapshotDiffPanel current={detail} language={language} />", detail)

    def test_diff_compares_only_earlier_saves(self):
        # 비교 대상은 '현재보다 과거'이면서 스냅샷을 가진 저장분이어야 한다.
        panel = (SAVED_DIR / "snapshot-diff-panel.tsx").read_text(encoding="utf-8")
        self.assertIn("new Date(item.created_at).getTime() < new Date(current.created_at).getTime()", panel)
        self.assertIn("readMarketSnapshot(item.result_data) !== null", panel)


if __name__ == "__main__":
    unittest.main()
