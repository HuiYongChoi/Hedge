from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
API_KEYS_ROUTE = (ROOT / "app/backend/routes/api_keys.py").read_text(encoding="utf-8")
SCHEMAS = (ROOT / "app/backend/models/schemas.py").read_text(encoding="utf-8")
API_TOOLS = (ROOT / "src/tools/api.py").read_text(encoding="utf-8")
TICKER_SEARCH = (ROOT / "app/backend/routes/ticker_search.py").read_text(encoding="utf-8")
SETTINGS_UI = (ROOT / "app/frontend/src/components/settings/api-keys.tsx").read_text(encoding="utf-8")
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")


class SecurityHardeningStaticTests(unittest.TestCase):
    """보안 회귀 방지."""

    def test_api_key_values_are_never_returned_raw(self):
        """/api-keys 라우터에는 인증이 없다. 원문을 반환하면 엔드포인트에 도달하는
        누구나 사용자의 LLM API 키를 그대로 가져갈 수 있다."""
        self.assertIn("def _masked(api_key):", API_KEYS_ROUTE)
        self.assertIn("MASKED_KEY_PREFIX", API_KEYS_ROUTE)
        # 원문을 그대로 직렬화해 돌려주는 경로가 남아 있으면 안 된다
        self.assertNotIn("return ApiKeyResponse.from_orm(api_key)", API_KEYS_ROUTE)
        self.assertNotIn("return [ApiKeyResponse.from_orm(key) for key in api_keys]", API_KEYS_ROUTE)
        # 마스킹은 뒤 4자리만 남긴다
        self.assertIn("raw[-4:]", API_KEYS_ROUTE)

    def test_masked_response_documented_in_schema(self):
        self.assertIn("masked", SCHEMAS)

    def test_frontend_never_resaves_masked_key(self):
        """마스킹 값을 그대로 저장하면 진짜 키가 '••••abcd' 로 덮인다."""
        self.assertIn("export function isMaskedKey(", SETTINGS_UI)
        self.assertIn("if (isMaskedKey(value)) return;", SETTINGS_UI)

    def test_no_hardcoded_third_party_keys(self):
        """FMP/AlphaVantage 키가 소스에 박혀 있으면 저장소를 통해 유출된다."""
        for name, src in (("api.py", API_TOOLS), ("ticker_search.py", TICKER_SEARCH)):
            self.assertIsNone(
                re.search(r"(FMP_API_KEY|AV_API_KEY)\s*=\s*[\"'][A-Za-z0-9]{16,}[\"']", src),
                f"{name} must not hardcode API keys",
            )
            self.assertIn('os.environ.get("FMP_API_KEY"', src)
            self.assertIn('os.environ.get("AV_API_KEY"', src)

    def test_missing_key_skips_provider_instead_of_calling(self):
        """키가 없으면 무의미한 외부 호출 대신 그 소스만 건너뛴다."""
        self.assertIn("if not FMP_API_KEY:", API_TOOLS)
        self.assertIn("if not FMP_API_KEY:\n        return []", TICKER_SEARCH)
        self.assertIn("if not AV_API_KEY:\n        return []", TICKER_SEARCH)

    def test_env_example_lists_key_names_without_values(self):
        self.assertIn("FMP_API_KEY=", ENV_EXAMPLE)
        self.assertIn("AV_API_KEY=", ENV_EXAMPLE)
        self.assertIn("EDINET_API_KEY=", ENV_EXAMPLE)
        # 예시 파일에 실제 값이 들어가면 안 된다
        self.assertIsNone(
            re.search(r"=\s*[A-Za-z0-9]{20,}", ENV_EXAMPLE),
            ".env.example must not contain real key values",
        )


if __name__ == "__main__":
    unittest.main()
