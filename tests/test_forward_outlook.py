from __future__ import annotations

from datetime import date

import pytest

from src.data.models_forward import AnnualEPSEstimate, ForwardMetrics, QuarterlyEPS


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
    assert "directional" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION
    assert "must not revert to a trailing-only conclusion" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION
    # The instruction now has an explicit NEVER-write section that LISTS these
    # tokens as forbidden in LLM output — they appear in the instruction but
    # only as items to prohibit, not as usage instructions.
    assert "NEVER write" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION
    assert "forward P/E" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION
    assert "TTM PER" in FORWARD_OUTLOOK_SYSTEM_INSTRUCTION


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


def test_forward_outlook_locks_standard_forward_per():
    from src.utils.forward_outlook import build_forward_outlook_block

    metrics = _forward_metrics()
    metrics = metrics.model_copy(update={
        "forward_pe": 36.05,
        "canonical_current_price": 1819000.0,
        "canonical_forward_eps": 330127.04174228676,
        "canonical_forward_pe": 5.51,
        "forward_eps_fy0": 294628.56,
        "forward_pe_fy0": 6.17,
        "fy0_estimate": AnnualEPSEstimate(
            fiscal_year=2026,
            fiscal_year_end=date(2026, 12, 31),
            eps=294628.56,
            source="consensus",
            provider="Fixture",
            as_of=date(2026, 5, 10),
            analyst_count=20,
            confidence="high",
        ),
    })

    block = build_forward_outlook_block(metrics, trailing_pe=30.85)

    assert block["raw_spliced_forward_pe"] == 36.05
    assert block["forward_eps_ttm"] == 330127.04174228676
    assert block["canonical_multiples"]["price_compass_fwd_per"] == 5.51
    assert block["canonical_multiples"]["ttm_per"] == 30.85
    assert block["canonical_multiples"]["current_fy_per"] == 6.17
    assert "Baseline forward P/E 5.51x" in block["interpretation_hint"]
    assert "Current-year P/E 6.17x" in block["interpretation_hint"]
    assert "36.05" not in block["interpretation_hint"]
    assert "Price Compass" not in block["interpretation_hint"]
    assert "canonical" not in block["interpretation_hint"].lower()


def test_build_forward_outlook_warns_when_confidence_low():
    from src.utils.forward_outlook import build_forward_outlook_block

    block = build_forward_outlook_block(_forward_metrics(confidence="low"), trailing_pe=12.0)

    assert block["confidence"] == "low"
    assert "Confidence is low" in block["interpretation_hint"]
    assert "directional" in block["interpretation_hint"]


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


def test_system_instruction_avoids_developer_tokens():
    """The system instruction must NOT teach the LLM developer-only key names.
    It must explicitly forbid these tokens from appearing in the analyst-facing
    output."""
    from src.utils.forward_outlook import FORWARD_OUTLOOK_SYSTEM_INSTRUCTION

    instr = FORWARD_OUTLOOK_SYSTEM_INSTRUCTION

    # The instruction MUST explicitly list these tokens in its NEVER-write section
    forbidden_in_output = [
        "Price Compass",
        "canonical FwdPER",
        "canonical_multiples",
        "forward_outlook",
        "raw spliced",
        "interpretation_hint",
        "pe_change_pct",
    ]
    for token in forbidden_in_output:
        assert token in instr, f"{token!r} must be listed as forbidden in SYSTEM_INSTRUCTION"

    # The instruction must mention the NEVER directive
    assert "NEVER write" in instr or "must NOT" in instr or "do NOT" in instr.lower()

    # The instruction must teach the analyst-facing vocabulary
    assert "선행 PER" in instr or "forward P/E" in instr
    assert "TTM PER" in instr
    assert "12M forward consensus EPS" in instr or "12개월 선행" in instr


def test_interpretation_hint_uses_analyst_vocabulary():
    """_build_interpretation_hint output must use 'Baseline forward P/E'
    and 'TTM P/E' phrasing, not raw key names."""
    from src.utils.forward_outlook import _build_interpretation_hint

    metrics = _forward_metrics()

    hint = _build_interpretation_hint(
        metrics,
        trailing_pe=30.9,
        forward_pe=5.5,
        pe_change_pct=-82.2,
    )

    assert "Price Compass FwdPER" not in hint
    assert "Baseline forward P/E" in hint
    assert "TTM P/E" in hint
    assert "Next-quarter" not in hint
    assert "Forward consensus EPS" in hint
