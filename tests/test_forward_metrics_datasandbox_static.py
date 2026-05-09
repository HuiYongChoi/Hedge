from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "app/backend/models/schemas.py"
HEDGE_FUND_ROUTE = ROOT / "app/backend/routes/hedge_fund.py"
DATA_SANDBOX_TAB = ROOT / "app/frontend/src/components/tabs/data-sandbox-tab.tsx"


def test_fetch_metrics_response_exposes_forward_metrics_contract() -> None:
    schemas_source = SCHEMAS.read_text(encoding="utf-8")

    assert "class FetchMetricsResponse" in schemas_source
    assert "forward_metrics: Optional[Dict[str, Any]] = None" in schemas_source


def test_fetch_metrics_route_fetches_and_serializes_forward_metrics() -> None:
    route_source = HEDGE_FUND_ROUTE.read_text(encoding="utf-8")

    assert "from src.tools.forward_metrics import get_forward_metrics" in route_source
    assert "get_forward_metrics, ticker, end_date, fin_api_key" in route_source
    assert 'model_dump(mode="json")' in route_source
    assert "forward_metrics=forward_metrics_dict" in route_source


def test_data_sandbox_renders_forward_metrics_card() -> None:
    tab_source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

    assert "interface ForwardMetrics" in tab_source
    assert "forward_metrics: ForwardMetrics | null" in tab_source
    assert "function ForwardMetricsCard" in tab_source
    assert "fetchedData.forward_metrics" in tab_source
    assert "Forward PER" in tab_source
    assert "Forward TTM EPS" in tab_source
    assert "Composition" in tab_source
