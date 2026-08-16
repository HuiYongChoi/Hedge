from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SEC_SRC = (ROOT / "src/tools/sec_filings.py").read_text(encoding="utf-8")
LLM_SRC = (ROOT / "src/utils/llm.py").read_text(encoding="utf-8")
ROUTE_SRC = (ROOT / "app/backend/routes/sec_filings.py").read_text(encoding="utf-8")
ROUTES_INIT = (ROOT / "app/backend/routes/__init__.py").read_text(encoding="utf-8")


class SecFilingsStaticTests(unittest.TestCase):
    """SEC 원문 수집·파싱 파이프라인의 회귀 방지.

    배경: SOURCE GROUNDING 지침은 '제공된 자료 밖은 쓰지 마라'고 요구하는데
    정작 제공되는 게 숫자 지표뿐이면 모델이 서술을 기억으로 채운다.
    실제 10-K 원문(리스크·MD&A)을 프롬프트에 넣어야 지침이 의미를 갖는다.
    """

    # ── 수집 ────────────────────────────────────────────────────────────────
    def test_no_third_party_parser_dependency(self):
        """서버에 새 패키지를 깔지 않아도 되도록 표준 라이브러리만 쓴다."""
        # 주석에 이름이 언급되는 건 무방하다. 실제 import 문만 검사한다.
        import_lines = [
            line for line in SEC_SRC.splitlines()
            if re.match(r"\s*(?:import|from)\s+\w", line)
        ]
        joined = "\n".join(import_lines)
        for banned in ("bs4", "BeautifulSoup", "lxml", "html5lib", "requests"):
            self.assertNotIn(banned, joined, f"must not import {banned}")
        self.assertIn("import urllib.request", SEC_SRC)

    def test_sec_requires_user_agent(self):
        """SEC 는 연락처가 담긴 User-Agent 를 요구한다(없으면 403)."""
        self.assertIn("SEC_USER_AGENT", SEC_SRC)
        self.assertIn('"User-Agent": SEC_USER_AGENT', SEC_SRC)

    def test_ticker_to_cik_and_submissions(self):
        self.assertIn("company_tickers.json", SEC_SRC)
        self.assertIn("data.sec.gov/submissions/CIK{cik:010d}.json", SEC_SRC)
        self.assertIn("def get_cik_for_ticker(", SEC_SRC)

    def test_failures_never_block_analysis(self):
        """원문은 부가 근거다. 조회 실패가 분석 전체를 막으면 안 된다."""
        self.assertIn("except Exception as exc:", SEC_SRC)
        self.assertIn("result.error = ", SEC_SRC)
        # 라우트도 예외 대신 error 필드로 알린다
        self.assertNotIn("raise HTTPException", ROUTE_SRC)

    # ── 파싱 ────────────────────────────────────────────────────────────────
    def test_item_regex_matches_longer_numbers_first(self):
        """'1A|1B|1C|7A' 를 '1|7' 보다 먼저 시도해야 Item 1C 가 Item 1 로 잘리지 않는다."""
        match = re.search(r"_ITEM_RE = re\.compile\(r\"\(\?i\)\\bitem\\s\+\(([^)]+)\)", SEC_SRC)
        self.assertIsNotNone(match, "_ITEM_RE not found")
        alternatives = match.group(1).split("|")
        self.assertLess(alternatives.index("1A"), alternatives.index("1"))
        self.assertLess(alternatives.index("7A"), alternatives.index("7"))

    def test_cross_reference_filter_keeps_real_headings(self):
        """'Part II, Item 7' 같은 상호참조는 제외하되, 진짜 헤딩 앞의 'PART I'
        (쉼표 없음)까지 제외하면 Item 1 본문을 놓친다."""
        self.assertIn("_XREF_RE", SEC_SRC)
        self.assertIn(r"part\s+[ivx\d]+\s*,\s*", SEC_SRC)

    def test_body_chosen_over_table_of_contents(self):
        """같은 Item 이 목차와 본문에 모두 나온다. 다음 헤딩까지 간격이 가장 큰
        등장을 본문으로 골라야 목차 줄을 섹션으로 오인하지 않는다."""
        self.assertIn("if nxt - pos > best_len:", SEC_SRC)
        self.assertIn("if best_pos is None or best_len < 2000:", SEC_SRC)

    def test_sections_are_budgeted(self):
        """10-K 는 40만자를 넘는다. 전문을 프롬프트에 넣을 수 없다."""
        self.assertIn("budget_per_section", SEC_SRC)
        self.assertIn("truncated", SEC_SRC)

    # ── 프롬프트 주입 ────────────────────────────────────────────────────────
    def test_grounding_context_injected_into_llm_calls(self):
        self.assertIn("def attach_sec_grounding_context(", LLM_SRC)
        self.assertIn("prompt = attach_sec_grounding_context(prompt, state)", LLM_SRC)
        # 시스템 지침이 아니라 '자료'이므로 human 메시지에 붙인다
        self.assertIn("SEC FILING SOURCE TEXT", LLM_SRC)

    def test_injection_is_configurable_and_bounded(self):
        """토큰 비용이 크므로 끄거나 줄일 수 있어야 하고, 다종목에서 폭주하면 안 된다."""
        self.assertIn("SEC_GROUNDING_ENABLED", LLM_SRC)
        self.assertIn("SEC_GROUNDING_BUDGET", LLM_SRC)
        self.assertIn("SEC_GROUNDING_ITEMS", LLM_SRC)
        self.assertIn("for ticker in tickers[:2]:", LLM_SRC)

    def test_injection_is_idempotent(self):
        # 공시 원문과 경영진 발언 두 블록을 주입하므로 두 마커를 모두 검사해야
        # 중복 주입이 막힌다(발언 블록만 있는 경우도 포함).
        self.assertIn("any(marker in content for marker in SOURCE_TEXT_MARKERS)", LLM_SRC)
        self.assertIn("SOURCE_TEXT_MARKERS = (SEC_SOURCE_TEXT_MARKER, MANAGEMENT_SAID_MARKER)", LLM_SRC)

    def test_source_text_is_never_sanitized(self):
        """정규화기가 공시 원문의 'missing'/'not available' 등을 치환하면
        원문이 변조돼 그라운딩이 무의미해진다."""
        self.assertIn("SEC_SOURCE_TEXT_MARKER", LLM_SRC)
        self.assertIn("def sanitize_preserving_source_text(", LLM_SRC)
        self.assertIn(
            "_clone_message_with_content(message, sanitize_preserving_source_text(content))",
            LLM_SRC,
        )

    # ── 라우트 ──────────────────────────────────────────────────────────────
    def test_route_registered(self):
        self.assertIn('APIRouter(prefix="/sec-filings"', ROUTE_SRC)
        self.assertIn("from app.backend.routes.sec_filings import router as sec_filings_router", ROUTES_INIT)
        self.assertIn("api_router.include_router(sec_filings_router", ROUTES_INIT)


if __name__ == "__main__":
    unittest.main()
