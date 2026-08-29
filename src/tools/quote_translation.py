"""영어 인용문에 한국어 번역을 붙인다.

왜 데이터 쪽에서 하는가
    프롬프트에 "번역을 함께 적어라"고 넣고 실제로 돌려 봤더니, 영어 인용 8건 중
    번역이 붙은 것은 0건이었다. 모델 재량에 맡기면 지켜질 때도 있고 아닐 때도 있다.
    근거 블록에 번역을 미리 넣어 두면 모델은 옮겨 적기만 하면 된다.

실패해도 막지 않는다
    번역에 실패하면 영어 원문만 남는다. 원문이 근거이므로 번역이 없다고 분석이
    멈추면 안 된다. 번역문을 지어내는 일도 없다.
"""

from __future__ import annotations

import os
import re
from typing import Optional

#: 번역은 부가 기능이다. 오래 붙들고 있으면 분석 전체가 느려진다.
_TIMEOUT_SECONDS = 40
_MAX_LINES = 12

_TRANSLATE_PROMPT = (
    "다음은 기업 실적 발표에서 경영진이 말한 문장들이다. 각 줄을 한국어로 옮겨라.\n"
    "규칙:\n"
    "- 줄 수와 순서를 그대로 유지한다. 한 줄에 하나씩, 번호나 설명을 붙이지 않는다.\n"
    "- 화자 이름(콜론 앞)은 원문 그대로 두고 뒤의 문장만 옮긴다.\n"
    "- 수치와 고유명사(HBM4, EPS 등)는 바꾸지 않는다.\n"
    "- 의역하지 말고 뜻을 그대로 옮긴다.\n\n"
)


def _has_english_sentence(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]{3,}(?:\s+[A-Za-z,'-]+){4,}", text or ""))


def translate_lines_to_korean(
    lines: list[str],
    model_name: Optional[str] = None,
    model_provider: Optional[str] = None,
) -> list[Optional[str]]:
    """각 줄의 한국어 번역. 실패하거나 영어가 아니면 그 자리는 None."""
    if not lines:
        return []
    targets = [line if _has_english_sentence(line) else None for line in lines[:_MAX_LINES]]
    if not any(targets):
        return [None] * len(lines)

    try:
        from src.llm.models import ModelProvider, get_model

        name = model_name or os.getenv("QUOTE_TRANSLATION_MODEL", "gpt-5.4-nano")
        provider = model_provider or os.getenv("QUOTE_TRANSLATION_PROVIDER", "OpenAI")
        model = get_model(name, ModelProvider(provider) if not isinstance(provider, ModelProvider) else provider)
        if model is None:
            return [None] * len(lines)

        numbered = "\n".join(line for line in targets if line)
        response = model.invoke(_TRANSLATE_PROMPT + numbered)
        content = getattr(response, "content", "") or ""
        translated = [part.strip() for part in str(content).splitlines() if part.strip()]
    except Exception:
        return [None] * len(lines)

    # 줄 수가 어긋나면 어느 줄의 번역인지 알 수 없다. 그럴 땐 붙이지 않는다.
    wanted = [index for index, line in enumerate(targets) if line]
    if len(translated) != len(wanted):
        return [None] * len(lines)

    result: list[Optional[str]] = [None] * len(lines)
    for slot, index in enumerate(wanted):
        result[index] = translated[slot]
    return result


def with_korean_translation(lines: list[str], **kwargs) -> list[str]:
    """원문 아래에 '(번역: …)' 를 붙인 줄 목록. 번역이 없으면 원문만 남는다."""
    translations = translate_lines_to_korean(lines, **kwargs)
    merged: list[str] = []
    for line, translation in zip(lines, translations):
        merged.append(line)
        if translation and translation != line:
            merged.append(f"(번역: {translation})")
    return merged


# ── 출력에 사후로 번역을 붙인다 ──────────────────────────────────────────────
# 근거 블록에 번역을 미리 넣어도 모델은 인용만 옮기고 번역 줄은 버렸다(실측 2회).
# 지시로는 안 되므로, 모델이 쓴 글에서 영어 인용을 찾아 우리가 아는 번역을 붙인다.
# 모델의 문장은 건드리지 않고 괄호 한 줄만 덧붙이므로 뜻이 바뀌지 않는다.

_QUOTE_RE = re.compile(r'[“"]([^”"]{25,})[”"]')
#: 인용은 원문 일부만 따오는 경우가 많다. 앞부분이 겹치면 같은 문장으로 본다.
_MATCH_PREFIX = 24


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _strip_speaker(line: str) -> str:
    return re.sub(r"^[^:]{2,40}:\s*", "", line or "").strip()


def build_translation_index(lines: list[str]) -> dict:
    """'(번역: …)' 가 붙은 줄 목록 → {영문 앞부분: 한국어} 사전."""
    index: dict = {}
    pending: Optional[str] = None
    for line in lines or []:
        stripped = (line or "").strip()
        match = re.match(r"^\(번역:\s*(.+?)\)$", stripped)
        if match and pending:
            korean = _strip_speaker(match.group(1))
            key = _normalize(_strip_speaker(pending))[:_MATCH_PREFIX]
            if key:
                index[key] = korean
            pending = None
        elif _has_english_sentence(stripped):
            pending = stripped
        else:
            pending = None
    return index


def annotate_quotes_with_translation(text: str, index: dict, translate_unknown: bool = True) -> str:
    """영어 인용 뒤에 번역을 덧붙인다.

    사전(근거 블록에 미리 넣어 둔 번역)에서 먼저 찾고, 못 찾은 인용은 한 번에 모아
    즉석 번역한다. 모델이 원문 발췌에서 임의로 따온 문장은 미리 번역해 둘 수 없기
    때문이다(실측: 4건 중 2건이 그런 경우였다).
    """
    if not text:
        return text
    index = dict(index or {})

    if translate_unknown:
        unknown = []
        for match in _QUOTE_RE.finditer(text):
            quoted = match.group(1)
            if not _has_english_sentence(quoted):
                continue
            if _lookup(index, quoted) is None:
                unknown.append(quoted)
        if unknown:
            for quoted, korean in zip(unknown, translate_lines_to_korean(unknown)):
                if korean:
                    index[_normalize(quoted)[:_MATCH_PREFIX]] = korean

    if not index:
        return text

    def replace(match: re.Match) -> str:
        quoted = match.group(1)
        if not _has_english_sentence(quoted):
            return match.group(0)
        korean = _lookup(index, quoted)
        if not korean:
            return match.group(0)
        return f"{match.group(0)}(번역: {korean})"

    return _QUOTE_RE.sub(replace, text)


def _lookup(index: dict, quoted: str) -> Optional[str]:
    """인용문에 해당하는 번역. 인용이 문장 중간부터 시작하기도 해 부분 일치도 본다."""
    normalized = _normalize(quoted)
    exact = index.get(normalized[:_MATCH_PREFIX])
    if exact:
        return exact
    for candidate_key, candidate_ko in index.items():
        if candidate_key and candidate_key in normalized:
            return candidate_ko
    return None
