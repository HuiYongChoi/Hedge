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

    assert "from src.tools.forward_metrics import (" in route_source
    assert "get_forward_metrics," in route_source
    assert "get_forward_metrics, ticker, end_date, fin_api_key" in route_source
    assert 'model_dump(mode="json")' in route_source
    assert "forward_metrics=forward_metrics_dict" in route_source


def test_fetch_metrics_route_reuses_line_item_enrichment_for_complete_metrics() -> None:
    route_source = HEDGE_FUND_ROUTE.read_text(encoding="utf-8")

    assert "from src.utils.data_standardizer import enrich_metrics_from_line_items" in route_source
    assert "metrics_dict = enrich_metrics_from_line_items(" in route_source
    assert "line_items_dicts" in route_source
    assert "market_cap=market_cap" in route_source


def test_run_route_applies_and_clears_forward_metric_overrides() -> None:
    route_source = HEDGE_FUND_ROUTE.read_text(encoding="utf-8")

    assert "build_forward_metrics_override" in route_source
    assert "set_forward_metrics_override" in route_source
    assert "clear_forward_metrics_override" in route_source
    assert '"forward_metrics" in _overrides' in route_source


def test_data_sandbox_renders_forward_metrics_card() -> None:
    tab_source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

    assert "interface ForwardMetrics" in tab_source
    assert "forward_metrics: ForwardMetrics | null" in tab_source
    assert "function ForwardMetricsCard" in tab_source
    assert "fetchedData.forward_metrics" in tab_source
    assert "Forward PER" in tab_source
    assert "Forward TTM EPS" in tab_source
    assert "Composition" in tab_source


def test_data_sandbox_forward_pe_override_flows_into_run_payload_and_snapshot() -> None:
    tab_source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")

    assert "forwardPeOverride" in tab_source
    assert "buildForwardMetricsOverride" in tab_source
    assert "appliedOverrides.forward_metrics" in tab_source
    assert "forwardMetricsOverride" in tab_source


def test_stock_search_and_flow_nodes_accept_sandbox_forward_overrides() -> None:
    root = ROOT
    stock_search_source = DATA_SANDBOX_TAB.read_text(encoding="utf-8")
    stock_analyzer_source = (root / "app/frontend/src/nodes/components/stock-analyzer-node.tsx").read_text(encoding="utf-8")
    portfolio_source = (root / "app/frontend/src/nodes/components/portfolio-start-node.tsx").read_text(encoding="utf-8")
    types_source = (root / "app/frontend/src/services/types.ts").read_text(encoding="utf-8")

    assert "forward_metrics?: Record<string, any>" in types_source
    assert "getSandboxOverridesForTickers" in stock_analyzer_source
    assert "metric_overrides: sandboxMetricOverrides" in stock_analyzer_source
    assert "getSandboxOverridesForTickers" in portfolio_source
    assert "metric_overrides: sandboxMetricOverrides" in portfolio_source
    assert "forwardMetricsOverride" in stock_search_source
