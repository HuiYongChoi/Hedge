from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GRAPH_SERVICE = ROOT / "app/backend/services/graph.py"


def test_create_graph_deduplicates_nodes_and_edges_before_langgraph_build() -> None:
    source = GRAPH_SERVICE.read_text(encoding="utf-8")

    assert "def _deduplicate_graph_nodes" in source
    assert "def _deduplicate_graph_edges" in source
    assert "graph_nodes = _deduplicate_graph_nodes(graph_nodes)" in source
    assert "graph_edges = _deduplicate_graph_edges(graph_edges)" in source


def test_create_graph_ignores_edges_for_nodes_not_added_to_execution_graph() -> None:
    source = GRAPH_SERVICE.read_text(encoding="utf-8")

    assert "execution_node_ids" in source
    assert "if edge.source not in execution_node_ids or edge.target not in execution_node_ids" in source
    assert "continue" in source[source.index("if edge.source not in execution_node_ids") :]
