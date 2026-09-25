"""매수 후보 스캐너 — 판정 규칙, 스캔 흐름, 스트리밍 라우트."""

import importlib.util
import json
from pathlib import Path

import pytest

from src.screener import quality_buy
from src.screener.quality_buy import BUY_GAP, SCREENER_AGENT_PREFIX, WATCH_GAP, classify, scan_ticker
from src.screener.universe import LARGE_CAP_UNIVERSE, universe_for

ROOT = Path(__file__).resolve().parents[1]


def _fundamentals(profitability, growth, health):
    return {
        "signal": "neutral",
        "reasoning": {
            "profitability_signal": {"signal": profitability, "details": "ROE: 18.00%, Net Margin: N/A"},
            "growth_signal": {"signal": growth},
            "financial_health_signal": {"signal": health},
            "price_ratios_signal": {"signal": "bearish"},  # 가격 판단은 우량 여부에 쓰지 않는다
        },
    }


def _valuation(gap, per_share=115.0):
    # headline 은 DCF 기준이라 괴리율과 어긋날 수 있다 — 스크리너는 blended 를 써야 한다.
    return {"signal": "neutral", "reasoning": {
        "weighted_gap": gap, "blended_intrinsic_per_share": per_share, "headline_intrinsic_per_share": 999.0,
    }}


# ── 판정 규칙 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "gap, verdict",
    [(0.30, "buy"), (BUY_GAP + 0.001, "buy"), (BUY_GAP, "watch"), (0.0, "watch"),
     (WATCH_GAP, "watch"), (WATCH_GAP - 0.001, "quality_expensive"), (-0.40, "quality_expensive"),
     (None, "quality_no_value")],
)
def test_quality_stock_is_split_by_fair_value_gap(gap, verdict):
    result = classify(_fundamentals("bullish", "bullish", "neutral"), _valuation(gap))
    assert result["verdict"] == verdict
    assert result["quality"]["passed"] is True


def test_price_ratios_do_not_decide_quality():
    # 가격 배수가 약세여도 사업이 우량하면 우량으로 본다 — 싼지는 가치평가가 따로 판정한다.
    result = classify(_fundamentals("bullish", "bullish", "bullish"), _valuation(0.2))
    assert result["verdict"] == "buy"
    assert result["quality"]["bullish"] == 3


@pytest.mark.parametrize(
    "axes",
    [("bullish", "neutral", "neutral"), ("bullish", "bullish", "bearish"), (None, None, "bullish")],
)
def test_quality_needs_two_strong_and_no_weak_axis(axes):
    result = classify(_fundamentals(*axes), _valuation(0.5))
    assert result["verdict"] == "not_quality"
    assert result["quality"]["passed"] is False


def test_missing_fundamentals_is_insufficient():
    assert classify(None, None)["verdict"] == "insufficient"
    assert classify({}, None)["quality"] is None


def test_value_block_uses_per_share_value_on_the_same_basis_as_gap():
    # 적정가 115, 괴리율 +15% → 시가 100, 매수 기준가 100 → 이미 매수 구간 경계.
    value = classify(_fundamentals("bullish", "bullish", "bullish"), _valuation(0.15, 115.0))["value"]
    assert value["intrinsic_per_share"] == 115.0
    assert value["price_per_share"] == pytest.approx(100.0)
    assert value["buy_price_per_share"] == pytest.approx(100.0)
    assert value["drop_to_buy"] == pytest.approx(0.0)


def test_drop_to_buy_is_the_decline_needed_to_clear_the_buy_bar():
    # 괴리율 −8%: 적정가 92, 시가 100 → 매수 기준가 92/1.15 = 80 → 20% 하락 필요.
    value = classify(_fundamentals("bullish", "bullish", "bullish"), _valuation(-0.08, 92.0))["value"]
    assert value["buy_price_per_share"] == pytest.approx(80.0)
    assert value["drop_to_buy"] == pytest.approx(0.20)
    # 이미 매수 구간이면 0 으로 자른다.
    assert classify(_fundamentals("bullish", "bullish", "bullish"), _valuation(0.5))["value"]["drop_to_buy"] == 0.0


