"""Tests for src/tools/company_name.resolve_company_name."""

import sys
import types
import pytest
from unittest.mock import MagicMock


def _clear_cache():
    from src.tools.company_name import resolve_company_name
    resolve_company_name.cache_clear()


def _make_fake_yfinance(info: dict):
    """Inject a fake yfinance module into sys.modules."""
    fake_yf = types.ModuleType("yfinance")
    fake_ticker = MagicMock()
    fake_ticker.info = info
    fake_yf.Ticker = lambda t: fake_ticker
    return fake_yf


# ---------------------------------------------------------------------------
# US ticker via yfinance
# ---------------------------------------------------------------------------

def test_us_ticker_resolves_via_yfinance(monkeypatch):
    _clear_cache()
    monkeypatch.setitem(sys.modules, "yfinance", _make_fake_yfinance({"longName": "Corning Incorporated"}))

    from src.tools.company_name import resolve_company_name
    result = resolve_company_name("GLW")
    assert "Corning" in result


def test_us_ticker_falls_back_to_shortname(monkeypatch):
    _clear_cache()
    monkeypatch.setitem(sys.modules, "yfinance", _make_fake_yfinance({"shortName": "Corning Inc"}))

    from src.tools.company_name import resolve_company_name
    result = resolve_company_name("GLW")
    assert "Corning" in result


# ---------------------------------------------------------------------------
# Korean ticker via DART
# ---------------------------------------------------------------------------

def test_korean_ticker_uses_dart(monkeypatch):
    _clear_cache()
    fake_dart = MagicMock()
    fake_dart.company.return_value = {
        "status": "000",
        "corp_code": "00126380",
        "corp_name": "삼성전자",
        "corp_name_eng": "SAMSUNG ELECTRONICS CO., LTD.",
    }

    monkeypatch.setattr("src.tools.dart_api._get_dart", lambda: fake_dart)

    from src.tools.company_name import resolve_company_name
    result = resolve_company_name("005930.KS")
    assert "삼성전자" in result


def test_korean_ticker_strips_suffix(monkeypatch):
    """005930.KQ should strip suffix before calling dart.company('005930')."""
    _clear_cache()
    calls = []

    fake_dart = MagicMock()
    def fake_company(code):
        calls.append(code)
        return {"status": "000", "corp_code": "X", "corp_name": "테스트"}
    fake_dart.company.side_effect = fake_company

    monkeypatch.setattr("src.tools.dart_api._get_dart", lambda: fake_dart)

    from src.tools.company_name import resolve_company_name
    resolve_company_name("005930.KQ")
    assert calls[0] == "005930"


# ---------------------------------------------------------------------------
# Unknown ticker falls back to the ticker itself
# ---------------------------------------------------------------------------

def test_unknown_ticker_falls_back_to_ticker(monkeypatch):
    _clear_cache()
    monkeypatch.setattr("src.tools.dart_api._get_dart", lambda: None)
    monkeypatch.setitem(sys.modules, "yfinance", _make_fake_yfinance({}))

    import os
    monkeypatch.delitem(os.environ, "FINANCIAL_DATASETS_API_KEY", raising=False)
    monkeypatch.delitem(os.environ, "FMP_API_KEY", raising=False)

    from src.tools.company_name import resolve_company_name
    result = resolve_company_name("ZZZNONE")
    assert result == "ZZZNONE"


# ---------------------------------------------------------------------------
# LRU cache deduplication
# ---------------------------------------------------------------------------

def test_lru_cache_avoids_double_lookup(monkeypatch):
    _clear_cache()
    call_count = {"n": 0}

    fake_yf = types.ModuleType("yfinance")
    def counting_ticker(t):
        call_count["n"] += 1
        m = MagicMock()
        m.info = {"longName": "Acme Corp"}
        return m
    fake_yf.Ticker = counting_ticker
    monkeypatch.setitem(sys.modules, "yfinance", fake_yf)

    from src.tools.company_name import resolve_company_name
    resolve_company_name("ACME")
    resolve_company_name("ACME")
    assert call_count["n"] == 1


# ---------------------------------------------------------------------------
# Empty / None ticker
# ---------------------------------------------------------------------------

def test_empty_ticker_returns_empty():
    _clear_cache()
    from src.tools.company_name import resolve_company_name
    assert resolve_company_name("") == ""
