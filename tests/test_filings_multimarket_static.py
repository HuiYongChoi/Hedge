from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DISPATCH = (ROOT / "src/tools/filings.py").read_text(encoding="utf-8")
TYPES = (ROOT / "src/tools/filing_types.py").read_text(encoding="utf-8")
DART = (ROOT / "src/tools/dart_filings.py").read_text(encoding="utf-8")
EDINET = (ROOT / "src/tools/edinet_filings.py").read_text(encoding="utf-8")
SEC = (ROOT / "src/tools/sec_filings.py").read_text(encoding="utf-8")
LLM = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")
ROUTE = (ROOT / "app/backend/routes/sec_filings.py").read_text(encoding="utf-8")
EDINET_DOC = ROOT / "docs/filings/EDINET_SETUP.md"


class MultiMarketFilingStaticTests(unittest.TestCase):
    """미국/한국/일본 공시 원문 수집의 회귀 방지."""

    # ── 공용 구조 ──────────────────────────────────────────────────────────
    def test_shared_types_used_by_all_markets(self):
        self.assertIn("class FilingSections", TYPES)
        self.assertIn('market: str', TYPES)
        for name, src in (("sec", SEC), ("dart", DART), ("edinet", EDINET)):
            self.assertIn(
                "from src.tools.filing_types import FilingSection, FilingSections", src,
                f"{name} must use shared types",
            )
        # 중복 정의가 남아 있으면 안 된다
        self.assertNotIn("class FilingSection:", SEC)

    def test_dispatcher_routes_by_market(self):
        self.assertIn("def detect_market(", DISPATCH)
        self.assertIn("def fetch_filing_sections(", DISPATCH)
        self.assertIn("from src.tools.dart_filings import", DISPATCH)
        self.assertIn("from src.tools.edinet_filings import", DISPATCH)
        self.assertIn("from src.tools.sec_filings import fetch_latest_filing_sections", DISPATCH)

    def test_market_detection_rules(self):
        """한국 6자리 / 일본 4자리·.T / 나머지 미국."""
        self.assertIn('.KS", ".KQ"', DISPATCH)
        self.assertIn('value.endswith(".T")', DISPATCH)
        self.assertIn("len(value) == 6", DISPATCH)
        self.assertIn("len(value) == 4", DISPATCH)

    def test_annual_and_quarterly_supported(self):
        """10-Q / 분기보고서 / 四半期報告書 모두 period='quarterly' 로 접근."""
        self.assertIn('"annual": "10-K", "quarterly": "10-Q"', DISPATCH)
        self.assertIn("QUARTERLY_REPORTS", DART)
        self.assertIn("QUARTERLY_DOC_TYPES", EDINET)
        self.assertIn('SEC_GROUNDING_PERIOD', LLM)
        self.assertIn('pattern="^(annual|quarterly)$"', ROUTE)

    # ── 한국(DART) ────────────────────────────────────────────────────────
    def test_dart_uses_document_api_not_financials(self):
        """기존 dart_api.py 는 재무제표용이라 서술 원문이 없다. document.xml 이 필요."""
        self.assertIn("opendart.fss.or.kr/api/document.xml", DART)
        self.assertIn("opendart.fss.or.kr/api/corpCode.xml", DART)
        self.assertIn("zipfile.ZipFile", DART)

    def test_dart_section_mapping(self):
        """한국 보고서를 미국 Item 키에 맞춰 통일한다."""
        self.assertIn('("1", "사업의 내용"', DART)
        self.assertIn("이사의 경영진단", DART)

    def test_dart_headings_use_ascii_roman_only(self):
        """대제목은 ASCII 로마숫자, 본문 표 제목은 전각(Ⅰ,Ⅱ). ASCII 만 잡아야
        소제목을 섹션으로 오인하지 않는다(실측 확인)."""
        self.assertIn("_KR_HEADING_RE", DART)
        self.assertIn("I{1,3}|IV|VI{0,3}|V|IX|XI{0,2}|X", DART)

    def test_dart_key_from_env_only(self):
        """키를 소스에 하드코딩하지 않는다."""
        self.assertIn('os.environ.get("DART_API_KEY"', DART)
        self.assertNotIn("514cd3e", DART)

    # ── 일본(EDINET) ──────────────────────────────────────────────────────
    def test_edinet_requires_subscription_key_and_degrades(self):
        """키가 없으면 조용히 원문 없이 진행해야 한다(분석을 막지 않음)."""
        self.assertIn('os.environ.get("EDINET_API_KEY"', EDINET)
        self.assertIn("Ocp-Apim-Subscription-Key", EDINET)
        self.assertIn("EDINET_API_KEY not configured", EDINET)
        self.assertIn("def is_configured(", EDINET)

    def test_edinet_setup_doc_exists(self):
        self.assertTrue(EDINET_DOC.exists(), "EDINET 키 발급 안내 문서가 있어야 한다")
        doc = EDINET_DOC.read_text(encoding="utf-8")
        self.assertIn("EDINET_API_KEY", doc)
        self.assertIn("api.edinet-fsa.go.jp", doc)

    def test_edinet_section_mapping(self):
        self.assertIn("事業等のリスク", EDINET)
        self.assertIn("経営者による", EDINET)
        self.assertIn("secCode", EDINET)

    # ── 주입 ──────────────────────────────────────────────────────────────
    def test_injection_uses_dispatcher(self):
        self.assertIn("from src.tools.filings import build_grounding_context, fetch_filing_sections", LLM)
        self.assertNotIn("from src.tools.sec_filings import build_grounding_context", LLM)

    def test_all_markets_fail_soft(self):
        for name, src in (("dart", DART), ("edinet", EDINET), ("sec", SEC)):
            self.assertIn("except Exception as exc:", src, f"{name} must fail soft")
            self.assertIn("result.error = ", src)


if __name__ == "__main__":
    unittest.main()
