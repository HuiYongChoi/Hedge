"""매수 후보 — 전진 검증 기록·채점, 종목별 과거 시점 검증."""

import importlib.util
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.screener import point_in_time, track_record
from src.screener.point_in_time import (
    annual_flow_values,
    check_dates,
    check_history,
    instant_value,
    quality_from_financials,
    sec_financials_as_of,
    verdict_for,
)
from src.screener.track_record import evaluate, forward_return, load_snapshots, record_scan

ROOT = Path(__file__).resolve().parents[1]


def _price(day, close):
    return SimpleNamespace(time=f"{day}T00:00:00", close=close)


def _result(ticker, verdict, market="US", **extra):
    return {"ticker": ticker, "name": ticker, "market": market, "verdict": verdict,
            "value": {"gap": 0.2, "price_per_share": 10.0}, "sector": "Technology", "warnings": [],
            "error": None, **extra}


# ── 기록 ─────────────────────────────────────────────────────────────────────


def test_record_scan_merges_same_day_and_skips_unjudged(tmp_path):
    assert record_scan("2026-09-26", [_result("A", "buy"), _result("B", "insufficient"),
                                      _result("C", "watch", error="boom")], track_dir=tmp_path) == 1
    record_scan("2026-09-26", [_result("A", "watch"), _result("D", "buy", market="KR")], track_dir=tmp_path)
    saved = json.loads((tmp_path / "2026-09-26.json").read_text(encoding="utf-8"))
    assert saved["end_date"] == "2026-09-26"
    assert set(saved["results"]) == {"A", "D"}
    assert saved["results"]["A"]["verdict"] == "watch"  # 같은 날은 마지막 판정으로 합친다
    assert [s["end_date"] for s in load_snapshots(tmp_path)] == ["2026-09-26"]


def test_load_snapshots_skips_broken_files(tmp_path):
    (tmp_path / "2026-01-01.json").write_text("{not json", encoding="utf-8")
    record_scan("2026-01-02", [_result("A", "buy")], track_dir=tmp_path)
    assert [s["end_date"] for s in load_snapshots(tmp_path)] == ["2026-01-02"]
    assert load_snapshots(tmp_path / "missing") == []


# ── 채점 ─────────────────────────────────────────────────────────────────────


def test_forward_return_uses_last_close_before_and_first_close_after():
    prices = [_price("2026-01-02", 100), _price("2026-01-05", 110), _price("2026-02-02", 120), _price("2026-02-05", 999)]
    # 1월 3일(휴일) 시작 → 1월 2일 종가, 30일 뒤(2월 2일) 이후 첫 종가 120
    assert forward_return(prices, date(2026, 1, 3), 30) == pytest.approx(0.2)
    assert forward_return(prices, date(2026, 1, 3), 400) is None  # 아직 오지 않은 날
    assert forward_return([], date(2026, 1, 3), 30) is None


def test_evaluate_scores_only_matured_horizons_against_the_index():
    snapshots = [
        {"end_date": "2026-01-02", "results": {
            "A": {"ticker": "A", "market": "US", "verdict": "buy"},
            "B": {"ticker": "B", "market": "US", "verdict": "buy"},
            "C": {"ticker": "C", "market": "US", "verdict": "not_quality"},  # 채점하지 않는 판정
        }},
        {"end_date": "2026-09-20", "results": {"A": {"ticker": "A", "market": "US", "verdict": "watch"}}},
    ]
    series = {
        "A": [_price("2026-01-02", 100), _price("2026-02-02", 120), _price("2026-04-03", 130)],
        "B": [_price("2026-01-02", 100), _price("2026-02-02", 95), _price("2026-04-03", 90)],
        "SPY": [_price("2026-01-02", 100), _price("2026-02-02", 105), _price("2026-04-03", 110)],
    }
    requested = []

    def price_fn(ticker, start, end):
        requested.append(ticker)
        return series.get(ticker, [])

    report = evaluate(snapshots, date(2026, 9, 26), price_fn=price_fn)
    buy_1m = report["summary"]["buy"]["1m"]
    assert buy_1m["n"] == 2
    assert buy_1m["avg_return"] == pytest.approx((0.20 - 0.05) / 2)
    assert buy_1m["avg_excess"] == pytest.approx(((0.20 - 0.05) + (-0.05 - 0.05)) / 2)
    assert buy_1m["beat_rate"] == pytest.approx(0.5)
    assert report["summary"]["buy"]["12m"]["n"] == 0  # 12개월은 아직
    assert report["summary"]["watch"]["1m"]["n"] == 0  # 9월 20일 기록은 1개월이 안 지남
    assert report["next_maturity"] == "2026-10-20"
    assert report["first_snapshot"] == "2026-01-02" and report["snapshots"] == 2
    assert "C" not in requested
    assert requested.count("SPY") == 1  # 같은 종목 주가는 한 번만 받는다


