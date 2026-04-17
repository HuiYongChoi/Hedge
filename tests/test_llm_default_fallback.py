from pydantic import BaseModel

from src.utils import llm as llm_utils


class DummyResponse(BaseModel):
    value: str


def test_call_llm_uses_default_factory_when_model_initialization_fails(monkeypatch):
    def fail_get_model(*_args, **_kwargs):
        raise ValueError("Google API key not found")

    monkeypatch.setattr(llm_utils, "get_model", fail_get_model)

    result = llm_utils.call_llm(
        prompt="return a value",
        pydantic_model=DummyResponse,
        default_factory=lambda: DummyResponse(value="fallback"),
    )

    assert result == DummyResponse(value="fallback")


def test_extract_json_from_plain_json_response():
    assert llm_utils.extract_json_from_response('{"signal": "bullish"}') == {"signal": "bullish"}
