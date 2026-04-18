"""Helper functions for LLM"""

import json
import re
from pydantic import BaseModel
from src.llm.models import get_model, get_model_info
from src.utils.progress import progress
from src.graph.state import AgentState


KOREAN_OUTPUT_REQUIREMENT = "CRITICAL REQUIREMENT: You MUST write your entire analysis, reasoning, and summary exclusively in Korean (한국어). Do NOT output any English sentences."
DATA_GAP_HANDLING_REQUIREMENT = (
    "DATA GAP HANDLING REQUIREMENT: Continue the investment analysis even when exact metrics are N/A. "
    "Do NOT write phrases like 'insufficient data', 'data not available', 'cannot analyze', 'unable to evaluate', "
    "'데이터가 부족', or '평가할 수 없다'. State the unavailable metric as N/A, use available proxy metrics and qualitative context, "
    "and explain the resulting uncertainty. Never invent numbers."
)
CROSS_CHECK_GUIDE_REQUIREMENT = """[추가 지시사항: 원문 대조 가이드 작성]
당신은 자신의 투자 철학에 따라 기업을 분석한 후, 최종 의사결정권자(사용자)가 원본 사업보고서(SEC 10-K 또는 DART)를 직접 읽으며 당신의 분석을 검증할 수 있도록 돕는 '크로스체크 가이드'를 함께 제출해야 합니다.

당신의 페르소나에 맞춰, 아래 폼을 엄격히 준수하여 가독성 좋은 마크다운 리스트 형식으로 작성하십시오. 제목에는 별도 이름이나 페르소나명을 붙이지 마십시오.

### 🔍 원문 대조 체크리스트
1. **핵심 타겟 데이터:** 이 분석을 위해 당신이 전처리 데이터에서 가장 중요하게 들여다본 정량적 수치 2~3개 (예: 잉여현금흐름 X원, 영업이익률 Y%).
2. **원문 추적 섹션:** 사용자가 사업보고서를 열었을 때, 당신이 제기한 긍정/부정적 논거의 진짜 증거를 찾기 위해 **정확히 어느 섹션**(예: MD&A, 재무제표 주석 5번, 핵심 위험 요소 등)을 읽어야 하는지 구체적인 위치 지목.
3. **경영진 멘트 검증:** 원문에서 사용자가 두 눈으로 직접 확인해야 할 경영진의 워딩이나 뉘앙스(예: "경영진이 R&D 축소를 언급하는지 확인하십시오", "자사주 매입 계획의 연기 사유를 읽어보십시오").
"""
REPORT_QUALITY_REQUIREMENT = """[추가 지시사항: 결과 보고 품질]
reasoning, summary, details, explanation, analysis 필드가 있다면 짧은 결론 한 문장으로 끝내지 말고, 사용자가 에이전트 간 결과를 비교할 수 있는 구조화된 보고서로 작성하십시오. 이 요구사항은 기존의 짧은 글자 수 제한보다 우선합니다.

권장 구성:
### 핵심 판단
- 최종 신호와 신뢰도를 한 문단으로 설명.

### 핵심 근거
- 제공된 전처리 수치, 점수, 섹션별 details 중 중요한 근거 3~5개를 연결.
- 수치가 N/A이면 N/A라고 밝히고, 사용 가능한 대체 지표와 정성 맥락으로 불확실성을 설명.

### 리스크와 반대 근거
- 현재 판단을 약화시킬 수 있는 반대 증거, 데이터 공백, 밸류에이션/재무/사업 리스크를 분리해 설명.
"""
SCHEMA_COMPATIBILITY_REQUIREMENT = (
    "스키마 호환 지시사항: 응답 JSON 스키마에 별도의 cross_check_guide 필드가 없다면, 투자 의견 및 추론을 작성한 뒤 reasoning 문자열의 마지막에 원문 대조 체크리스트 마크다운을 이어서 작성하십시오. 이 지시사항은 reasoning 길이 제한보다 우선합니다."
)
KOREAN_DEFAULT_REASONING = "### 핵심 판단\n분석 중 오류가 발생하여 중립 의견으로 기본 처리했습니다.\n\n### 핵심 근거\n- 모델 응답을 신뢰 가능한 구조로 파싱하지 못했습니다.\n- 제공된 신호와 전처리 데이터는 보존되므로 세부 에이전트 결과를 함께 확인해야 합니다.\n\n### 리스크와 반대 근거\n- 자동 fallback 결과이므로 실제 투자 판단에는 원문 공시와 에이전트별 세부 근거 대조가 필요합니다."
KOREAN_NO_TRADE_REASONING = "### 핵심 판단\n현재 실행 가능한 거래가 없어 관망합니다.\n\n### 핵심 근거\n- 허용된 행동이 hold로 제한되어 주문 수량을 만들 수 없습니다.\n- 에이전트 신호는 참고하되 포지션 제약을 우선 적용했습니다.\n\n### 리스크와 반대 근거\n- 시드머니, 보유 수량, 주문 가능 수량이 바뀌면 최종 행동도 달라질 수 있습니다."
KOREAN_DEFAULT_HOLD_REASONING = "### 핵심 판단\n모델 응답 실패로 관망 결정을 적용했습니다.\n\n### 핵심 근거\n- 구조화된 최종 주문 응답을 받지 못해 보수적 기본값을 사용했습니다.\n- 기존 에이전트 신호는 별도 결과 카드에서 확인할 수 있습니다.\n\n### 리스크와 반대 근거\n- fallback 판단이므로 모델 재실행 또는 원문 공시 대조가 필요합니다."
KOREAN_DATA_GAP_REASONING = "### 핵심 판단\n일부 핵심 지표는 N/A라서 확인 가능한 대체 지표 기준으로 보수적으로 관망합니다.\n\n### 핵심 근거\n- 정확한 수치가 없는 항목은 N/A로 유지했습니다.\n- 사용 가능한 재무/시장/정성 지표를 중심으로 불확실성을 반영했습니다.\n\n### 리스크와 반대 근거\n- 데이터 공백이 해소되면 신호와 신뢰도가 달라질 수 있으므로 원문 공시 대조가 필요합니다."


