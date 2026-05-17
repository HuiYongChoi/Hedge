from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import pytest

from src.data.models import FinancialMetrics, Price


ROOT = Path(__file__).resolve().parents[1]
VALUATION_AGENT = ROOT / "src/agents/valuation.py"
FUNDAMENTALS_AGENT = ROOT / "src/agents/fundamentals.py"
API_MODULE = ROOT / "src/tools/api.py"
MODELS = ROOT / "src/data/models.py"


class FakeEstimateProvider:
    name = "FakeConsensus"

    def __init__(self, estimates):
        self.estimates = estimates

    def fetch_quarterly_eps_estimates(self, ticker: str, as_of_date: date, num_quarters: int = 4):
        return self.estimates[:num_quarters]


class EmptyEstimateProvider:
    name = "EmptyProvider"

    def fetch_quarterly_eps_estimates(self, ticker: str, as_of_date: date, num_quarters: int = 4):
        return []


@pytest.fixture(autouse=True)
def clear_forward_cache():
    from src.tools import forward_metrics
    from src.data.cache import get_cache

    forward_metrics._FORWARD_CACHE.clear()
    get_cache()._forward_metrics_cache.clear()
    yield
    forward_metrics._FORWARD_CACHE.clear()
    get_cache()._forward_metrics_cache.clear()


def _metric(report_period: str, eps: float | None, *, net_income: float | None = None, shares: float | None = None):
    return FinancialMetrics(
        ticker="AAPL",
        report_period=report_period,
        period="quarter",
        currency="USD",
        earnings_per_share=eps,
        net_income=net_income,
        outstanding_shares=shares,
        source="fixture",
    )


def _patch_trailing_and_prices(monkeypatch, metrics, close: float = 100.0):
    from src.tools import forward_metrics

    monkeypatch.setattr(
        forward_metrics,
        "get_financial_metrics",
        lambda **kwargs: metrics,
    )
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kwargs: [Price(open=close, close=close, high=close, low=close, volume=1, time="2025-04-04T00:00:00")],
    )


def _consensus(period_end: date, eps: float, *, analyst_count: int | None = 8):
    from src.data.models_forward import QuarterlyEPS

    return QuarterlyEPS(
        period="2025Q2",
        fiscal_period_end=period_end,
        eps=eps,
        source="consensus",
        provider="FakeConsensus",
        as_of=date(2025, 4, 5),
        analyst_count=analyst_count,
    )


def test_ac1_splices_three_actual_quarters_with_one_consensus(monkeypatch):
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        _metric("2025-03-31", 1.2),
        _metric("2024-12-31", 1.1),
        _metric("2024-09-30", 1.3),
        _metric("2024-06-30", 1.0),
    ]
    _patch_trailing_and_prices(monkeypatch, metrics)

    result = get_forward_metrics(
        "AAPL",
        as_of_date="2025-04-05",
        providers=[FakeEstimateProvider([_consensus(date(2025, 6, 30), 0.9)])],
    )

    assert result is not None
    assert [q.source for q in result.composition].count("actual") == 3
    assert [q.source for q in result.composition].count("consensus") == 1
    assert [q.period for q in result.composition] == ["2024Q3", "2024Q4", "2025Q1", "2025Q2"]
    assert result.forward_eps_ttm == pytest.approx(4.5)
    assert result.confidence == "high"


def test_ac2_forward_pe_differs_from_trailing_pe_by_five_to_thirty_percent(monkeypatch):
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        _metric("2025-03-31", 1.2),
        _metric("2024-12-31", 1.1),
        _metric("2024-09-30", 1.3),
        _metric("2024-06-30", 0.4),
    ]
    _patch_trailing_and_prices(monkeypatch, metrics, close=100.0)

    result = get_forward_metrics(
        "AAPL",
        as_of_date="2025-04-05",
        providers=[FakeEstimateProvider([_consensus(date(2025, 6, 30), 0.9)])],
    )

    trailing_pe = 100.0 / 4.0
    assert result is not None and result.forward_pe is not None
    percent_difference = abs(result.forward_pe - trailing_pe) / trailing_pe
    assert 0.05 <= percent_difference <= 0.30


