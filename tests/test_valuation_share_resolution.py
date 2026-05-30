from types import SimpleNamespace

import src.agents.valuation as valuation
from src.agents.valuation import _resolve_point_in_time_shares


def _metric(shares):
    return SimpleNamespace(outstanding_shares=shares)


def test_prefers_metrics_snapshot_without_fetching(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("should not fetch line items when snapshot exists")

    monkeypatch.setattr(valuation, "search_line_items", _boom)
    shares = _resolve_point_in_time_shares(
        [_metric(1_116_000_000.0)], ticker="MU", end_date="2026-05-30", api_key=None
    )
    assert shares == 1_116_000_000.0


def test_falls_back_to_annual_point_in_time_when_snapshot_missing(monkeypatch):
    calls = []

    def _fake(*, ticker, line_items, end_date, period, limit, api_key):
        calls.append(period)
        if period == "annual":
            return [SimpleNamespace(outstanding_shares=1_116_000_000.0)]
        raise AssertionError("annual should have satisfied the lookup")

    monkeypatch.setattr(valuation, "search_line_items", _fake)
    # Snapshot is None (MU): must not use the summed TTM count, must fetch annual.
    shares = _resolve_point_in_time_shares(
        [_metric(None)], ticker="MU", end_date="2026-05-30", api_key=None
    )
    assert shares == 1_116_000_000.0
    assert calls == ["annual"]


def test_falls_back_to_quarterly_when_annual_empty(monkeypatch):
    def _fake(*, ticker, line_items, end_date, period, limit, api_key):
        if period == "annual":
            return []
        return [SimpleNamespace(outstanding_shares=1_120_000_000.0)]

    monkeypatch.setattr(valuation, "search_line_items", _fake)
    shares = _resolve_point_in_time_shares(
        [_metric(0.0)], ticker="MU", end_date="2026-05-30", api_key=None
    )
    assert shares == 1_120_000_000.0


def test_returns_none_when_no_point_in_time_source(monkeypatch):
    monkeypatch.setattr(valuation, "search_line_items", lambda **kw: [])
    assert (
        _resolve_point_in_time_shares(
            [_metric(None)], ticker="MU", end_date="2026-05-30", api_key=None
        )
        is None
    )
