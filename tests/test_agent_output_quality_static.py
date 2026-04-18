from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LLM_SOURCE = ROOT / "src/utils/llm.py"
STOCK_SEARCH_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
AGENTS_DIR = ROOT / "src/agents"


def test_call_llm_injects_report_quality_requirement() -> None:
    source = LLM_SOURCE.read_text(encoding="utf-8")

    assert "REPORT_QUALITY_REQUIREMENT" in source
    assert "기존의 짧은 글자 수 제한보다 우선합니다" in source
    assert "### 핵심 판단" in source
    assert "### 핵심 근거" in source
    assert "### 리스크와 반대 근거" in source
    assert "REPORT_QUALITY_REQUIREMENT" in source[source.index("def _make_system_message") :]
    assert "REPORT_QUALITY_REQUIREMENT" in source[source.index("def _append_korean_requirement_to_text") :]


def test_compact_agent_prompts_do_not_cap_reasoning_length() -> None:
    checked_files = [
        AGENTS_DIR / "warren_buffett.py",
        AGENTS_DIR / "charlie_munger.py",
        AGENTS_DIR / "nassim_taleb.py",
        AGENTS_DIR / "portfolio_manager.py",
    ]
    combined = "\n".join(path.read_text(encoding="utf-8") for path in checked_files)

    forbidden = [
        "Keep reasoning under 120 characters",
        "Keep reasoning under 150 characters",
        "max 150 chars",
        "최대 150자",
        "short justification",
    ]
    for phrase in forbidden:
        assert phrase not in combined

    for required in [
        "structured, decision-grade reasoning",
        "핵심 판단",
        "핵심 근거",
        "리스크와 반대 근거",
    ]:
        assert required in combined


def test_stock_analysis_agent_reasoning_renders_markdown_blocks() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")
    agent_summary_source = source[source.index("function AgentReportSummary") :]

    assert "{renderMarkdownBlocks(formatDecisionReasoning(entry.reasoning))}" in agent_summary_source
    assert "{String(entry.reasoning)}" not in agent_summary_source
