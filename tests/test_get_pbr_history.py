from __future__ import annotations

from types import SimpleNamespace

import pandas as pd


class _Response:
    status_code = 200

    def __init__(self, payload: dict):
        self._payload = payload

    def json(self):
        return self._payload


def test_get_pbr_history_uses_financialdatasets_first(monkeypatch):
    from src.tools import api

    payload = {
        "financial_metrics": [
            {"report_period": "2026-03-31", "price_to_book_ratio": 3.0, "book_value_per_share": 50.0},
            {"report_period": "2025-12-31", "price_to_book_ratio": 2.5, "book_value_per_share": 48.0},
            {"report_period": "2025-09-30", "price_to_book_ratio": 2.0, "book_value_per_share": 46.0},
            {"report_period": "2025-06-30", "price_to_book_ratio": 1.5, "book_value_per_share": 44.0},
        ]
    }

    monkeypatch.setattr(api._cache, "get_pbr_history", lambda _key: None, raising=False)
    monkeypatch.setattr(api._cache, "set_pbr_history", lambda _key, _data: None, raising=False)
    monkeypatch.setattr(api, "_make_api_request", lambda *_args, **_kwargs: _Response(payload))
    monkeypatch.setattr(api, "_fmp_get", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("FMP should not be called")))
    monkeypatch.setattr(api, "_fetch_yfinance_pbr_series", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("yfinance should not be called")))

    result = api.get_pbr_history("MU", "2026-05-10", limit=8, api_key="key")

    assert [point.price_to_book_ratio for point in result] == [3.0, 2.5, 2.0, 1.5]
    assert result[0].source == "financialdatasets"


def test_get_pbr_history_falls_back_to_fmp_annual(monkeypatch):
    from src.tools import api

    fmp_rows = [
        {"date": "2026-08-31", "pbRatio": 3.4, "bookValuePerShare": 16.0},
        {"date": "2025-08-31", "pbRatio": 2.7, "bookValuePerShare": 15.0},
        {"date": "2024-08-31", "pbRatio": 1.9, "bookValuePerShare": 14.0},
        {"date": "2023-08-31", "pbRatio": 1.2, "bookValuePerShare": 13.0},
    ]

    monkeypatch.setattr(api._cache, "get_pbr_history", lambda _key: None, raising=False)
    monkeypatch.setattr(api._cache, "set_pbr_history", lambda _key, _data: None, raising=False)
    monkeypatch.setattr(api, "_make_api_request", lambda *_args, **_kwargs: _Response({"financial_metrics": []}))
    monkeypatch.setattr(api, "_fmp_get", lambda endpoint, params: fmp_rows if endpoint == "key-metrics" else None)

    result = api.get_pbr_history("MU", "2026-05-10", limit=8, api_key="key")

    assert len(result) == 4
    assert result[0].period == "2026-08-31"
    assert result[0].price_to_book_ratio == 3.4
    assert result[0].source == "fmp"


def test_get_pbr_history_synthesizes_yfinance_series(monkeypatch):
    from src.tools import api

    class _Ticker:
        quarterly_balance_sheet = pd.DataFrame(
            {
                pd.Timestamp("2026-03-31"): [400.0, 10.0],
                pd.Timestamp("2025-12-31"): [360.0, 10.0],
                pd.Timestamp("2025-09-30"): [330.0, 10.0],
                pd.Timestamp("2025-06-30"): [300.0, 10.0],
            },
            index=["Stockholders Equity", "Ordinary Shares Number"],
        )

        def history(self, *args, **kwargs):
            return pd.DataFrame(
                {"Close": [120.0, 90.0, 66.0, 45.0]},
                index=[
                    pd.Timestamp("2026-03-31"),
                    pd.Timestamp("2025-12-31"),
                    pd.Timestamp("2025-09-30"),
                    pd.Timestamp("2025-06-30"),
                ],
            )

    monkeypatch.setattr(api._cache, "get_pbr_history", lambda _key: None, raising=False)
    monkeypatch.setattr(api._cache, "set_pbr_history", lambda _key, _data: None, raising=False)
    monkeypatch.setattr(api, "_make_api_request", lambda *_args, **_kwargs: _Response({"financial_metrics": []}))
    monkeypatch.setattr(api, "_fmp_get", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(api, "_fetch_dart_pbr_series", lambda *_args, **_kwargs: [])
    monkeypatch.setitem(__import__("sys").modules, "yfinance", SimpleNamespace(Ticker=lambda _ticker: _Ticker()))

    result = api.get_pbr_history("000660.KS", "2026-05-10", limit=8, api_key="key")

    assert len(result) == 4
    assert [round(point.price_to_book_ratio, 2) for point in result] == [3.0, 2.5, 2.0, 1.5]
    assert result[0].book_value_per_share == 40.0
    assert result[0].source == "yfinance"