def test_ac3_missing_estimate_falls_back_to_trailing_ttm_with_low_confidence(monkeypatch):
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        _metric("2025-03-31", 1.2),
        _metric("2024-12-31", 1.1),
        _metric("2024-09-30", 1.3),
        _metric("2024-06-30", 0.4),
    ]
    _patch_trailing_and_prices(monkeypatch, metrics, close=100.0)

    result = get_forward_metrics(
        "AAPL",
        as_of_date="2025-04-05",
        providers=[EmptyEstimateProvider()],
    )

    assert result is not None
    assert result.confidence == "low"
    assert result.forward_eps_ttm == pytest.approx(4.0)
    assert result.forward_pe == pytest.approx(25.0)
    assert all(q.source == "actual" for q in result.composition)
    assert "no consensus estimate available" in result.notes


def test_ac4_non_positive_forward_eps_returns_undefined_pe_without_exception(monkeypatch):
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        _metric("2025-03-31", -1.2),
        _metric("2024-12-31", -1.1),
        _metric("2024-09-30", 0.3),
        _metric("2024-06-30", 0.4),
    ]
    _patch_trailing_and_prices(monkeypatch, metrics, close=100.0)

    result = get_forward_metrics(
        "LOSS",
        as_of_date="2025-04-05",
        providers=[FakeEstimateProvider([_consensus(date(2025, 6, 30), 0.1)])],
    )

    assert result is not None
    assert result.forward_eps_ttm == pytest.approx(-1.9)
    assert result.forward_pe is None
    assert any("forward_pe undefined" in note for note in result.notes)


def test_forward_metrics_falls_back_to_yfinance_quarterly_actuals(monkeypatch):
    from src.data.models_forward import QuarterlyEPS
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kwargs: [])
    monkeypatch.setattr(
        forward_metrics,
        "_load_yfinance_quarterly_eps",
        lambda ticker, as_of: [
            QuarterlyEPS(
                period="2025Q2",
                fiscal_period_end=date(2025, 6, 30),
                eps=1.0,
                source="actual",
                provider="YFinance",
                as_of=as_of,
            ),
            QuarterlyEPS(
                period="2025Q3",
                fiscal_period_end=date(2025, 9, 30),
                eps=1.1,
                source="actual",
                provider="YFinance",
                as_of=as_of,
            ),
            QuarterlyEPS(
                period="2025Q4",
                fiscal_period_end=date(2025, 12, 31),
                eps=1.2,
                source="actual",
                provider="YFinance",
                as_of=as_of,
            ),
        ],
        raising=False,
    )
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kwargs: [Price(open=100.0, close=100.0, high=100.0, low=100.0, volume=1, time="2026-01-15T00:00:00")],
    )

    result = get_forward_metrics(
        "AAPL",
        as_of_date="2026-01-15",
        providers=[FakeEstimateProvider([_consensus(date(2026, 3, 31), 1.3)])],
    )

    assert result is not None
    assert [q.provider for q in result.composition[:3]] == ["YFinance", "YFinance", "YFinance"]
    assert result.forward_eps_ttm == pytest.approx(4.6)
    assert result.forward_pe == pytest.approx(100.0 / 4.6)


def test_parse_report_period_converts_datetime_to_plain_date():
    from src.tools.forward_metrics import _parse_report_period

    assert _parse_report_period(datetime(2026, 3, 31, 12, 30)) == date(2026, 3, 31)


def test_forward_metrics_override_takes_precedence_and_can_be_cleared(monkeypatch):
    from src.data.cache import get_cache
    from src.data.models_forward import ForwardMetrics, QuarterlyEPS
    from src.tools import forward_metrics
    from src.tools.forward_metrics import clear_forward_metrics_override, get_forward_metrics, set_forward_metrics_override

    as_of = date(2026, 5, 9)
    composition = [
        QuarterlyEPS(period="2025Q3", fiscal_period_end=date(2025, 9, 30), eps=1.0, source="actual", provider="YFinance", as_of=as_of),
        QuarterlyEPS(period="2025Q4", fiscal_period_end=date(2025, 12, 31), eps=1.1, source="actual", provider="YFinance", as_of=as_of),
        QuarterlyEPS(period="2026Q1", fiscal_period_end=date(2026, 3, 31), eps=1.2, source="actual", provider="YFinance", as_of=as_of),
        QuarterlyEPS(period="2026Q2", fiscal_period_end=date(2026, 6, 30), eps=1.3, source="consensus", provider="YFinance", as_of=as_of),
    ]
    override = ForwardMetrics(
        ticker="AAPL",
        as_of_date=as_of,
        current_price=100.0,
        forward_eps_ttm=4.6,
        forward_pe=18.5,
        composition=composition,
        confidence="high",
        notes=["user override: forward_pe manually set via Data Sandbox"],
    )

    set_forward_metrics_override(override)

    assert get_forward_metrics("AAPL", as_of_date="2026-05-09") is override
    assert get_cache().get_forward_metrics("AAPL_2026-05-09") is override

    clear_forward_metrics_override("AAPL", "2026-05-09")
    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kwargs: [])
    monkeypatch.setattr(forward_metrics, "_load_yfinance_quarterly_eps", lambda ticker, date: [])

    assert get_cache().get_forward_metrics("AAPL_2026-05-09") is None
    assert get_forward_metrics("AAPL", as_of_date="2026-05-09", providers=[EmptyEstimateProvider()]) is None


