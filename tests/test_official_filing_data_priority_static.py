from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text(encoding="utf-8")


def test_us_line_items_use_sec_companyfacts_before_third_party_feeds():
    src = _read("src/tools/api.py")
    assert "SEC Companyfacts" in src
    assert "RevenueFromContractWithCustomerExcludingAssessedTax" in src
    assert "_SEC_QUARTER_FRAME_RE" in src
    assert "_sec_cumulative_quarter_values" in src
    assert "_fetch_sec_line_items" in src

    search_block = src[src.index("def search_line_items"):src.index("def get_insider_trades")]
    assert search_block.index("_fetch_sec_line_items") < search_block.index("_make_api_request")


def test_official_line_items_can_override_stale_provider_metrics():
    src = _read("src/tools/api.py")
    standardizer = _read("src/utils/data_standardizer.py")
    route = _read("app/backend/routes/hedge_fund.py")

    assert "official_sources = {\"SEC Companyfacts\", \"DART\"}" in src
    assert "line_item_source in official_sources" in src
    assert "prefer_line_items" in standardizer
    assert "prefer_line_items=_line_items_newer_than_metrics" in route


def test_dart_report_codes_and_quarterly_line_items_are_available():
    src = _read("src/tools/dart_api.py")
    assert 'REPRT_Q1 = "11013"' in src
    assert 'REPRT_H1 = "11012"' in src
    assert 'REPRT_Q3 = "11014"' in src
    assert 'REPRT_ANNUAL = "11011"' in src
    assert "def _fetch_dart_quarter_line_items" in src
    assert "def _build_dart_ttm_from_quarters" in src
    assert '"source": "DART"' in src
