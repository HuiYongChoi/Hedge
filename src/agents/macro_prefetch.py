"""시장 레짐을 1회 조회해 공유 state 에 싣는다.

forward_prefetch 와 같은 자리(애널리스트 앞)에서 돌지만 티커 루프가 없다 —
시장 상태는 종목과 무관하게 하나다.
"""

from __future__ import annotations

from src.graph.state import AgentState
from src.tools.macro_regime import fetch_macro_regime
from src.utils.progress import progress


def macro_prefetch_node(state: AgentState, agent_id: str = "macro_prefetch") -> dict:
    data = state["data"]
    progress.update_status(agent_id, None, "Fetching macro regime")
    try:
        data["macro_regime"] = fetch_macro_regime(data.get("end_date"))
    except Exception:
        data["macro_regime"] = None      # 여기서 막히면 분석 전체가 멈춘다
    progress.update_status(agent_id, None, "Done")
    return {"data": data}
