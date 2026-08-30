from __future__ import annotations

import re

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PERSONALITY_AGENT_FILES = [
    "src/agents/aswath_damodaran.py",
    "src/agents/warren_buffett.py",
    "src/agents/charlie_munger.py",
    "src/agents/peter_lynch.py",
    "src/agents/ben_graham.py",
    "src/agents/bill_ackman.py",
    "src/agents/cathie_wood.py",
    "src/agents/michael_burry.py",
    "src/agents/mohnish_pabrai.py",
    "src/agents/phil_fisher.py",
    "src/agents/stanley_druckenmiller.py",
    "src/agents/rakesh_jhunjhunwala.py",
    "src/agents/nassim_taleb.py",
    "src/agents/growth_agent.py",
]

LLM_PERSONALITY_AGENT_FILES = [
    path for path in PERSONALITY_AGENT_FILES if path != "src/agents/growth_agent.py"
]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_all_personality_agents_import_forward_outlook_helpers():
    for path in PERSONALITY_AGENT_FILES:
        text = _read(path)
        assert "build_forward_outlook_block" in text, path
        assert "get_cached_forward_metrics" in text, path
        assert "FORWARD_OUTLOOK_SYSTEM_INSTRUCTION" in text, path


def test_all_personality_agents_include_forward_outlook_in_payload():
    for path in PERSONALITY_AGENT_FILES:
        text = _read(path)
        assert '"forward_outlook": forward_outlook' in text, path
        assert "build_forward_outlook_block(forward_metrics, trailing_pe=trailing_pe)" in text, path


def test_llm_personality_agents_include_forward_guideline_in_system_prompt():
    for path in LLM_PERSONALITY_AGENT_FILES:
        text = _read(path)
        assert "ChatPromptTemplate.from_messages" in text, path
        assert "FORWARD_OUTLOOK_SYSTEM_INSTRUCTION" in text, path


def test_growth_agent_carries_forward_guidance_for_report_chain():
    text = _read("src/agents/growth_agent.py")

    assert '"forward_outlook_instruction": FORWARD_OUTLOOK_SYSTEM_INSTRUCTION' in text


def test_fundamentals_and_valuation_share_forward_metrics_cache():
    for path in ["src/agents/fundamentals.py", "src/agents/valuation.py"]:
        text = _read(path)
        assert "from src.utils.forward_outlook import get_cached_forward_metrics" in text, path
        assert "from src.tools.forward_metrics import get_forward_metrics" not in text, path
        assert "get_cached_forward_metrics(state, ticker, end_date, api_key)" in text, path


def test_graph_routes_analysts_through_forward_prefetch_node():
    text = _read("app/backend/services/graph.py")

    # 지켜야 할 것은 "애널리스트가 선반입 뒤에 실행된다"이지 특정 노드 이름이 아니다.
    # 선반입 체인은 늘어날 수 있다(start_node → forward_prefetch → macro_prefetch → 애널리스트).
    assert "from src.agents.forward_prefetch import forward_prefetch_node" in text
    assert 'graph.add_node("forward_prefetch", forward_prefetch_node)' in text
    assert '"start_node", "forward_prefetch"' in text          # 실행 노드로 등록
    assert 'graph.add_edge("start_node", "forward_prefetch")' in text

    # 체인의 마지막 선반입 노드가 애널리스트로 이어져야 한다. 어느 노드가
    # 마지막인지는 바뀔 수 있으므로 이름을 박지 않고 존재만 확인한다.
    prefetch_nodes = set(re.findall(r'graph\.add_node\("(\w*prefetch)"', text))
    assert prefetch_nodes, "선반입 노드가 사라졌다"
    fan_out = set(re.findall(r'graph\.add_edge\("(\w*prefetch)", agent_id\)', text))
    assert len(fan_out) == 1, f"애널리스트로 갈라지는 선반입 노드는 정확히 하나여야 한다: {fan_out}"
    tail = fan_out.pop()
    assert tail in prefetch_nodes

    # 그 마지막 노드가 forward_prefetch 가 아니라면, forward_prefetch 뒤에 와야 한다.
    if tail != "forward_prefetch":
        assert f'graph.add_edge("forward_prefetch", "{tail}")' in text, (
            f"{tail} 이 forward_prefetch 뒤에 연결되지 않았다 — 선행 지표 없이 애널리스트가 돈다"
        )
