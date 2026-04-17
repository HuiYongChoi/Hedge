from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LLM_SOURCE = ROOT / "src" / "utils" / "llm.py"
STOCK_SEARCH_TAB = ROOT / "app" / "frontend" / "src" / "components" / "tabs" / "stock-search-tab.tsx"


def test_llm_injects_exact_cross_check_prompt() -> None:
    source = LLM_SOURCE.read_text(encoding="utf-8")

    assert "CROSS_CHECK_GUIDE_REQUIREMENT" in source
    assert "[추가 지시사항: 원문 대조 가이드 작성]" in source
    assert "### 🔍 [당신의 이름]의 원문 대조 체크리스트" in source
    assert "핵심 타겟 데이터" in source
    assert "원문 추적 섹션" in source
    assert "경영진 멘트 검증" in source
    assert "CROSS_CHECK_GUIDE_REQUIREMENT not in text" in source
    assert "CROSS_CHECK_GUIDE_REQUIREMENT" in source[source.index("def _make_system_message") :]


def test_stock_search_has_spa_detail_report_containers() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")

    assert "selectedDetailReport" in source
    assert 'id="main-summary-view"' in source
    assert 'id="detail-report-view"' in source
    assert "display: selectedDetailReport ? 'none' : 'flex'" in source
    assert "display: selectedDetailReport ? 'block' : 'none'" in source
    assert "요약으로 돌아가기" in source
    assert "사업보고서 원문 대조 가이드" in source


def test_agent_cards_have_cross_check_button_and_spa_handler() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")

    assert "openDetailReport" in source
    assert "extractCrossCheckGuide" in source
    assert "buildFallbackCrossCheckGuide" in source
    assert "event.stopPropagation()" in source
    assert "🔍 원문 대조 리포트 보기" in source


def test_detail_view_renders_markdown_reading_blocks() -> None:
    source = STOCK_SEARCH_TAB.read_text(encoding="utf-8")

    assert "renderMarkdownBlocks" in source
    assert "renderInlineMarkdown" in source
    assert "leading-relaxed" in source
    assert "whitespace-pre-wrap" in source