def test_ac5_valuation_and_fundamentals_reasoning_expose_trailing_and_forward_pe():
    valuation_source = VALUATION_AGENT.read_text(encoding="utf-8")
    fundamentals_source = FUNDAMENTALS_AGENT.read_text(encoding="utf-8")

    for source in (valuation_source, fundamentals_source):
        assert "get_cached_forward_metrics" in source
        assert '"trailing_pe"' in source
        assert '"forward_pe"' in source
        assert '"forward_weight"' in source
        assert '"forward_interpretation"' in source


def test_low_confidence_forward_pe_still_gets_directional_weight():
    from src.agents.valuation import _blend_trailing_forward_pe

    class Forward:
        forward_pe = 5.51
        confidence = "low"

    blended, forward_pe, trailing_weight, forward_weight, confidence = _blend_trailing_forward_pe(30.85, Forward())

    assert forward_pe == 5.51
    assert confidence == "low"
    assert forward_weight > 0
    assert trailing_weight < 1
    assert blended < 30.85


def test_price_compass_canonical_forward_pe_overrides_splice_for_agents():
    from src.agents.valuation import _blend_trailing_forward_pe

    class Forward:
        forward_pe = 36.05
        canonical_forward_pe = 5.51
        confidence = "low"

    blended, forward_pe, trailing_weight, forward_weight, confidence = _blend_trailing_forward_pe(30.85, Forward())

    assert forward_pe == 5.51
    assert confidence == "low"
    assert forward_weight > 0
    assert blended < 30.85


def test_forward_metrics_attaches_price_compass_canonical_snapshot(monkeypatch):
    from types import SimpleNamespace
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        _kr_metric("2025-09-30", 17_854),
        _kr_metric("2025-12-31", 18_500),
        _kr_metric("2026-03-31", 19_200),
    ]
    _patch_trailing_and_prices(monkeypatch, metrics, close=1_686_000.0)
    monkeypatch.setattr(forward_metrics, "_load_dart_quarterly_eps", lambda t, d: [])
    monkeypatch.setattr(forward_metrics, "_load_yfinance_quarterly_eps", lambda t, d: [])
    monkeypatch.setattr(
        forward_metrics,
        "default_provider_chain",
        lambda ticker: [FakeEstimateProvider([_kr_consensus(date(2026, 6, 30), 12_500)])],
    )
    monkeypatch.setattr(
        forward_metrics,
        "_fetch_price_compass_forward_snapshot",
        lambda ticker: SimpleNamespace(
            current_price=1_819_000.0,
            current_fy_eps=294_628.56,
            forward_eps=330_127.04,
            forward_pe=5.51,
        ),
    )

    result = get_forward_metrics("000660.KS", as_of_date="2026-05-09")

    assert result is not None
    assert result.forward_pe == pytest.approx(1_686_000.0 / (18_500 + 19_200 + 17_854 + 12_500))
    assert getattr(result, "canonical_forward_pe") == pytest.approx(5.51)
    assert getattr(result, "canonical_current_price") == pytest.approx(1_819_000.0)
    assert getattr(result, "canonical_forward_eps") == pytest.approx(330_127.04)
    assert result.forward_pe_fy1 == pytest.approx(5.51)


def test_ac6_forward_track_does_not_change_trailing_model_or_api_contract():
    api_source = API_MODULE.read_text(encoding="utf-8")
    models_source = MODELS.read_text(encoding="utf-8")

    assert "def get_financial_metrics(" in api_source
    assert "forward_pe" not in models_source
    assert "forward_eps_ttm" not in models_source
    assert "class ForwardMetrics" not in models_source


