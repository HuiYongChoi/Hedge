"""열거형 값 한 단어 때문에 분석 전체가 버려지지 않는지 확인한다.

실측(2026-08-30, 000660.KS): 프롬프트의 "전부 한국어로 쓰라" 지시를 모델이
열거형 값에까지 적용해 signal="중립" 을 돌려줬다. 스키마는 bullish/bearish/
neutral 만 받으므로 검증이 3회 모두 실패했고, 이미 완성돼 있던 수천 자 분량의
분석이 통째로 fallback 으로 대체되어 리포트 전 섹션이 비었다. 게다가 그 fallback
의 기본 signal 이 Literal 의 첫 값(bullish)이라 화면에는 '신뢰도 0% 매수'가 떴다.

여기서 막는 것:
  1. 열거형 값의 번역·장식 표기를 스키마 값으로 되돌린다.
  2. 되돌릴 수 없으면 그 필드만 버리고 서술은 살린다.
  3. 실패했을 때의 기본 판단은 절대 매수가 아니다.
"""

from typing import Literal

from pydantic import BaseModel

from src.utils import llm as llm_utils


class SignalModel(BaseModel):
    signal: Literal["bullish", "bearish", "neutral"]
    confidence: float
    reasoning: str


class ActionModel(BaseModel):
    action: Literal["buy", "sell", "short", "cover", "hold"]
    quantity: int


class SentimentModel(BaseModel):
    sentiment: Literal["positive", "negative", "neutral"]
    reasoning: str


SIGNAL_OPTIONS = ("bullish", "bearish", "neutral")
ACTION_OPTIONS = ("buy", "sell", "short", "cover", "hold")


# ── 1. 값 되돌리기 ────────────────────────────────────────────────────────────
def test_korean_signal_words_map_back_to_schema_values():
    assert llm_utils.match_literal_option("중립", SIGNAL_OPTIONS) == "neutral"
    assert llm_utils.match_literal_option("매수", SIGNAL_OPTIONS) == "bullish"
    assert llm_utils.match_literal_option("매도", SIGNAL_OPTIONS) == "bearish"
    assert llm_utils.match_literal_option("강세", SIGNAL_OPTIONS) == "bullish"
    assert llm_utils.match_literal_option("약세", SIGNAL_OPTIONS) == "bearish"


def test_same_korean_word_resolves_per_field():
    """'중립' 은 signal 에서는 neutral, action 에서는 hold 다."""
    assert llm_utils.match_literal_option("중립", SIGNAL_OPTIONS) == "neutral"
    assert llm_utils.match_literal_option("중립", ACTION_OPTIONS) == "hold"
    assert llm_utils.match_literal_option("매수", ACTION_OPTIONS) == "buy"
    assert llm_utils.match_literal_option("공매도", ACTION_OPTIONS) == "short"


def test_decorated_and_cased_values_are_accepted():
    assert llm_utils.match_literal_option("  Neutral ", SIGNAL_OPTIONS) == "neutral"
    assert llm_utils.match_literal_option("**bullish**", SIGNAL_OPTIONS) == "bullish"
    assert llm_utils.match_literal_option("중립 (관망)", SIGNAL_OPTIONS) == "neutral"


def test_unknown_value_is_not_guessed():
    """모르는 값을 억지로 매기지 않는다 — 틀린 신호는 없는 신호보다 나쁘다."""
    assert llm_utils.match_literal_option("횡보권 박스", SIGNAL_OPTIONS) is None
    assert llm_utils.match_literal_option("", SIGNAL_OPTIONS) is None
    assert llm_utils.match_literal_option(None, SIGNAL_OPTIONS) is None


def test_coerce_enum_fields_leaves_prose_alone():
    data = {"signal": "중립", "confidence": 58.0, "reasoning": "### 핵심 판단\n중립입니다."}
    coerced = llm_utils.coerce_enum_fields(dict(data), SignalModel)
    assert coerced["signal"] == "neutral"
    assert coerced["reasoning"] == data["reasoning"]
    assert coerced["confidence"] == 58.0