def test_missing_per_share_value_leaves_prices_empty_but_keeps_drop():
    value = classify(_fundamentals("bullish", "bullish", "bullish"), _valuation(-0.08, None))["value"]
    assert value["intrinsic_per_share"] is None and value["buy_price_per_share"] is None
    assert value["drop_to_buy"] == pytest.approx(0.20)


def test_quality_block_carries_axis_details():
    quality = classify(_fundamentals("bullish", "bullish", "bullish"), None)["quality"]
    assert quality["details"]["profitability"] == "ROE: 18.00%, Net Margin: N/A"
    assert quality["details"]["growth"] is None


# ── 대상 목록 ────────────────────────────────────────────────────────────────


def test_universe_is_fixed_large_caps_without_duplicates():
    tickers = [e["ticker"] for e in LARGE_CAP_UNIVERSE]
    assert len(tickers) == len(set(tickers)) == 50
    assert len(universe_for("KR")) == 25 and all(e["ticker"].endswith(".KS") for e in universe_for("kr"))
    assert len(universe_for("US")) == 25 and not any("." in e["ticker"] for e in universe_for("US"))
    assert universe_for(None) == universe_for("ALL") == LARGE_CAP_UNIVERSE


# ── 스캔 흐름 ────────────────────────────────────────────────────────────────


def _fake_agent(output, calls, *, raises=None):
    def agent(state, agent_id):
        calls.append(agent_id)
        assert state["metadata"]["request"].api_keys == {"FINANCIAL_DATASETS_API_KEY": "k"}
        if raises:
            raise raises
        ticker = state["data"]["tickers"][0]
        state["data"]["analyst_signals"][agent_id] = {ticker: output}
    return agent


ENTRY = {"ticker": "AAPL", "name": "애플", "market": "US"}
KEYS = {"FINANCIAL_DATASETS_API_KEY": "k"}


def test_scan_runs_valuation_only_for_quality_stocks():
    calls = []
    result = scan_ticker(
        ENTRY, "2026-09-25", KEYS,
        fundamentals_agent=_fake_agent(_fundamentals("bullish", "bullish", "neutral"), calls),
        valuation_agent=_fake_agent(_valuation(0.3), calls),
    )
    assert result["verdict"] == "buy" and result["ticker"] == "AAPL" and result["error"] is None
    # 스캐너의 에이전트 이름은 종목분석 진행 스트림이 걸러 낼 수 있게 접두어를 단다.
    assert calls == [f"{SCREENER_AGENT_PREFIX}fundamentals", f"{SCREENER_AGENT_PREFIX}valuation"]

    calls.clear()
    result = scan_ticker(
        ENTRY, "2026-09-25", KEYS,
        fundamentals_agent=_fake_agent(_fundamentals("bearish", "bullish", "bullish"), calls),
        valuation_agent=_fake_agent(_valuation(0.3), calls),
    )
    assert result["verdict"] == "not_quality"
    assert calls == [f"{SCREENER_AGENT_PREFIX}fundamentals"]


def test_scan_reports_agent_failure_instead_of_raising():
    calls = []
    result = scan_ticker(
        ENTRY, "2026-09-25", KEYS,
        fundamentals_agent=_fake_agent(None, calls, raises=RuntimeError("rate limited")),
        valuation_agent=_fake_agent(_valuation(0.3), calls),
    )
    assert result["verdict"] == "insufficient"
    assert "rate limited" in result["error"]

    result = scan_ticker(
        ENTRY, "2026-09-25", KEYS,
        fundamentals_agent=_fake_agent(_fundamentals("bullish", "bullish", "bullish"), calls),
        valuation_agent=_fake_agent(None, calls, raises=ValueError("no market cap")),
    )
    assert result["verdict"] == "quality_no_value"
    assert "no market cap" in result["error"]


# ── 스트리밍 라우트 ──────────────────────────────────────────────────────────


