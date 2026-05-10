"""LangGraph node that prefetches forward metrics once per ticker."""

from __future__ import annotations

from src.graph.state import AgentState
from src.utils.api_key import get_api_key_from_state
from src.utils.forward_outlook import CACHE_KEY, get_cached_forward_metrics
from src.utils.progress import progress


def _unique_tickers(tickers: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for ticker in tickers:
        normalized = ticker.strip().upper()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def forward_prefetch_node(state: AgentState, agent_id: str = "forward_prefetch") -> dict:
    """Prefetch ForwardMetrics for all tickers into the shared state cache."""
    data = state["data"]
    end_date = data["end_date"]
    api_key = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")
    data.setdefault(CACHE_KEY, {})

    for ticker in _unique_tickers(data.get("tickers", [])):
        progress.update_status(agent_id, ticker, "Prefetching forward metrics")
        get_cached_forward_metrics(state, ticker, end_date, api_key)

    progress.update_status(agent_id, None, "Done")
    return {"data": data}
