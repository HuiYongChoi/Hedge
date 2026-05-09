from __future__ import annotations

from datetime import date
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

    forward_metrics._FORWARD_CACHE.clear()
    yield
    forward_metrics._FORWARD_CACHE.clear()


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


def test_ac5_valuation_and_fundamentals_reasoning_expose_trailing_and_forward_pe():
    valuation_source = VALUATION_AGENT.read_text(encoding="utf-8")
    fundamentals_source = FUNDAMENTALS_AGENT.read_text(encoding="utf-8")

    for source in (valuation_source, fundamentals_source):
        assert "get_forward_metrics" in source
        assert '"trailing_pe"' in source
        assert '"forward_pe"' in source
        assert '"forward_weight"' in source
        assert 'confidence == "low"' in source


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