def test_ac7_korean_ticker_without_provider_data_returns_clear_low_confidence(monkeypatch):
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        FinancialMetrics(ticker="005930.KS", report_period="2025-03-31", period="quarter", currency="KRW", earnings_per_share=1200.0),
        FinancialMetrics(ticker="005930.KS", report_period="2024-12-31", period="quarter", currency="KRW", earnings_per_share=1100.0),
        FinancialMetrics(ticker="005930.KS", report_period="2024-09-30", period="quarter", currency="KRW", earnings_per_share=1000.0),
        FinancialMetrics(ticker="005930.KS", report_period="2024-06-30", period="quarter", currency="KRW", earnings_per_share=900.0),
    ]
    _patch_trailing_and_prices(monkeypatch, metrics, close=70000.0)

    result = get_forward_metrics(
        "005930.KS",
        as_of_date="2025-04-05",
        providers=[EmptyEstimateProvider()],
    )

    assert result is not None
    assert result.confidence == "low"
    assert result.forward_eps_ttm == pytest.approx(4200.0)
    assert result.forward_pe == pytest.approx(70000.0 / 4200.0)
    assert result.notes == ["no consensus estimate available"]


# ---------------------------------------------------------------------------
# v2 tests — SK하이닉스 회귀, DART backfill, staleness, currency guard
# ---------------------------------------------------------------------------

def _kr_metric(report_period: str, eps: float, ticker: str = "000660.KS"):
    return FinancialMetrics(
        ticker=ticker,
        report_period=report_period,
        period="quarter",
        currency="KRW",
        earnings_per_share=eps,
        source="fixture",
    )


def _kr_consensus(period_end: date, eps: float):
    from src.data.models_forward import QuarterlyEPS
    return QuarterlyEPS(
        period=f"{period_end.year}Q{((period_end.month - 1) // 3) + 1}",
        fiscal_period_end=period_end,
        eps=eps,
        source="consensus",
        provider="NaverFinance",
        as_of=date(2026, 5, 9),
        analyst_count=8,
    )


def _dart_actual(period_end: date, eps: float, ticker: str = "000660.KS"):
    from src.data.models_forward import QuarterlyEPS
    return QuarterlyEPS(
        period=f"{period_end.year}Q{((period_end.month - 1) // 3) + 1}",
        fiscal_period_end=period_end,
        eps=eps,
        source="actual",
        provider="DART",
        as_of=date(2026, 5, 9),
    )


def test_v2_sk_hynix_regression_consensus_spliced(monkeypatch):
    """SK하이닉스 회귀: DART로 2025Q4/2026Q1 보충 + NaverFinance 컨센서스 합성.

    Acceptance Criteria §7 items 1 & 2:
      - composition[-1].source in {consensus, consensus_split_from_annual}
      - composition[2].fiscal_period_end >= 2025-12-31
    """
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    # Primary API returns stale/sparse quarters (mirrors current broken state)
    sparse_metrics = [
        _kr_metric("2024-09-30", 7_920),
        _kr_metric("2025-03-31", 11_410),
        _kr_metric("2025-06-30", 9_580),
        _kr_metric("2025-09-30", 17_850),
    ]
    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kw: sparse_metrics)
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kw: [Price(open=169000, close=169000, high=170000, low=168000, volume=1_000_000, time="2026-05-09T00:00:00")],
    )
    # DART backfills the missing quarters
    dart_actuals = [
        _dart_actual(date(2025, 9, 30), 17_854),
        _dart_actual(date(2025, 12, 31), 18_500),  # 2025Q4
        _dart_actual(date(2026, 3, 31), 19_200),   # 2026Q1
    ]
    monkeypatch.setattr(forward_metrics, "_load_dart_quarterly_eps", lambda t, d: dart_actuals)

    # NaverFinance consensus for 2026Q2
    naver_estimate = _kr_consensus(date(2026, 6, 30), 12_500)
    result = get_forward_metrics(
        "000660.KS",
        as_of_date="2026-05-09",
        providers=[FakeEstimateProvider([naver_estimate])],
    )

    assert result is not None, "should return ForwardMetrics for KR ticker with consensus"
    # AC §7 item 1: last composition entry is consensus
    assert result.composition[-1].source in {"consensus", "consensus_split_from_annual"}
    # AC §7 item 2: 3rd composition entry (index 2) ends >= 2025-12-31
    assert result.composition[2].fiscal_period_end >= date(2025, 12, 31)
    # Should not be low confidence when we have fresh consensus
    assert result.confidence in {"high", "medium"}


