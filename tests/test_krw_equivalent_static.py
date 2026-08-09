from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FX_ROUTE = ROOT / "app/backend/routes/fx_rates.py"
ROUTES_INIT = ROOT / "app/backend/routes/__init__.py"
FX_SERVICE = ROOT / "app/frontend/src/services/fx-rate-service.ts"
KRW_HOOK = ROOT / "app/frontend/src/hooks/use-krw-equivalent.ts"
SIDEBAR = ROOT / "app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx"


class KrwEquivalentStaticTests(unittest.TestCase):
    """달러/엔 금액 옆 원화 병기 — 한국 투자자 체감용.

    가이드의 '달러 금액 옆에 괄호로 원화 환산을 표시한다' 지침 반영.
    """

    def test_fx_endpoint_exists_and_registered(self):
        src = FX_ROUTE.read_text(encoding="utf-8")
        self.assertIn('APIRouter(prefix="/fx-rates"', src)
        self.assertIn('def get_fx_rate(', src)
        init = ROUTES_INIT.read_text(encoding="utf-8")
        self.assertIn("from app.backend.routes.fx_rates import router as fx_rates_router", init)
        self.assertIn("api_router.include_router(fx_rates_router", init)

    def test_fx_endpoint_degrades_gracefully(self):
        """환율은 부가 정보다. 조회 실패로 분석 화면 전체가 막히면 안 된다."""
        src = FX_ROUTE.read_text(encoding="utf-8")
        # 예외를 삼키고 rate=None 으로 응답
        self.assertIn("except Exception:", src)
        self.assertIn('"rate": None', src)
        # 캐시로 반복 조회를 막고, 실패 시 직전 성공값 재사용
        self.assertIn("_CACHE_TTL_SECONDS", src)
        self.assertIn("if rate is None and cached is not None", src)

    def test_krw_hook_skips_korean_tickers(self):
        """원화 종목에 원화 환산을 병기하면 중복이다. KRW 는 건너뛴다."""
        src = KRW_HOOK.read_text(encoding="utf-8")
        self.assertIn("normalized === 'KRW'", src)
        self.assertIn("export function useKrwRate(", src)
        self.assertIn("export function krwEquivalentText(", src)

    def test_krw_format_uses_korean_units(self):
        """긴 raw 숫자 대신 조/억/만 단위로 읽기 쉽게."""
        src = KRW_HOOK.read_text(encoding="utf-8")
        for unit in ("조", "억", "만"):
            self.assertIn(f"}}{unit}`", src)

    def test_sidebar_headline_tiles_show_krw(self):
        src = SIDEBAR.read_text(encoding="utf-8")
        self.assertIn("function KrwEquivalent(", src)
        self.assertIn("import { krwEquivalentText, useKrwRate } from '@/hooks/use-krw-equivalent';", src)
        # 목표가 · 선행 EPS · 목표가 검산 세 헤드라인에 병기
        self.assertEqual(src.count("<KrwEquivalent value="), 3)
        # 환율이 없으면 아무것도 렌더하지 않는다
        self.assertIn("if (!text) return null;", src)

    def test_fx_service_caches_and_fails_soft(self):
        src = FX_SERVICE.read_text(encoding="utf-8")
        self.assertIn("export async function fetchKrwRate(", src)
        self.assertIn("if (key === 'KRW') return 1;", src)
        self.assertIn("catch {", src)
        # 동시 호출 중복 요청 방지
        self.assertIn("inFlight", src)


if __name__ == "__main__":
    unittest.main()
