import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_openai_gpt54_nano_is_available_cloud_model():
    models = json.loads((ROOT / "src/llm/api_models.json").read_text())
    openai_models = [model for model in models if model["provider"] == "OpenAI"]

    assert openai_models
    assert openai_models[0]["display_name"] == "GPT-5.4 Nano"
    assert openai_models[0]["model_name"] == "gpt-5.4-nano"


def test_backend_request_defaults_to_gpt54_nano():
    schemas = (ROOT / "app/backend/models/schemas.py").read_text()

    assert 'model_name: Optional[str] = "gpt-5.4-nano"' in schemas
    assert "model_provider: Optional[ModelProvider] = ModelProvider.OPENAI" in schemas


def test_llm_fallback_defaults_to_gpt54_nano():
    llm_source = (ROOT / "src/utils/llm.py").read_text()

    assert 'model_name = "gpt-5.4-nano"' in llm_source
    assert 'model_provider = "OpenAI"' in llm_source


def test_frontend_default_model_prefers_gpt54_nano_over_gemini():
    models_source = (ROOT / "app/frontend/src/data/models.ts").read_text()

    assert 'DEFAULT_MODEL_NAME = "gpt-5.4-nano"' in models_source
    assert "model.model_name === DEFAULT_MODEL_NAME" in models_source
    assert models_source.index("model.model_name === DEFAULT_MODEL_NAME") < models_source.index('model.provider === "OpenAI"')
    assert 'gemini-2.5-flash") ||' not in models_source


def test_saved_gemini_defaults_are_coerced_to_gpt54_nano_on_node_load():
    models_source = (ROOT / "app/frontend/src/data/models.ts").read_text()
    agent_node_source = (ROOT / "app/frontend/src/nodes/components/agent-node.tsx").read_text()
    portfolio_node_source = (ROOT / "app/frontend/src/nodes/components/portfolio-manager-node.tsx").read_text()

    assert "DEPRECATED_DEFAULT_MODEL_NAMES" in models_source
    assert '"gemini-2.5-flash"' in models_source
    assert "shouldUseDefaultModel(selectedModel)" in agent_node_source
    assert "shouldUseDefaultModel(selectedModel)" in portfolio_node_source


if __name__ == "__main__":
    test_openai_gpt54_nano_is_available_cloud_model()
    test_backend_request_defaults_to_gpt54_nano()
    test_llm_fallback_defaults_to_gpt54_nano()
    test_frontend_default_model_prefers_gpt54_nano_over_gemini()
    test_saved_gemini_defaults_are_coerced_to_gpt54_nano_on_node_load()
