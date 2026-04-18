from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO_MANAGER = ROOT / "src/agents/portfolio_manager.py"


def test_portfolio_manager_preserves_agent_reasoning_for_final_decision_context() -> None:
    source = PORTFOLIO_MANAGER.read_text(encoding="utf-8")

    assert '"reasoning": agent_signal.get("reasoning")' in source
    assert "risk_by_ticker[ticker] = risk_data" in source
    assert "risk_by_ticker=risk_by_ticker" in source
    assert "def _build_decision_context" in source


def test_portfolio_manager_prompt_includes_decision_context_and_no_false_data_gap_claim() -> None:
    source = PORTFOLIO_MANAGER.read_text(encoding="utf-8")

    assert "Decision context" in source
    assert "decision_context" in source
    assert "Do not claim quantitative data was not provided" in source
    assert "정량 데이터가 제공되지 않았다고 쓰지 마세요" in source
    assert "json.dumps(decision_context" in source
