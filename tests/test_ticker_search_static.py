from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TICKER_SEARCH = ROOT / "app/backend/routes/ticker_search.py"


def test_korean_ticker_search_has_incar_fallback_and_dynamic_listing_lookup() -> None:
    source = TICKER_SEARCH.read_text(encoding="utf-8")

    assert '"211050.KQ", "name": "인카금융서비스"' in source
    assert "def _get_korean_listing_cache" in source
    assert "StockTicker().listed" in source
    assert "get_market_ticker_name" in source
    assert "get_stock_ticekr_market" in source
    assert "def _search_korean_listing" in source


def test_korean_ticker_search_combines_static_and_dynamic_sources_for_korean_queries() -> None:
    source = TICKER_SEARCH.read_text(encoding="utf-8")

    assert "static_results = _search_korean_static(q)" in source
    assert "dynamic_results = _search_korean_listing(q)" in source
    assert "return _deduplicate(static_results + dynamic_results)[:10]" in source