def test_sentiment_field_uses_its_own_option_set():
    data = llm_utils.coerce_enum_fields({"sentiment": "긍정", "reasoning": "x"}, SentimentModel)
    assert data["sentiment"] == "positive"


# ── 2. 되돌릴 수 없을 때 서술 살리기 ──────────────────────────────────────────
def test_salvage_keeps_the_analysis_when_the_enum_is_repairable():
    model = llm_utils.build_model_with_salvage(
        SignalModel, {"signal": "중립", "confidence": 58.0, "reasoning": "긴 분석 본문"}
    )
    assert model.signal == "neutral"
    assert model.confidence == 58.0
    assert model.reasoning == "긴 분석 본문"


def test_salvage_drops_only_the_broken_field():
    model = llm_utils.build_model_with_salvage(
        SignalModel, {"signal": "해석불가값", "confidence": 58.0, "reasoning": "긴 분석 본문"}
    )
    assert model is not None
    assert model.reasoning == "긴 분석 본문", "서술은 살아야 한다"
    assert model.signal == "neutral", "못 읽은 판단은 관망으로 떨어져야 한다"


def test_salvage_reads_include_raw_payload():
    raw = type("Raw", (), {"content": '{"signal": "중립", "confidence": 58.0, "reasoning": "본문"}'})()
    model = llm_utils.salvage_structured_result(
        {"raw": raw, "parsed": None, "parsing_error": ValueError("literal_error")},
        SignalModel,
    )
    assert model is not None and model.signal == "neutral" and model.reasoning == "본문"


# ── 3. 실패 기본값은 매수가 아니다 ────────────────────────────────────────────
def test_failure_default_is_never_a_buy():
    assert llm_utils.create_default_response(SignalModel).signal == "neutral"
    assert llm_utils.create_default_response(ActionModel).action == "hold"
    assert llm_utils.create_default_response(SentimentModel).sentiment == "neutral"


# ── 4. 지시문 ─────────────────────────────────────────────────────────────────
def test_korean_requirement_carves_out_enum_values():
    text = llm_utils.KOREAN_OUTPUT_REQUIREMENT
    assert "exclusively in Korean" in text
    assert "SCHEMA ENUM VALUES" in text
    for token in ("bullish", "bearish", "neutral", "buy", "sell", "hold"):
        assert token in text


def test_korean_requirement_is_appended_only_once():
    once = llm_utils._append_korean_requirement_to_text("본문")
    twice = llm_utils._append_korean_requirement_to_text(once)
    assert once.count("SCHEMA ENUM VALUES") == 1
    assert twice.count("SCHEMA ENUM VALUES") == 1


# ── 5. call_llm 통합 ──────────────────────────────────────────────────────────
class _FakeStructuredLLM:
    """with_structured_output(include_raw=True) 가 돌려주는 모양을 흉내 낸다."""

    def __init__(self, payload):
        self._payload = payload

    def with_structured_output(self, *_args, **_kwargs):
        return self

    def invoke(self, _prompt):
        raw = type("Raw", (), {"content": self._payload})()
        return {"raw": raw, "parsed": None, "parsing_error": ValueError("literal_error")}


def test_call_llm_keeps_the_analysis_when_the_model_translates_the_enum(monkeypatch):
    body = "### 핵심 판단\n에스케이하이닉스는 마진 방어가 확인됩니다."
    payload = '{"signal": "중립", "confidence": 58.0, "reasoning": %s}' % __import__("json").dumps(body, ensure_ascii=False)

    monkeypatch.setattr(llm_utils, "get_model", lambda *a, **k: _FakeStructuredLLM(payload))
    monkeypatch.setattr(llm_utils, "get_model_info", lambda *a, **k: None)

    result = llm_utils.call_llm(prompt="분석하라", pydantic_model=SignalModel)

    assert result.signal == "neutral"
    assert result.confidence == 58.0
    assert "마진 방어" in result.reasoning
    assert "분석 중 오류가 발생하여" not in result.reasoning, "분석이 fallback 으로 버려지면 안 된다"
