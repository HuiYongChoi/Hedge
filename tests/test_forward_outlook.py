from __future__ import annotations

from datetime import date

import pytest

from src.data.models_forward import ForwardMetrics, QuarterlyEPS


def _quarter(period: str, year: int, month: int, eps: float, source: str = "actual") -> QuarterlyEPS:
    return QuarterlyEPS(
        period=period,
        fiscal_period_end=date(year, month, 30),
        eps=eps,
        source=source,
        provider="TestProvider",
        as_of=date(2026, 5, 10),
        analyst_count=7 if source.startswith("consensus") else None,
        dispersion=0.12 if source.startswith("consensus") else None,
    )


def _forward_metrics(confidence: str = "high") -> ForwardMetrics:
    composition = [
        _quarter("2025Q3", 2025, 9, 1.00),
        _quarter("2025Q4", 2025, 12, 2.00),
        _quarter("2026Q1", 2026, 3, 3.00),
        _quarter("2026Q2", 2026, 6, 4.00, source="consensus"),
    ]
    return ForwardMetrics(
        ticker="AAPL",
        as_of_date=date(2026, 5, 10),
        current_price=150.0,
        forward_eps_ttm=10.0,
        forward_pe=15.0,
        composition=composition,
        confidence=confidence,
        notes=["fixture"],
        currency="USD",
    )


def test_build_forward_outlook_unavailable_when_metrics_missing():
    from src.utils.forward_outlook import build_forward_outlook_block

    block = build_forward_outlook_block(None)

    assert block["available"] is False
    assert "reason" in block
    assert "trailing metrics" in block["fallback_guidance"]


def test_forward_outlook_system_instruction_requires_consensus_usage():
    from src.utils.forward_outlook import FORWARD_OUTLOOK_SYSTEM_INSTRUCTION

    assert "FORWARD OUTLOOK REQUIREMENT" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION
    assert "forward consensus" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION
    assert "confidence" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION


def test_build_forward_outlook_serializes_standard_block_and_delta():
    from src.utils.forward_outlook import build_forward_outlook_block

    block = build_forward_outlook_block(_forward_metrics(), trailing_pe=20.0)

    assert block["available"] is True
    assert block["as_of_date"] == "2026-05-10"
    assert block["currency"] == "USD"
    assert block["forward_eps_ttm"] == 10.0
    assert block["forward_pe"] == 15.0
    assert block["trailing_pe"] == 20.0
    assert block["pe_change_pct"] == -25.0
    assert block["composition"][-1] == {
        "period": "2026Q2",
        "fiscal_period_end": "2026-06-30",
        "eps": 4.0,
        "source": "consensus",
        "provider": "TestProvider",
        "analyst_count": 7,
        "dispersion": 0.12,
    }
    assert "4.00" in block["interpretation_hint"]
    assert "earnings expansion" in block["interpretation_hint"]


def test_build_forward_outlook_warns_when_confidence_low():
    from src.utils.forward_outlook import build_forward_outlook_block

    block = build_forward_outlook_block(_forward_metrics(confidence="low"), trailing_pe=12.0)

    assert block["confidence"] == "low"
    assert "LOW" in block["interpretation_hint"]


def test_cached_forward_metrics_fetches_once_and_reuses_cache(monkeypatch):
    from src.utils import forward_outlook

    calls: list[tuple[str, str, str | None]] = []
    expected = _forward_metrics()

    def fake_get_forward_metrics(ticker: str, as_of_date: str, api_key: str | None):
        calls.append((ticker, as_of_date, api_key))
        return expected

    monkeypatch.setattr(forward_outlook, "get_forward_metrics", fake_get_forward_metrics)
    state = {"data": {}}

    first = forward_outlook.get_cached_forward_metrics(state, "aapl", "2026-05-10", "key")
    second = forward_outlook.get_cached_forward_metrics(state, "AAPL", "2026-05-10", "key")

    assert first is expected
    assert second is expected
    assert calls == [("AAPL", "2026-05-10", "key")]
    assert state["data"][forward_outlook.CACHE_KEY]["AAPL"] is expected


def test_cached_forward_metrics_caches_failure_as_none(monkeypatch):
    from src.utils import forward_outlook

    calls: list[str] = []

    def fake_get_forward_metrics(ticker: str, as_of_date: str, api_key: str | None):
        calls.append(ticker)
        raise RuntimeError("provider down")

    monkeypatch.setattr(forward_outlook, "get_forward_metrics", fake_get_forward_metrics)
    state = {"data": {}}

    assert forward_outlook.get_cached_forward_metrics(state, "MSFT", "2026-05-10", None) is None
    assert forward_outlook.get_cached_forward_metrics(state, "MSFT", "2026-05-10", None) is None
    assert calls == ["MSFT"]
    assert state["data"][forward_outlook.CACHE_KEY]["MSFT"] is None


def test_forward_prefetch_node_fetches_unique_tickers_once(monkeypatch):
    from src.agents import forward_prefetch
    from src.utils.forward_outlook import CACHE_KEY

    calls: list[str] = []

    def fake_cached_forward_metrics(state, ticker, end_date, api_key):
        calls.append(ticker)
        state["data"][CACHE_KEY][ticker] = None
        return None

    monkeypatch.setattr(forward_prefetch, "get_cached_forward_metrics", fake_cached_forward_metrics)
    monkeypatch.setattr(forward_prefetch.progress, "update_status", lambda *args, **kwargs: None)
    monkeypatch.setattr(forward_prefetch, "get_api_key_from_state", lambda state, key: "key")

    state = {
        "data": {
            "tickers": ["AAPL", "aapl", "MSFT"],
            "end_date": "2026-05-10",
        },
        "metadata": {},
    }

    result = forward_prefetch.forward_prefetch_node(state)

    assert calls == ["AAPL", "MSFT"]
    assert result["data"][CACHE_KEY] == {"AAPL": None, "MSFT": None}