def test_evaluate_with_no_snapshots():
    report = evaluate([], date(2026, 9, 26), price_fn=lambda *a: [])
    assert report["snapshots"] == 0 and report["first_snapshot"] is None and report["next_maturity"] is None


# ── 과거 시점 검증 ───────────────────────────────────────────────────────────


def test_check_dates_are_april_15ths_with_room_for_a_return():
    assert check_dates(date(2026, 9, 26)) == [date(y, 4, 15) for y in range(2022, 2027)]
    # 7월 1일에는 올해 4월 15일이 3개월이 안 지나 빠진다
    assert check_dates(date(2026, 7, 1)) == [date(y, 4, 15) for y in range(2021, 2026)]


def _fin(**overrides):
    base = {
        "revenue": 1000.0, "revenue_prev": 850.0, "net_income": 250.0, "net_income_prev": 200.0,
        "operating_income": 300.0, "shareholders_equity": 1000.0, "shareholders_equity_prev": 880.0,
        "current_assets": 800.0, "current_liabilities": 400.0, "total_debt": 200.0,
        "free_cash_flow": 260.0, "outstanding_shares": 100.0, "earnings_per_share": 2.5,
        "capital_expenditure": 40.0, "depreciation_and_amortization": 30.0,
    }
    return {**base, **overrides}


def test_quality_uses_the_fundamentals_agent_thresholds():
    q = quality_from_financials(_fin())
    # ROE 25%·순이익률 25%·영업이익률 30% / 성장 17.6%·25%·13.6% / 유동 2.0·부채 0.2·FCF 2.6 > 2.0
    assert (q["profitability"], q["growth"], q["financial_health"]) == ("bullish", "bullish", "bullish")
    assert q["passed"] is True
    assert q["metrics"]["roe"] == pytest.approx(0.25)

    weak = quality_from_financials(_fin(net_income=10.0, operating_income=20.0, revenue_prev=990.0,
                                        shareholders_equity_prev=995.0, current_assets=300.0,
                                        total_debt=900.0, free_cash_flow=-5.0))
    assert weak["profitability"] == "bearish" and weak["financial_health"] == "bearish"
    assert weak["passed"] is False


def test_missing_values_do_not_count_as_passing():
    q = quality_from_financials({"revenue": 100.0})
    assert q["passed"] is False and q["bullish"] == 0


def test_verdict_uses_scanner_thresholds():
    ok = {"passed": True}
    assert verdict_for(ok, 0.2, False) == "buy"
    assert verdict_for(ok, 0.0, False) == "watch"
    assert verdict_for(ok, -0.2, False) == "quality_expensive"
    assert verdict_for(ok, None, False) == "quality_no_value"
    assert verdict_for({"passed": False}, 0.5, False) == "not_quality"
    assert verdict_for(ok, 0.5, True) == "financial"


def test_simple_value_blends_dcf_and_owner_earnings():
    from src.agents.valuation import calculate_intrinsic_value, calculate_owner_earnings_value

    fin = _fin()
    growth = 0.15  # 매출 성장 17.6% 는 15% 로 묶는다
    dcf = calculate_intrinsic_value(260.0, growth_rate=growth)
    owner = calculate_owner_earnings_value(250.0, 30.0, 40.0, 0, growth_rate=growth)
    expected = (dcf * 0.23 + owner * 0.22) / 0.45
    assert point_in_time.simple_intrinsic_value(fin) == pytest.approx(expected)
    # 현금흐름·이익이 모두 음수면 계산하지 않는다.
    assert point_in_time.simple_intrinsic_value(_fin(free_cash_flow=-1.0, net_income=-5.0)) is None


def _fact(val, end, filed, start=None, form="10-K"):
    fact = {"val": val, "end": end, "filed": filed, "form": form}
    if start:
        fact["start"] = start
    return fact