DATA_GAP_LANGUAGE_PATTERNS = (
    r"insufficient\s+(?:fundamental\s+|historical\s+|financial\s+|free\s+cash\s+flow\s+|earnings\s+|revenue\s+|margin\s+|price\s+|daily\s+returns\s+|data\s+)?data[^.;,\n]*",
    r"no\s+[\w\s/-]*data\s+(?:available|found)[^.;,\n]*",
    r"data\s+not\s+available[^.;,\n]*",
    r"not\s+enough\s+[\w\s/-]*data[^.;,\n]*",
    r"missing\s+[\w\s/-]*(?:data|components?)[^.;,\n]*",
    r"missing\s+[^.;,\n]*",
    r"no\s+(?:financial\s+)?metrics[^.;,\n]*",
    r"cannot\s+(?:compute|calculate|analyze|value|evaluate)[^.;,\n]*",
    r"unable\s+to\s+(?:compute|calculate|analyze|value|evaluate)[^.;,\n]*",
    r"데이터가\s*부족[^.;,\n]*",
    r"자료가\s*부족[^.;,\n]*",
    r"정보가\s*부족[^.;,\n]*",
    r"입력값이\s*없[^.;,\n]*",
    r"평가할\s*수\s*없[^.;,\n]*",
    r"분석할\s*수\s*없[^.;,\n]*",
)


def sanitize_data_gap_language(text: str) -> str:
    """Replace analysis-stopping data complaints with N/A/proxy-analysis wording."""
    if not isinstance(text, str):
        return text
    sanitized = text
    for pattern in DATA_GAP_LANGUAGE_PATTERNS:
        sanitized = re.sub(
            pattern,
            "N/A로 표시된 정확한 지표는 대체 가능한 공개 지표와 정성 맥락으로 보수적으로 해석",
            sanitized,
            flags=re.IGNORECASE,
        )
    return sanitized


def _append_korean_requirement_to_text(text: str) -> str:
    """Append prompt-wide data-gap, cross-check guide, and Korean-only instructions once."""
    text = sanitize_data_gap_language(text).rstrip()
    requirements = []
    if DATA_GAP_HANDLING_REQUIREMENT not in text:
        requirements.append(DATA_GAP_HANDLING_REQUIREMENT)
    if CROSS_CHECK_GUIDE_REQUIREMENT not in text:
        requirements.append(CROSS_CHECK_GUIDE_REQUIREMENT)
    if REPORT_QUALITY_REQUIREMENT not in text:
        requirements.append(REPORT_QUALITY_REQUIREMENT)
    if SCHEMA_COMPATIBILITY_REQUIREMENT not in text:
        requirements.append(SCHEMA_COMPATIBILITY_REQUIREMENT)
    if KOREAN_OUTPUT_REQUIREMENT not in text:
        requirements.append(KOREAN_OUTPUT_REQUIREMENT)
    if not requirements:
        return text
    return f"{text}\n\n" + "\n\n".join(requirements)


def _clone_message_with_content(message: any, content: str):
    if getattr(message, "content", None) == content:
        return message

    if hasattr(message, "model_copy"):
        return message.model_copy(update={"content": content})
    if hasattr(message, "copy"):
        return message.copy(update={"content": content})

    try:
        cloned = message.__class__(content=content)
        if hasattr(message, "name"):
            cloned.name = message.name
        return cloned
    except Exception:
        message.content = content
        return message