@pytest.fixture
def screener_client(monkeypatch):
    """라우트 모듈만 불러 온다 — routes 패키지는 그래프 전체를 불러와 무겁다."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    spec = importlib.util.spec_from_file_location(
        "screener_route_under_test", ROOT / "app" / "backend" / "routes" / "screener.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    calls = []

    def fake_scan(entry, end_date, api_keys):
        calls.append(entry["ticker"])
        if entry["ticker"] == "AAPL":
            raise RuntimeError("boom")
        verdict = "buy" if entry["ticker"] in ("MSFT", "005930.KS") else "not_quality"
        return {**entry, "verdict": verdict, "quality": None,
                "value": {"gap": None, "signal": None, "intrinsic_per_share": None}, "error": None}

    class FakeKeys:
        def __init__(self, db):
            pass

        def get_api_keys_dict(self):
            return {}

    monkeypatch.setattr(module, "scan_ticker", fake_scan)
    monkeypatch.setattr(module, "ApiKeyService", FakeKeys)
    app = FastAPI()
    app.include_router(module.router)
    app.dependency_overrides[module.get_db] = lambda: None
    return TestClient(app), calls


def _events(text):
    events = []
    for block in text.split("\n\n"):
        name = data = None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        if name:
            events.append((name, data))
    return events


def test_scan_streams_every_ticker_then_completes(screener_client):
    client, calls = screener_client
    assert len(client.get("/screener/universe?market=KR").json()["universe"]) == 25

    events = _events(client.post("/screener/scan", json={"market": "ALL", "end_date": "2026-09-25"}).text)
    assert events[0] == ("start", {"total": 50, "end_date": "2026-09-25", "buy_gap": BUY_GAP, "watch_gap": WATCH_GAP})
    results = [data for name, data in events if name == "result"]
    assert sorted(r["ticker"] for r in results) == sorted(e["ticker"] for e in LARGE_CAP_UNIVERSE)
    # 한 종목의 예외가 스트림을 끊지 않는다.
    failed = next(r for r in results if r["ticker"] == "AAPL")
    assert failed["verdict"] == "insufficient" and failed["error"] == "boom"
    assert failed["value"]["drop_to_buy"] is None
    assert events[-1] == ("complete", {"total": 50, "counts": {"buy": 2, "not_quality": 47, "insufficient": 1}})


def test_same_day_rescan_uses_cache_except_failures(screener_client):
    client, calls = screener_client
    client.post("/screener/scan", json={"market": "US", "end_date": "2026-09-24"})
    calls.clear()

    events = _events(client.post("/screener/scan", json={"market": "US", "end_date": "2026-09-24"}).text)
    assert calls == ["AAPL"]  # 실패한 종목만 다시 조회한다
    assert sum(1 for name, data in events if name == "result" and data.get("cached")) == 24

    calls.clear()
    client.post("/screener/scan", json={"market": "US", "end_date": "2026-09-24", "refresh": True})
    assert len(calls) == 25


# ── 연결부 ───────────────────────────────────────────────────────────────────


def test_valuation_reasoning_exposes_weighted_gap():
    source = (ROOT / "src" / "agents" / "valuation.py").read_text(encoding="utf-8")
    assert '"weighted_gap": weighted_gap,' in source
    assert '"blended_intrinsic_per_share": blended_intrinsic_per_share,' in source


def test_hedge_fund_streams_ignore_screener_progress():
    source = (ROOT / "app" / "backend" / "routes" / "hedge_fund.py").read_text(encoding="utf-8")
    assert source.count("agent_name.startswith(SCREENER_AGENT_PREFIX)") == 2


def test_screener_route_is_registered():
    source = (ROOT / "app" / "backend" / "routes" / "__init__.py").read_text(encoding="utf-8")
    assert "include_router(screener_router" in source


def test_screener_agents_have_no_llm_dependency():
    source = Path(quality_buy.__file__).read_text(encoding="utf-8")
    assert "call_llm" not in source
