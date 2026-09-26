from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
QUALITY_BUY_TAB = ROOT / "app/frontend/src/components/tabs/quality-buy-tab.tsx"
SCREENER_API = ROOT / "app/frontend/src/services/screener-api.ts"
TABLE_EXPORT = ROOT / "app/frontend/src/lib/table-export.ts"


class QualityBuyTabStaticTests(unittest.TestCase):

    def test_result_row_shows_current_price(self):
        """스캐너가 돌려주는 price_per_share 를 화면에 '현재가'로 보여 준다."""
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("formatPrice(result.value.price_per_share ?? null, result.market)", src)
        self.assertIn("'현재가'", src)

    def test_financials_are_a_separate_section(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("verdict: 'financial'", src)
        self.assertIn("금융업 · 별도 판단", src)
        api = SCREENER_API.read_text(encoding="utf-8")
        self.assertIn("| 'financial'", api)

    def test_model_misfit_warning_icon_explains_on_hover(self):
        """괴리가 극단적이거나 금융업이면 경고 아이콘과 호버 설명을 단다."""
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("<ModelFitWarning warnings={result.warnings} lang={lang} />", src)
        self.assertIn("모델 부적합 가능성", src)
        self.assertIn("extreme_gap:", src)
        self.assertIn("financial_sector:", src)
        api = SCREENER_API.read_text(encoding="utf-8")
        self.assertIn("export type ScreenerWarning = 'extreme_gap' | 'financial_sector';", api)


    def test_result_row_shows_sector_badge(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("const sector = sectorLabel(result.sector, lang);", src)
        self.assertIn("'Financial Services': '금융'", src)
        self.assertIn("sector?: string | null;", SCREENER_API.read_text(encoding="utf-8"))

    def test_rows_offer_on_demand_point_in_time_check(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("<HistoryPanel result={result} lang={lang} />", src)
        self.assertIn(".historyCheck(result.ticker, result.market, result.industry)", src)
        self.assertIn("'과거 검증'", src)
        self.assertIn("/screener/history-check?", SCREENER_API.read_text(encoding="utf-8"))

    def test_forward_test_track_record_panel(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("<TrackRecordPanel lang={lang} />", src)
        self.assertIn("판정 성과 추적 (전진 검증)", src)
        self.assertIn("/screener/track-record", SCREENER_API.read_text(encoding="utf-8"))

    def test_full_list_exports_to_excel_and_pdf(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("downloadXlsx(table, filename);", src)
        self.assertIn("printTableAsPdf(table, filename);", src)
        export = TABLE_EXPORT.read_text(encoding="utf-8")
        # 라이브러리 없이 만든다 — 새 npm 의존성을 들이지 않는다.
        self.assertNotIn("from '", export)
        self.assertIn("export function buildXlsxBytes(", export)
        self.assertIn("xl/worksheets/sheet1.xml", export)


if __name__ == "__main__":
    unittest.main()