def _make_system_message():
    content = "\n\n".join(
        [
            DATA_GAP_HANDLING_REQUIREMENT,
            CROSS_CHECK_GUIDE_REQUIREMENT,
            REPORT_QUALITY_REQUIREMENT,
            SCHEMA_COMPATIBILITY_REQUIREMENT,
            KOREAN_OUTPUT_REQUIREMENT,
        ]
    )
    try:
        from langchain_core.messages import SystemMessage

        return SystemMessage(content=content)
    except Exception:
        return {"role": "system", "content": content}


def _clone_prompt_with_messages(prompt: any, messages: list):
    if hasattr(prompt, "model_copy"):
        return prompt.model_copy(update={"messages": messages})

    try:
        return prompt.__class__(messages=messages)
    except Exception:
        prompt.messages = messages
        return prompt


def enforce_korean_output_requirement(prompt: any) -> any:
    """
    Ensure every LLM prompt includes the Korean-only output requirement.

    ChatPromptTemplate.invoke returns a prompt value with messages; for those,
    append the requirement to the final system message. For plain string prompts,
    append it to the bottom of the prompt body.
    """
    if isinstance(prompt, str):
        return _append_korean_requirement_to_text(prompt)

    text = getattr(prompt, "text", None)
    if isinstance(text, str):
        updated_text = _append_korean_requirement_to_text(text)
        if hasattr(prompt, "model_copy"):
            return prompt.model_copy(update={"text": updated_text})
        try:
            return prompt.__class__(text=updated_text)
        except Exception:
            prompt.text = updated_text
            return prompt

    messages = getattr(prompt, "messages", None)
    if isinstance(messages, list):
        updated_messages = []
        for message in messages:
            content = getattr(message, "content", None)
            if isinstance(content, str):
                updated_messages.append(_clone_message_with_content(message, sanitize_data_gap_language(content)))
            else:
                updated_messages.append(message)
        system_index = None

        for idx in range(len(updated_messages) - 1, -1, -1):
            message = updated_messages[idx]
            message_type = getattr(message, "type", "")
            class_name = message.__class__.__name__.lower()
            if message_type == "system" or "system" in class_name:
                system_index = idx
                break

        if system_index is None:
            updated_messages.insert(0, _make_system_message())
        else:
            system_message = updated_messages[system_index]
            content = getattr(system_message, "content", "")
            if isinstance(content, str):
                updated_messages[system_index] = _clone_message_with_content(
                    system_message,
                    _append_korean_requirement_to_text(content),
                )

        return _clone_prompt_with_messages(prompt, updated_messages)

    return prompt


def _koreanize_default_string(value: str) -> str:
    lower = value.lower()
    if "no valid trade available" in lower:
        return KOREAN_NO_TRADE_REASONING
    if "default decision" in lower and "hold" in lower:
        return KOREAN_DEFAULT_HOLD_REASONING
    if (
        "insufficient data" in lower
        or "data not available" in lower
        or "not enough" in lower
        or "missing" in lower
        or "cannot calculate" in lower
        or "unable to calculate" in lower
        or "데이터가 부족" in value
        or "자료가 부족" in value
        or "정보가 부족" in value
        or "입력값이 없" in value
        or "평가할 수 없다" in value
        or "분석할 수 없" in value
    ):
        return KOREAN_DATA_GAP_REASONING
    if "error in analysis" in lower or "parsing error" in lower or "defaulting to neutral" in lower:
        return KOREAN_DEFAULT_REASONING
    return value


def ensure_korean_default_texts(value: any, field_name: str | None = None):
    """Replace known fallback reasoning strings with Korean text."""
    if isinstance(value, str):
        if field_name in {"reasoning", "summary", "details", "explanation", "analysis"}:
            return _koreanize_default_string(sanitize_data_gap_language(value))
        return value

    if isinstance(value, BaseModel):
        for nested_field_name in value.model_fields:
            nested_value = getattr(value, nested_field_name, None)
            updated_value = ensure_korean_default_texts(nested_value, nested_field_name)
            if updated_value is not nested_value:
                setattr(value, nested_field_name, updated_value)
        return value

    if isinstance(value, dict):
        for key, nested_value in value.items():
            value[key] = ensure_korean_default_texts(nested_value, str(key))
        return value

    if isinstance(value, list):
        for index, nested_value in enumerate(value):
            value[index] = ensure_korean_default_texts(nested_value, field_name)
        return value

    return value


def create_fallback_response(pydantic_model: type[BaseModel], default_factory=None) -> BaseModel:
    if default_factory:
        return ensure_korean_default_texts(default_factory())
    return ensure_korean_default_texts(create_default_response(pydantic_model))


