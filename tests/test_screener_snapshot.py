"""재무 스냅샷 — 재무는 기억하고 주가만으로 판정을 다시 낸다(src/screener/snapshot_store.py)."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from src.screener import snapshot_store
from src.screener.quality_buy import blend, classify

STRONG = {"signal": "bullish", "details": "ROE: 20.00%"}
FUNDAMENTALS = {
    "reasoning": {
        "profitability_signal": STRONG,
        "growth_signal": STRONG,
        "financial_health_signal": {"signal": "neutral", "details": "D/E: 0.50"},
    }
}
ENTRY = {"ticker": "AAA", "name": "에이", "market": "US"}


def _valuation(models: dict, market_cap: float, shares: float) -> dict:
    """가치평가 에이전트가 남기는 합산 입력(blend_inputs) 모양 그대로."""
    return {
        "signal": "bullish",
        "reasoning": {
            # 설명용 블록은 읽지 않아야 한다 — 모델이 아닌 rim_analysis 가 섞여 있다.
            "rim_analysis": {"intrinsic_total": 99_999.0, "weight_used": 0.5, "gap_to_market": 5.0},
            "blend_inputs": {
                "market_cap": market_cap,
                "shares": shares,
                "models": {name: {"value": value, "weight": weight} for name, (value, weight) in models.items()},
            },
        },
    }


def _price(day: str, close: float):
    return SimpleNamespace(time=day, close=close)


def _full_result(valuation, end_date="2026-09-01"):
    blended = blend(
        snapshot_store._models_from_valuation(valuation)["models"], 1_000.0, 10.0,
    )
    return {**ENTRY, **classify(FUNDAMENTALS, blended), "error": None}


@pytest.fixture
def saved(tmp_path):
    # 시가총액 1,000, 주식 10주(주가 100). 모델 적정가 1,300·1,200 → 괴리 +25% → 매수 후보.
    valuation = _valuation({"dcf": (1300.0, 0.5), "owner_earnings": (1200.0, 0.5)}, 1_000.0, 10.0)
    result = _full_result(valuation)
    assert result["verdict"] == "buy"
    snap = snapshot_store.build_snapshot(ENTRY, "2026-09-01", result, FUNDAMENTALS, valuation, False)
    snapshot_store.save_with_base_close(snap, price_fn=lambda *a: [_price("2026-09-01", 100.0)], snapshot_dir=tmp_path)
    return tmp_path, result


def test_same_price_reproduces_the_full_calculation(saved):
    tmp_path, full = saved
    again = snapshot_store.reprice(ENTRY, "2026-09-01", price_fn=lambda *a: [], snapshot_dir=tmp_path)
    assert again["verdict"] == full["verdict"] == "buy"
    assert again["value"]["gap"] == pytest.approx(full["value"]["gap"]) == pytest.approx(0.25)
    assert again["value"]["intrinsic_per_share"] == pytest.approx(125.0)
    assert again["fundamentals_as_of"] == "2026-09-01"


def test_price_rise_moves_the_gap_without_refetching_financials(saved):
    tmp_path, _ = saved
    calls = []

    def prices(ticker, start, end):
        calls.append((ticker, end))
        return [_price("2026-09-10", 110.0), _price("2026-09-11", 120.0)]

    later = snapshot_store.reprice(ENTRY, "2026-09-11", price_fn=prices, snapshot_dir=tmp_path)
    # 주가 +20% → 시가총액 1,200 → 괴리 1,250/1,200 − 1 ≈ +4.2% → 관심 후보
    assert calls == [("AAA", "2026-09-11")]
    assert later["value"]["gap"] == pytest.approx(1250 / 1200 - 1)
    assert later["verdict"] == "watch"
    assert later["value"]["intrinsic_per_share"] == pytest.approx(125.0)  # 적정가는 그대로


def test_old_or_future_snapshots_are_not_used(saved):
    tmp_path, _ = saved
    too_old = (date(2026, 9, 1) + timedelta(days=snapshot_store.max_age_days("AAA") + 1)).isoformat()
    price = lambda *a: [_price("2026-09-01", 100.0)]
    assert snapshot_store.reprice(ENTRY, too_old, price_fn=price, snapshot_dir=tmp_path) is None
    assert snapshot_store.reprice(ENTRY, "2026-08-31", price_fn=price, snapshot_dir=tmp_path) is None


def test_missing_price_falls_back_to_full_scan(saved):
    tmp_path, _ = saved
    assert snapshot_store.reprice(ENTRY, "2026-09-05", price_fn=lambda *a: [], snapshot_dir=tmp_path) is None


def test_expiry_is_spread_between_14_and_28_days():
    ages = {snapshot_store.max_age_days(f"T{i}") for i in range(200)}
    assert min(ages) >= 14 and max(ages) <= 28 and len(ages) > 5


def test_quality_stock_with_failed_valuation_is_not_remembered():
    result = {**ENTRY, **classify(FUNDAMENTALS, None), "error": None}
    assert snapshot_store.build_snapshot(ENTRY, "2026-09-01", result, FUNDAMENTALS, None, False) is None


def test_below_quality_bar_is_remembered_without_prices(tmp_path):
    weak = {"reasoning": {k: {"signal": "bearish", "details": "ROE: 1.00%"} for k in FUNDAMENTALS["reasoning"]}}
    result = {**ENTRY, **classify(weak, None), "error": None}
    snap = snapshot_store.build_snapshot(ENTRY, "2026-09-01", result, weak, None, False)
    snapshot_store.save_with_base_close(snap, price_fn=lambda *a: pytest.fail("no price needed"), snapshot_dir=tmp_path)
    again = snapshot_store.reprice(ENTRY, "2026-09-20", price_fn=lambda *a: pytest.fail("no price needed"),
                                   snapshot_dir=tmp_path)
    assert again["verdict"] == "not_quality"


def test_blend_matches_valuation_agent_outlier_rule():
    # 모델 4개 이상이면 또래 중앙값의 3배를 넘는 모델은 빠진다(가치평가 에이전트와 같음).
    models = {"a": {"value": 1000.0, "weight": 0.25}, "b": {"value": 1100.0, "weight": 0.25},
              "c": {"value": 1050.0, "weight": 0.25}, "d": {"value": 9000.0, "weight": 0.25}}
    out = blend(models, 1000.0, 10.0)
    assert out["reasoning"]["weighted_gap"] == pytest.approx((0 + 0.1 + 0.05) / 3)


# ── 라우트 ───────────────────────────────────────────────────────────────────


def test_scan_route_uses_snapshot_before_full_scan(monkeypatch):
    import importlib.util
    from pathlib import Path

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("screener_route_snapshot", root / "app/backend/routes/screener.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    full, saved = [], []

    def fake_scan(entry, end_date, api_keys):
        full.append(entry["ticker"])
        return {**entry, "verdict": "not_quality", "quality": None, "value": {"gap": None}, "error": None,
                "_snapshot": {"ticker": entry["ticker"]}}

    def fake_reprice(entry, end_date):
        if entry["ticker"] == "MSFT":
            return {**entry, "verdict": "watch", "quality": None, "value": {"gap": 0.05}, "error": None}
        return None

    class FakeKeys:
        def __init__(self, db):
            pass

        def get_api_keys_dict(self):
            return {}

    monkeypatch.setattr(module, "scan_ticker", fake_scan)
    monkeypatch.setattr(module, "ApiKeyService", FakeKeys)
    monkeypatch.setattr(module, "_archive_scan", lambda *a, **k: None)
    monkeypatch.setattr(module.track_record, "record_scan", lambda *a, **k: None)
    monkeypatch.setattr(module, "_reprice", fake_reprice)
    monkeypatch.setattr(module, "_save_snapshot", lambda snap: saved.append(snap["ticker"]))
    module._day_cache.clear()
    app = FastAPI()
    app.include_router(module.router)
    app.dependency_overrides[module.get_db] = lambda: None
    body = TestClient(app).post("/screener/scan", json={"market": "US", "end_date": "2026-09-26"}).text

    assert "MSFT" not in full and len(full) == 24
    assert sorted(saved) == sorted(full)
    assert '"repriced": true' in body
    assert '"_snapshot"' not in body  # 스냅샷은 화면으로 보내지 않는다


def test_result_explains_each_model(saved):
    """판정 근거 — 모델별 주당 적정가, 반영 비중, 제외 여부."""
    tmp_path, full = saved
    models = {m["key"]: m for m in full["value"]["models"]}
    assert models["dcf"]["per_share"] == pytest.approx(130.0)
    assert models["dcf"]["share"] == pytest.approx(0.5)
    again = snapshot_store.reprice(ENTRY, "2026-09-01", price_fn=lambda *a: [], snapshot_dir=tmp_path)
    assert {m["key"] for m in again["value"]["models"]} == {"dcf", "owner_earnings"}


def test_outlier_model_is_marked_excluded():
    models = {"a": {"value": 1000.0, "weight": 0.25}, "b": {"value": 1100.0, "weight": 0.25},
              "c": {"value": 1050.0, "weight": 0.25}, "d": {"value": 9000.0, "weight": 0.25}}
    breakdown = {m["key"]: m for m in blend(models, 1000.0, 10.0)["reasoning"]["model_breakdown"]}
    assert breakdown["d"]["excluded"] and breakdown["d"]["share"] == 0.0
    assert breakdown["a"]["share"] == pytest.approx(1 / 3)


def test_tech_sector_gets_valuation_reliability_warning():
    valuation = _valuation({"dcf": (500.0, 1.0)}, 1_000.0, 10.0)
    blended = blend({"dcf": {"value": 500.0, "weight": 1.0}}, 1_000.0, 10.0)
    tech = classify(FUNDAMENTALS, blended, sector="Information Technology")
    other = classify(FUNDAMENTALS, blended, sector="Industrials")
    assert "tech_valuation" in tech["warnings"] and "tech_valuation" not in other["warnings"]
    assert tech["verdict"] == other["verdict"] == "quality_expensive"  # 판정 자체는 바꾸지 않는다
    assert valuation  # 모양 확인용
