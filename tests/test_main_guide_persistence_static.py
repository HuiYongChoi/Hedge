from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TAB_CONTENT = ROOT / "app/frontend/src/components/tabs/tab-content.tsx"
SETTINGS = ROOT / "app/frontend/src/components/settings/settings.tsx"
SETTINGS_INDEX = ROOT / "app/frontend/src/components/settings/index.ts"
SETTINGS_MODELS = ROOT / "app/frontend/src/components/settings/models.tsx"
STOCK_TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
FLOW_TAB = ROOT / "app/frontend/src/components/tabs/flow-tab-content.tsx"
FLOW_ACTIONS = ROOT / "app/frontend/src/hooks/use-enhanced-flow-actions.ts"


def test_main_page_explains_current_workflow_and_scoring() -> None:
    source = TAB_CONTENT.read_text(encoding="utf-8")

    for text in [
        "데이터 수집 및 표준화",
        "에이전트 정량 평가",
        "포트폴리오 매니저 종합",
        "종합 점수",
        "DART",
        "yfinance",
        "결과는 DB에 저장",
    ]:
        assert text in source


def test_main_page_has_agent_quant_scoring_detail_view() -> None:
    source = TAB_CONTENT.read_text(encoding="utf-8")

    for text in [
        "showAgentScoring",
        "상세보기",
        "에이전트별 정량 평가 기준",
        "피터 린치",
        "필 피셔",
        "성장: 30%",
        "마진 안정성: 25%",
        "7.5점 이상이면 Buy",
        "4.5점 이하이면 Sell",
    ]:
        assert text in source


def test_settings_surface_keeps_api_keys_hidden() -> None:
    settings_source = SETTINGS.read_text(encoding="utf-8")
    index_source = SETTINGS_INDEX.read_text(encoding="utf-8")
    models_source = SETTINGS_MODELS.read_text(encoding="utf-8")

    assert "ApiKeysSettings" not in settings_source
    assert "apiKeys" not in settings_source
    assert "export { ApiKeysSettings }" not in index_source
    assert "CloudModels" not in index_source
    assert "OllamaSettings" not in index_source
    assert "fetch(" not in models_source
    assert "API 키를 입력하거나 조회하는 곳이 아닙니다" in models_source
    assert "키 노출 없이 서버에서만 사용" in models_source
    assert "yfinance" in models_source
    assert "SEC EDGAR" in models_source
    assert "DART" in models_source
    assert "models" in settings_source
    assert "theme" in settings_source
    assert "language" in settings_source


def test_stock_analysis_has_database_backed_saved_runs() -> None:
    source = STOCK_TAB.read_text(encoding="utf-8")

    assert "stockAnalysisRunService" in source
    assert "serializeStockAnalysisState" in source
    assert "restoreStockAnalysisState" in source
    assert "saveLatestRun" in source
    assert "getLatestRun" in source
    assert "selectedDetailReport" in source


def test_flow_runtime_context_is_restored_from_database() -> None:
    flow_tab_source = FLOW_TAB.read_text(encoding="utf-8")
    flow_actions_source = FLOW_ACTIONS.read_text(encoding="utf-8")

    assert "importNodeContextData" in flow_tab_source
    assert "flow.data.nodeContextData" in flow_tab_source
    assert "importNodeContextData" in flow_actions_source
    assert "flow.data.nodeContextData" in flow_actions_source