def test_v2_sk_hynix_dart_backfill_replaces_yfinance_gaps(monkeypatch):
    """DART actuals should fill in the gaps left by yfinance."""
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kw: [])
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kw: [Price(open=169000, close=169000, high=170000, low=168000, volume=1, time="2026-05-09T00:00:00")],
    )

    dart_actuals = [
        _dart_actual(date(2025, 6, 30), 9_580),
        _dart_actual(date(2025, 9, 30), 17_854),
        _dart_actual(date(2025, 12, 31), 18_500),
        _dart_actual(date(2026, 3, 31), 19_200),
    ]
    monkeypatch.setattr(forward_metrics, "_load_dart_quarterly_eps", lambda t, d: dart_actuals)
    # yfinance also has sparse data
    monkeypatch.setattr(forward_metrics, "_load_yfinance_quarterly_eps", lambda t, d: [])

    consensus = _kr_consensus(date(2026, 6, 30), 12_500)
    result = get_forward_metrics(
        "000660.KS",
        as_of_date="2026-05-09",
        providers=[FakeEstimateProvider([consensus])],
    )

    assert result is not None
    dart_providers = [q.provider for q in result.composition if q.source == "actual"]
    assert all(p == "DART" for p in dart_providers)


def test_v2_staleness_note_added_when_latest_actual_stale(monkeypatch):
    """If most recent actual is >6 months old, notes should include staleness warning."""
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    old_metrics = [
        _kr_metric("2024-09-30", 7_920),
        _kr_metric("2024-06-30", 5_000),
        _kr_metric("2024-03-31", 4_500),
        _kr_metric("2023-12-31", 4_000),
    ]
    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kw: old_metrics)
    monkeypatch.setattr(forward_metrics, "_load_dart_quarterly_eps", lambda t, d: [])
    monkeypatch.setattr(forward_metrics, "_load_yfinance_quarterly_eps", lambda t, d: [])
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kw: [Price(open=169000, close=169000, high=169000, low=169000, volume=1, time="2026-05-09T00:00:00")],
    )

    consensus = _kr_consensus(date(2026, 6, 30), 12_500)
    result = get_forward_metrics(
        "000660.KS",
        as_of_date="2026-05-09",
        providers=[FakeEstimateProvider([consensus])],
    )

    assert result is not None
    # Should have staleness note
    stale_notes = [n for n in result.notes if "stale" in n.lower()]
    assert len(stale_notes) >= 1
    # Confidence should be downgraded due to staleness
    assert result.confidence in {"medium", "low"}


def test_v2_currency_field_set_to_krw_for_korean_ticker(monkeypatch):
    """ForwardMetrics.currency should be 'KRW' for Korean tickers."""
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    metrics = [
        _kr_metric("2025-09-30", 17_854),
        _kr_metric("2025-12-31", 18_500),
        _kr_metric("2026-03-31", 19_200),
    ]
    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kw: metrics)
    monkeypatch.setattr(forward_metrics, "_load_dart_quarterly_eps", lambda t, d: [])
    monkeypatch.setattr(forward_metrics, "_load_yfinance_quarterly_eps", lambda t, d: [])
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kw: [Price(open=169000, close=169000, high=169000, low=169000, volume=1, time="2026-05-09T00:00:00")],
    )
    monkeypatch.setattr(forward_metrics, "_detect_ticker_currency", lambda t: "KRW")

    consensus = _kr_consensus(date(2026, 6, 30), 12_500)
    result = get_forward_metrics(
        "000660.KS",
        as_of_date="2026-05-09",
        providers=[FakeEstimateProvider([consensus])],
    )

    assert result is not None
    assert result.currency == "KRW"


