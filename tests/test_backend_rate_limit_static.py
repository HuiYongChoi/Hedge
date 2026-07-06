from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "app/backend/main.py"


def test_rate_limit_middleware_guards_expensive_endpoints():
    # 무인증 공개 프록시(/hedge-api/) 뒤 고비용 엔드포인트의 비용 폭주 방어.
    src = MAIN.read_text(encoding="utf-8")

    assert '"/hedge-fund/run"' in src
    assert '"/hedge-fund/backtest"' in src
    assert '"/hedge-fund/fetch-metrics"' in src
    assert "status_code=429" in src
    assert "Retry-After" in src
    assert "@app.middleware" in src


def test_rate_limit_trusts_last_forwarded_for_value():
    # 클라이언트가 X-Forwarded-For를 위조해도 Apache가 append한
    # 마지막 값(실제 IP)을 쓰므로 우회할 수 없다.
    src = MAIN.read_text(encoding="utf-8")
    assert 'forwarded.split(",")[-1].strip()' in src