def test_annual_values_only_use_filings_made_before_the_check_date():
    facts = [
        _fact(100, "2022-12-31", "2023-02-10", start="2022-01-01"),
        _fact(105, "2022-12-31", "2024-02-10", start="2022-01-01"),  # 나중에 고친 값 — 2023년엔 몰랐다
        _fact(120, "2023-12-31", "2024-02-10", start="2023-01-01"),
        _fact(30, "2023-03-31", "2023-05-01", start="2023-01-01", form="10-Q"),  # 분기는 빼고
        _fact(90, "2022-06-30", "2023-02-10", start="2022-01-01"),  # 반년 구간도 뺀다
    ]
    assert annual_flow_values(facts, "2023-04-15") == {"2022-12-31": 100}
    assert annual_flow_values(facts, "2024-04-15") == {"2022-12-31": 105, "2023-12-31": 120}

    balance = [_fact(500, "2022-12-31", "2023-02-10"), _fact(510, "2022-12-31", "2024-02-10")]
    assert instant_value(balance, "2022-12-31", "2023-04-15") == 500
    assert instant_value(balance, "2022-12-31", "2024-04-15") == 510
    assert instant_value(balance, "2021-12-31", "2024-04-15") is None


def test_sec_financials_pick_latest_annual_report_and_prior_year():
    facts = {
        "revenue": [_fact(1000, "2023-12-31", "2024-02-10", "2023-01-01"),
                    _fact(850, "2022-12-31", "2023-02-10", "2022-01-01")],
        "net_income": [_fact(250, "2023-12-31", "2024-02-10", "2023-01-01"),
                       _fact(200, "2022-12-31", "2023-02-10", "2022-01-01")],
        "operating_cash_flow": [_fact(300, "2023-12-31", "2024-02-10", "2023-01-01")],
        "capital_expenditure": [_fact(40, "2023-12-31", "2024-02-10", "2023-01-01")],
        "outstanding_shares": [_fact(100, "2023-12-31", "2024-02-10", "2023-01-01")],
        "shareholders_equity": [_fact(1000, "2023-12-31", "2024-02-10"), _fact(880, "2022-12-31", "2023-02-10")],
        "long_term_debt": [_fact(200, "2023-12-31", "2024-02-10")],
    }
    fin = sec_financials_as_of({}, date(2024, 4, 15), lambda cf, field: facts.get(field, []))
    assert fin["report_period"] == "2023-12-31"
    assert fin["revenue"] == 1000 and fin["revenue_prev"] == 850
    assert fin["shareholders_equity_prev"] == 880
    assert fin["free_cash_flow"] == 260 and fin["total_debt"] == 200

    # 2023년 4월에는 2022년 보고서가 최신이다.
    fin = sec_financials_as_of({}, date(2023, 4, 15), lambda cf, field: facts.get(field, []))
    assert fin["report_period"] == "2022-12-31" and fin["revenue_prev"] is None
    assert sec_financials_as_of({}, date(2023, 1, 1), lambda cf, field: facts.get(field, [])) is None


def test_check_history_scores_each_date_against_the_index(monkeypatch):
    monkeypatch.setattr(point_in_time, "simple_intrinsic_value", lambda fin: 1300.0)  # 시총 1000 → 괴리 +30%
    stock = [_price("2025-04-14", 10.0), _price("2025-07-15", 11.0), _price("2025-10-14", 12.0), _price("2026-04-15", 15.0)]
    index = [_price("2025-04-14", 100.0), _price("2025-07-15", 102.0), _price("2025-10-14", 104.0), _price("2026-04-15", 110.0)]

    def financials_fn(ticker, market, as_of):
        return _fin() if as_of.year == 2025 else None

    report = check_history("AAPL", "US", date(2026, 9, 26), financials_fn=financials_fn,
                           price_fn=lambda t, s, e: index if t == "SPY" else stock)
    by_date = {c["as_of"]: c for c in report["checkpoints"]}
    assert by_date["2024-04-15"]["verdict"] is None and by_date["2024-04-15"]["note"]
    row = by_date["2025-04-15"]
    assert row["price"] == 10.0 and row["gap"] == pytest.approx(0.3) and row["verdict"] == "buy"
    assert row["returns"]["12m"]["return"] == pytest.approx(0.5)
    assert row["returns"]["12m"]["excess"] == pytest.approx(0.5 - 0.1)
    assert report["buy_summary"] == {"n": 1, "avg_excess_12m": pytest.approx(0.4), "beat_rate_12m": 1.0}
    assert report["benchmark"] == "SPY"


def test_check_history_marks_financials(monkeypatch):
    monkeypatch.setattr(point_in_time, "simple_intrinsic_value", lambda fin: 1300.0)
    report = check_history("JPM", "US", date(2026, 9, 26), industry="Diversified Banks",
                           financials_fn=lambda *a: _fin(), price_fn=lambda *a: [_price("2022-04-14", 10.0)])
    assert {c["verdict"] for c in report["checkpoints"]} == {"financial"}


