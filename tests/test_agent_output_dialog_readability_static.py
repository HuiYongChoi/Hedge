from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENT_DIALOG = ROOT / "app/frontend/src/nodes/components/agent-output-dialog.tsx"
JSON_DIALOG = ROOT / "app/frontend/src/nodes/components/json-output-dialog.tsx"
REASONING_CONTENT = ROOT / "app/frontend/src/components/panels/bottom/tabs/reasoning-content.tsx"
CLIPBOARD_UTIL = ROOT / "app/frontend/src/utils/clipboard-utils.ts"


def test_agent_output_copy_uses_http_safe_clipboard_fallback() -> None:
    clipboard_source = CLIPBOARD_UTIL.read_text(encoding="utf-8")
    agent_dialog_source = AGENT_DIALOG.read_text(encoding="utf-8")
    json_dialog_source = JSON_DIALOG.read_text(encoding="utf-8")
    reasoning_source = REASONING_CONTENT.read_text(encoding="utf-8")

    assert "document.execCommand('copy')" in clipboard_source
    assert "copyTextToClipboard" in agent_dialog_source
    assert "copyTextToClipboard" in json_dialog_source
    assert "copyTextToClipboard" in reasoning_source
    assert "navigator.clipboard.writeText(selectedDecision)" not in agent_dialog_source
    assert "navigator.clipboard.writeText(jsonString)" not in json_dialog_source
    assert "navigator.clipboard.writeText(contentString)" not in reasoning_source


def test_agent_output_dialog_formats_financial_plain_text_for_readability() -> None:
    source = AGENT_DIALOG.read_text(encoding="utf-8")

    assert "normalizeFinancialDisplayText" in source
    assert "renderFinancialParagraph" in source
    assert "Debt-To-Equity(부채비율)" in source
    assert "잉여현금흐름(FCF) 창출력" in source
    assert "formatKoreanWonAmount" in source
    assert "financial-metric-chip" in source
    assert "<strong" in source
