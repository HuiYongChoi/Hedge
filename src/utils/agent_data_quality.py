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


# Valuation-confidence guardrail. A single-estimate intrinsic value is treated as
# low-confidence when it diverges sharply from the market — deeply below (a
# trough/over-conservative model) or far above (aggressive growth/beta
# assumptions). This mirrors the multi-model outlier exclusion in valuation.py,
# but here the reference is the market price because each persona analyst has
# only one estimate, not a peer panel.
VALUATION_LOW_CONF_FLOOR = -0.50   # intrinsic <= 50% below market cap
VALUATION_LOW_CONF_CEILING = 1.0   # intrinsic >= 2x market cap
VALUATION_LOW_CONF_CAP = 50.0      # confidence ceiling when valuation is low-confidence


def valuation_confidence_flag(margin_of_safety: Optional[float]) -> tuple[str, Optional[str]]:
    """Flag a single-estimate valuation as low-confidence when it diverges sharply
    from the market. Returns ("low"|"normal", korean_note_or_None). The note is
    meant to be injected into the LLM prompt so the narrative hedges."""
    if margin_of_safety is None:
        return "normal", None
    if margin_of_safety <= VALUATION_LOW_CONF_FLOOR or margin_of_safety >= VALUATION_LOW_CONF_CEILING:
        note = (
            f"내재가치가 현재 시가총액 대비 {margin_of_safety:+.0%}로 크게 괴리되어 "
            "이 가치평가의 신뢰도가 낮습니다. 수치를 단정적 목표가로 제시하지 말고, "
            "불확실성을 본문에서 명시하며 질적·상대가치 근거에 더 무게를 두고 "
            "confidence도 낮추세요."
        )
        return "low", note
    return "normal", None


def low_confidence_caps_signal(
    valuation_confidence: str, raw_signal: str, raw_confidence: float
) -> tuple[str, float]:
    """When the valuation is low-confidence, cap conviction so no high-confidence
    verdict rests on an untrustworthy intrinsic value. Direction is preserved
    (an extreme divergence may still be a genuine over/under-valuation), but the
    confidence is capped — the analyst keeps its read while admitting low trust."""
    if valuation_confidence == "low":
        return raw_signal, min(raw_confidence, VALUATION_LOW_CONF_CAP)
    return raw_signal, raw_confidence