# ── 라우트 ───────────────────────────────────────────────────────────────────


@pytest.fixture
def route(monkeypatch, tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    spec = importlib.util.spec_from_file_location(
        "screener_route_tracking", ROOT / "app" / "backend" / "routes" / "screener.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(track_record, "TRACK_DIR", tmp_path)

    def fake_scan(entry, end_date, api_keys):
        return {**entry, "verdict": "buy", "quality": None, "value": {"gap": 0.2}, "warnings": [], "error": None}

    class FakeKeys:
        def __init__(self, db):
            pass

        def get_api_keys_dict(self):
            return {}

    monkeypatch.setattr(module, "scan_ticker", fake_scan)
    monkeypatch.setattr(module, "ApiKeyService", FakeKeys)
    # 스캔이 끝나면 실제 DB 의 '저장 분석'에 남기므로, 테스트에서는 막는다.
    monkeypatch.setattr(module, "_archive_scan", lambda *args, **kwargs: None)
    # 재무 스냅샷은 파일을 읽고 쓰므로 테스트에서는 막는다(스냅샷 없음 = 전체 계산).
    monkeypatch.setattr(module, "_reprice", lambda entry, end_date: None)
    monkeypatch.setattr(module, "_save_snapshot", lambda snapshot: None)
    app = FastAPI()
    app.include_router(module.router)
    app.dependency_overrides[module.get_db] = lambda: None
    return TestClient(app), module, tmp_path


def test_completed_scan_is_recorded_for_forward_testing(route):
    client, _, tmp_path = route
    client.post("/screener/scan", json={"market": "US", "end_date": "2026-09-26"})
    saved = json.loads((tmp_path / "2026-09-26.json").read_text(encoding="utf-8"))
    assert len(saved["results"]) == 25


def test_track_record_and_history_endpoints(route, monkeypatch):
    client, module, _ = route
    monkeypatch.setattr(module.track_record, "evaluate", lambda snapshots, today: {"snapshots": len(snapshots)})
    assert client.get("/screener/track-record").json() == {"snapshots": 0}

    calls = []

    def fake_check(ticker, market, today, industry=None):
        calls.append((ticker, market, industry))
        return {"ticker": ticker, "checkpoints": []}

    monkeypatch.setattr(module.point_in_time, "check_history", fake_check)
    assert client.get("/screener/history-check", params={"ticker": "ALL", "market": "US",
                                                           "industry": "Property & Casualty Insurance"}).json()["ticker"] == "ALL"
    client.get("/screener/history-check", params={"ticker": "ALL", "market": "US"})
    assert calls == [("ALL", "US", "Property & Casualty Insurance")]  # 같은 날은 기억한 결과
    assert client.get("/screener/history-check", params={"ticker": "X", "market": "JP"}).status_code == 422


# ── 아카이브 · 차트 ──────────────────────────────────────────────────────────


def test_completed_scan_is_archived_once(route, monkeypatch):
    client, module, _ = route
    archived = []

    def fake_archive(market, end_date, language, total, results, complete):
        archived.append((market, end_date, language, total, len(results), complete))
        return 7

    monkeypatch.setattr(module, "_archive_scan", fake_archive)
    body = client.post("/screener/scan", json={"market": "US", "end_date": "2026-09-26", "language": "en"}).text
    assert archived == [("US", "2026-09-26", "en", 25, 25, True)]
    assert "event: archived" in body and '"id": 7' in body


def test_stopped_scan_archives_what_was_scanned(route, monkeypatch):
    """중간에 끊긴 스캔도 그때까지 받은 결과를 '중단'으로 남긴다."""
    client, module, _ = route
    archived = []
    monkeypatch.setattr(module, "_archive_scan",
                        lambda market, end_date, language, total, results, complete: archived.append((len(results), complete)))

    def failing_record(end_date, results):
        raise RuntimeError("boom")

    # 스트림을 도중에 끊는 대신, 제너레이터를 직접 몇 개만 받고 닫는다.
    import asyncio

    class FakeRequest:
        async def is_disconnected(self):
            return False

    async def run():
        response = await module.scan(module.ScreenerScanRequest(market="US", end_date="2026-09-26"), FakeRequest(), db=None)
        gen = response.body_iterator
        received = 0
        async for chunk in gen:
            if "event: result" in chunk:
                received += 1
                if received == 3:
                    break
        await gen.aclose()
        return received

    assert asyncio.run(run()) == 3
    assert archived == [(3, False)]


def test_archive_name_marks_partial_scans():
    spec = importlib.util.spec_from_file_location(
        "screener_route_names", ROOT / "app" / "backend" / "routes" / "screener.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module._archive_name("SP500", "ko", 120, 503, False) == "매수 후보 · S&P 500 전체 · 120/503종목 · 중단"
    assert module._archive_name("KR", "en", 25, 25, True) == "Buy candidates · Korea large caps · 25/25"


def test_price_chart_is_weekly_and_cached(route, monkeypatch):
    client, module, _ = route
    from datetime import date as _date, timedelta as _td

    calls = []
    today = _date.today()

    def fake_load(ticker, day):
        calls.append(ticker)
        days = [today - _td(days=n) for n in range(0, 30)]
        prices = [type("P", (), {"time": d.isoformat(), "close": float(i)})() for i, d in enumerate(days)]
        return {"ticker": ticker, "interval": "weekly", "rows": module.weekly_closes(prices, today - _td(days=40))}

    monkeypatch.setattr(module, "_load_chart", fake_load)
    module._chart_cache.clear()
    rows = client.get("/screener/price-chart", params={"ticker": "AAPL"}).json()["rows"]
    client.get("/screener/price-chart", params={"ticker": "AAPL"})
    assert calls == ["AAPL"]
    # 30일 → 주마다 한 줄, 날짜순, 그 주 마지막 거래일 종가
    assert 4 <= len(rows) <= 6
    assert [r["date"] for r in rows] == sorted(r["date"] for r in rows)
    assert rows[-1]["date"] == today.isoformat()


def test_naver_world_url_matches_exchange_code():
    spec = importlib.util.spec_from_file_location(
        "screener_route_naver", ROOT / "app" / "backend" / "routes" / "screener.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    items = {
        "AAPL": {"items": [{"code": "AAPL", "nationCode": "USA", "url": "/worldstock/stock/AAPL.O/total"}]},
        "BRK B": {"items": [{"code": "BRK A", "nationCode": "USA", "url": "/worldstock/stock/BRKa/total"},
                            {"code": "BRK B", "nationCode": "USA", "url": "/worldstock/stock/BRKb/total"}]},
        "KO": {"items": [{"code": "252670", "nationCode": "KOR", "url": "/domestic/stock/252670/total"}]},
    }
    fetch = lambda q: items.get(q, {})
    assert module.naver_world_url("AAPL", fetch) == "https://stock.naver.com/worldstock/stock/AAPL.O/total"
    assert module.naver_world_url("BRK-B", fetch) == "https://stock.naver.com/worldstock/stock/BRKb/total"
    assert module.naver_world_url("KO", fetch) is None


def test_archive_scan_writes_saved_analysis_and_list_omits_rows(monkeypatch, tmp_path):
    """실제 저장 경로 — 임시 DB 에 쓰고, 목록 응답은 종목 결과를 빼고 상세는 전부 준다."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.backend.database.models import Base, SavedAnalysis

    # route 픽스처는 저장을 막아 두므로, 저장 함수가 살아 있는 모듈을 따로 불러 온다.
    spec = importlib.util.spec_from_file_location(
        "screener_route_archive", ROOT / "app" / "backend" / "routes" / "screener.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine(f"sqlite:///{tmp_path / 'archive.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(module, "SessionLocal", sessionmaker(bind=engine))

    rows = [{"ticker": "MSFT", "verdict": "buy"}, {"ticker": "KO", "verdict": "watch"}]
    saved_id = module._archive_scan("SP500", "2026-09-26", "ko", 503, rows, False)

    db = sessionmaker(bind=engine)()
    item = db.query(SavedAnalysis).get(saved_id)
    assert item.source_tab == "quality_buy" and item.ticker == "SP500"
    assert item.result_data["scanned"] == 2 and item.result_data["complete"] is False
    assert item.result_data["counts"] == {"buy": 1, "watch": 1}
    assert item.result_data["saved_display_name"].endswith("매수 후보 · S&P 500 전체 · 2/503종목 · 중단")

    routes_spec = importlib.util.spec_from_file_location(
        "saved_analyses_route_under_test", ROOT / "app" / "backend" / "routes" / "saved_analyses.py"
    )
    routes = importlib.util.module_from_spec(routes_spec)
    routes_spec.loader.exec_module(routes)
    assert "results" not in routes._to_list_response(item).result_data
    assert len(routes._to_response(item).result_data["results"]) == 2
    db.close()
