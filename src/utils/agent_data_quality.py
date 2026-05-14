"""에이전트 sub-analysis 점수의 data-quality 표기 표준."""
from __future__ import annotations
from typing import Any, Optional
import copy


DATA_INSUFFICIENT = "DATA_INSUFFICIENT"  # LLM 프롬프트용 sentinel


def insufficient(max_score: int, details: str, **extra: Any) -> dict[str, Any]:
    """데이터가 모자라 계산이 불가능할 때의 표준 반환값."""
    base = {
        "score": None,
        "max_score": max_score,
        "data_quality": "insufficient",
        "details": details,
    }
    base.update(extra)
    return base


def partial(score: float, max_score: int, details: str, **extra: Any) -> dict[str, Any]:
    """일부 축은 계산됐지만 일부는 None인 케이스."""
    base = {
        "score": score,
        "max_score": max_score,
        "data_quality": "partial",
        "details": details,
    }
    base.update(extra)
    return base


def ok(score: float, max_score: int, details: str, **extra: Any) -> dict[str, Any]:
    """완전히 계산된 정상 케이스."""
    base = {
        "score": score,
        "max_score": max_score,
        "data_quality": "ok",
        "details": details,
    }
    base.update(extra)
    return base


def aggregate_scores(components: list[dict[str, Any]]) -> dict[str, Any]:
    """None 점수를 건너뛰고 effective max로 정규화한 집계."""
    raw_max = sum(c.get("max_score", 0) for c in components)
    scored = [c for c in components if c.get("score") is not None]
    effective_max = sum(c.get("max_score", 0) for c in scored)
    total = sum(float(c["score"]) for c in scored)
    coverage = (effective_max / raw_max) if raw_max else 0.0
    pct = (total / effective_max) if effective_max else None
    return {
        "total_score": total,
        "effective_max": effective_max,
        "raw_max": raw_max,
        "coverage": coverage,
        "normalized_pct": pct,
    }


def sanitize_for_llm(analysis_data: dict[str, Any]) -> dict[str, Any]:
    """LLM 프롬프트에 들어가기 직전 None 점수를 명시 토큰으로 치환."""
    sanitized = copy.deepcopy(analysis_data)

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            if "score" in node and node["score"] is None:
                node["score"] = DATA_INSUFFICIENT
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(sanitized)
    return sanitized


def coverage_caps_signal(coverage: float, raw_signal: str, raw_confidence: float) -> tuple[str, float]:
    """Data coverage가 낮으면 verdict를 보류시킨다."""
    if coverage < 0.4:
        return "neutral", min(raw_confidence, 40.0)
    if coverage < 0.6:
        return raw_signal, min(raw_confidence, 60.0)
    return raw_signal, raw_confidence
