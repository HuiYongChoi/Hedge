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
        self.assertIn("export type ScreenerWarning = 'extreme_gap' | 'financial_sector' | 'tech_valuation';", api)
        # 기술주 경고는 판정 근거가 된 검증 수치와 함께 보여 준다.
        self.assertIn("tech_valuation: {", src)


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
        self.assertIn("printElementAsPdf(printRef.current, filename, table.subtitle);", src)
        export = TABLE_EXPORT.read_text(encoding="utf-8")
        # 라이브러리 없이 만든다 — 새 npm 의존성을 들이지 않는다.
        self.assertNotIn("from '", export)
        self.assertIn("export function buildXlsxBytes(", export)
        self.assertIn("xl/worksheets/sheet1.xml", export)


if __name__ == "__main__":
    unittest.main()


STOCK_EXTRAS = ROOT / "app/frontend/src/components/quality-buy/stock-extras.tsx"
SAVED_DETAIL_PANEL = ROOT / "app/frontend/src/components/saved-analyses/saved-detail-panel.tsx"
SAVED_QUALITY_BUY_DETAIL = ROOT / "app/frontend/src/components/saved-analyses/saved-quality-buy-detail.tsx"


class QualityBuyArchiveLinksChartStaticTests(unittest.TestCase):

    def test_rows_toggle_research_links(self):
        """행마다 '바로가기'를 펼치면 네이버 증권·DART(한국), SEC·네이버(미국) 링크가 나온다."""
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("<ResearchLinksPanel result={result} lang={lang} />", src)
        extras = STOCK_EXTRAS.read_text(encoding="utf-8")
        self.assertIn("https://finance.naver.com/item/main.naver?code=", extras)
        self.assertIn("dart.fss.or.kr/dsab001/main.do?autoSearch=true&option=corp", extras)
        self.assertIn("sec.gov/cgi-bin/browse-edgar?action=getcompany", extras)
        self.assertIn(".fetchNaverLink(result.ticker)", extras)
        self.assertIn("/screener/naver-link?", SCREENER_API.read_text(encoding="utf-8"))

    def test_rows_show_one_year_chart_on_hover(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("<PriceChartHover result={result} lang={lang} />", src)
        extras = STOCK_EXTRAS.read_text(encoding="utf-8")
        self.assertIn("onMouseEnter={() => setHovered(true)}", extras)
        # 구역이 overflow-hidden 이라 팝업은 body 로 띄운다
        self.assertIn("createPortal(", extras)
        self.assertIn("/screener/price-chart?", SCREENER_API.read_text(encoding="utf-8"))

    def test_stopped_scans_are_archived_and_viewable(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("onArchived: info =>", src)
        self.assertIn("'저장 분석'에 '중단'으로 저장했습니다", src)
        self.assertIn("export function QualityBuyResultsView(", src)
        self.assertIn("export function restoreQualityBuyScan(", src)
        panel = SAVED_DETAIL_PANEL.read_text(encoding="utf-8")
        self.assertIn("<SavedQualityBuyDetail detail={detail} language={language} />", panel)
        self.assertIn("<QualityBuyResultsView", SAVED_QUALITY_BUY_DETAIL.read_text(encoding="utf-8"))


    def test_manual_archive_button_and_screen_pdf(self):
        src = QUALITY_BUY_TAB.read_text(encoding="utf-8")
        self.assertIn("savedAnalysisService.saveAnalysis('quality_buy'", src)
        self.assertIn("'저장 분석에 저장'", src)
        export = TABLE_EXPORT.read_text(encoding="utf-8")
        self.assertIn("export function printElementAsPdf(", export)
        self.assertIn("print-color-adjust: exact", export)


class NightlyScanStaticTests(unittest.TestCase):

    def test_nightly_timers_call_full_index_scan(self):
        script = (ROOT / "scripts/screener_nightly.sh").read_text(encoding="utf-8")
        self.assertIn("/screener/scan", script)
        service = (ROOT / "scripts/systemd/hedge-screener@.service").read_text(encoding="utf-8")
        self.assertIn("screener_nightly.sh %i", service)
        self.assertIn("Unit=hedge-screener@SP500.service", (ROOT / "scripts/systemd/hedge-screener-sp500.timer").read_text(encoding="utf-8"))
        self.assertIn("Unit=hedge-screener@KOSPI.service", (ROOT / "scripts/systemd/hedge-screener-kospi.timer").read_text(encoding="utf-8"))