def call_llm(
    prompt: any,
    pydantic_model: type[BaseModel],
    agent_name: str | None = None,
    state: AgentState | None = None,
    max_retries: int = 3,
    default_factory=None,
) -> BaseModel:
    """
    Makes an LLM call with retry logic, handling both JSON supported and non-JSON supported models.

    Args:
        prompt: The prompt to send to the LLM
        pydantic_model: The Pydantic model class to structure the output
        agent_name: Optional name of the agent for progress updates and model config extraction
        state: Optional state object to extract agent-specific model configuration
        max_retries: Maximum number of retries (default: 3)
        default_factory: Optional factory function to create default response on failure

    Returns:
        An instance of the specified Pydantic model
    """
    
    # Extract model configuration if state is provided and agent_name is available
    if state and agent_name:
        model_name, model_provider = get_agent_model_config(state, agent_name)
    else:
        # Use system defaults when no state or agent_name is provided
        model_name = "gpt-5.4-nano"
        model_provider = "OpenAI"

    # Extract API keys from state if available
    api_keys = None
    if state:
        request = state.get("metadata", {}).get("request")
        if request and hasattr(request, 'api_keys'):
            api_keys = request.api_keys

    try:
        model_info = get_model_info(model_name, model_provider)
        llm = get_model(model_name, model_provider, api_keys)

        # For non-JSON support models, we can use structured output
        if not (model_info and not model_info.has_json_mode()):
            llm = llm.with_structured_output(
                pydantic_model,
                method="json_mode",
            )
    except Exception as e:
        if agent_name:
            progress.update_status(agent_name, None, "Error - using default response")
        print(f"Error initializing LLM {model_provider}/{model_name}: {e}")
        return create_fallback_response(pydantic_model, default_factory)

    prompt = enforce_korean_output_requirement(prompt)

    # Call the LLM with retries
    for attempt in range(max_retries):
        try:
            # Call the LLM
            result = llm.invoke(prompt)

            # For non-JSON support models, we need to extract and parse the JSON manually
            if model_info and not model_info.has_json_mode():
                parsed_result = extract_json_from_response(result.content)
                if parsed_result:
                    return ensure_korean_default_texts(pydantic_model(**parsed_result))
            else:
                return ensure_korean_default_texts(result)

        except Exception as e:
            if agent_name:
                progress.update_status(agent_name, None, f"Error - retry {attempt + 1}/{max_retries}")

            if attempt == max_retries - 1:
                print(f"Error in LLM call after {max_retries} attempts: {e}")
                return create_fallback_response(pydantic_model, default_factory)

    # This should never be reached due to the retry logic above
    return create_fallback_response(pydantic_model, default_factory)


def create_default_response(model_class: type[BaseModel]) -> BaseModel:
    """Creates a safe default response based on the model's fields."""
    default_values = {}
    for field_name, field in model_class.model_fields.items():
        if field.annotation == str:
            default_values[field_name] = KOREAN_DEFAULT_REASONING
        elif field.annotation == float:
            default_values[field_name] = 0.0
        elif field.annotation == int:
            default_values[field_name] = 0
        elif hasattr(field.annotation, "__origin__") and field.annotation.__origin__ == dict:
            default_values[field_name] = {}
        else:
            # For other types (like Literal), try to use the first allowed value
            if hasattr(field.annotation, "__args__"):
                default_values[field_name] = field.annotation.__args__[0]
            else:
                default_values[field_name] = None

    return model_class(**default_values)


def extract_json_from_response(content: str) -> dict | None:
    """Extracts JSON from markdown-formatted response."""
    try:
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        stripped = content.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            return json.loads(stripped)

        json_start = content.find("```json")
        if json_start != -1:
            json_text = content[json_start + 7 :]  # Skip past ```json
            json_end = json_text.find("```")
            if json_end != -1:
                json_text = json_text[:json_end].strip()
                return json.loads(json_text)
    except Exception as e:
        print(f"Error extracting JSON from response: {e}")
    return None


def get_agent_model_config(state, agent_name):
    """
    Get model configuration for a specific agent from the state.
    Falls back to global model configuration if agent-specific config is not available.
    Always returns valid model_name and model_provider values.
    """
    request = state.get("metadata", {}).get("request")
    
    if request and hasattr(request, 'get_agent_model_config'):
        # Get agent-specific model configuration
        model_name, model_provider = request.get_agent_model_config(agent_name)
        # Ensure we have valid values
        if model_name and model_provider:
            return model_name, model_provider.value if hasattr(model_provider, 'value') else str(model_provider)
    
    # Fall back to global configuration (system defaults)
    model_name = state.get("metadata", {}).get("model_name") or "gpt-5.4-nano"
    model_provider = state.get("metadata", {}).get("model_provider") or "OpenAI"
    
    # Convert enum to string if necessary
    if hasattr(model_provider, 'value'):
        model_provider = model_provider.value
    
    return model_name, model_provider