def test_v2_us_ticker_regression_unaffected(monkeypatch):
    """AAPL (US ticker) should behave exactly as v1 — no DART call, no KR routing."""
    from src.tools import forward_metrics
    from src.tools.forward_metrics import get_forward_metrics

    dart_called = {"called": False}

    def _no_dart(t, d):
        dart_called["called"] = True
        return []

    monkeypatch.setattr(forward_metrics, "_load_dart_quarterly_eps", _no_dart)

    us_metrics = [
        FinancialMetrics(ticker="AAPL", report_period="2025-09-30", period="quarter", currency="USD", earnings_per_share=1.5),
        FinancialMetrics(ticker="AAPL", report_period="2025-12-31", period="quarter", currency="USD", earnings_per_share=1.6),
        FinancialMetrics(ticker="AAPL", report_period="2026-03-31", period="quarter", currency="USD", earnings_per_share=1.7),
    ]
    monkeypatch.setattr(forward_metrics, "get_financial_metrics", lambda **kw: us_metrics)
    monkeypatch.setattr(
        forward_metrics,
        "get_prices",
        lambda **kw: [Price(open=200.0, close=200.0, high=200.0, low=200.0, volume=1, time="2026-05-09T00:00:00")],
    )

    from src.data.models_forward import QuarterlyEPS
    us_consensus = QuarterlyEPS(
        period="2026Q2", fiscal_period_end=date(2026, 6, 30),
        eps=1.8, source="consensus", provider="FMP",
        as_of=date(2026, 5, 9), analyst_count=10,
    )
    result = get_forward_metrics(
        "AAPL",
        as_of_date="2026-05-09",
        providers=[FakeEstimateProvider([us_consensus])],
    )

    assert result is not None
    # DART should NOT have been called for US ticker
    assert not dart_called["called"]
    assert result.composition[-1].source == "consensus"
    assert result.forward_eps_ttm == pytest.approx(1.5 + 1.6 + 1.7 + 1.8)


def test_v2_merge_quarterly_eps_dart_wins_on_collision():
    """DART entries should overwrite yfinance entries on same fiscal_period_end."""
    from src.data.models_forward import QuarterlyEPS
    from src.tools.forward_metrics import _merge_quarterly_eps

    yf_q = QuarterlyEPS(
        period="2025Q4", fiscal_period_end=date(2025, 12, 31),
        eps=15_000, source="actual", provider="YFinance", as_of=date(2026, 5, 9),
    )
    dart_q = QuarterlyEPS(
        period="2025Q4", fiscal_period_end=date(2025, 12, 31),
        eps=18_500, source="actual", provider="DART", as_of=date(2026, 5, 9),
    )

    merged = _merge_quarterly_eps([yf_q], [dart_q], prefer_new=True)
    assert len(merged) == 1
    assert merged[0].provider == "DART"
    assert merged[0].eps == pytest.approx(18_500)


def test_v2_models_forward_source_enum_includes_consensus_split():
    """consensus_split_from_annual must be a valid SourceKind."""
    from src.data.models_forward import QuarterlyEPS

    q = QuarterlyEPS(
        period="2026Q2",
        fiscal_period_end=date(2026, 6, 30),
        eps=12_000.0,
        source="consensus_split_from_annual",
        provider="NaverFinance",
        as_of=date(2026, 5, 9),
    )
    assert q.source == "consensus_split_from_annual"


def test_v2_forward_metrics_currency_field_defaults_to_usd():
    """ForwardMetrics.currency defaults to 'USD' for backward compat."""
    from src.data.models_forward import ForwardMetrics, QuarterlyEPS

    composition = [
        QuarterlyEPS(period="2025Q3", fiscal_period_end=date(2025, 9, 30), eps=1.0, source="actual", provider="FMP", as_of=date(2026, 5, 9)),
        QuarterlyEPS(period="2025Q4", fiscal_period_end=date(2025, 12, 31), eps=1.1, source="actual", provider="FMP", as_of=date(2026, 5, 9)),
        QuarterlyEPS(period="2026Q1", fiscal_period_end=date(2026, 3, 31), eps=1.2, source="actual", provider="FMP", as_of=date(2026, 5, 9)),
        QuarterlyEPS(period="2026Q2", fiscal_period_end=date(2026, 6, 30), eps=1.3, source="consensus", provider="FMP", as_of=date(2026, 5, 9)),
    ]
    fm = ForwardMetrics(
        ticker="AAPL",
        as_of_date=date(2026, 5, 9),
        current_price=200.0,
        forward_eps_ttm=4.6,
        forward_pe=200.0 / 4.6,
        composition=composition,
        confidence="high",
    )
    assert fm.currency == "USD"
