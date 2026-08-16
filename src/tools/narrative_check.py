"""서사 일관성 점검 — 회사가 말하는 이야기가 실제 생애주기 단계와 맞는가.

Damodaran, *The Corporate Life Cycle* 의 경고를 검증 가능한 형태로 옮긴 것이다.
    "성숙한 기업이 성장 기업의 이야기를 하면, 그 이야기를 실현하려고
     가치를 파괴하는 투자를 한다."

중요한 설계 원칙 — **서사를 창작하지 않는다.**
회사가 공시(MD&A · 이사의 경영진단)와 실적 보도자료에서 **직접 쓴 문장**에서만
성장/축소 어휘를 세고, 그것을 재무로 판정된 단계와 대조한다.
LLM 이 "이 회사의 스토리는…" 하고 지어내는 것과는 정반대 방향이다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from src.tools.life_cycle import (
    STAGE_DECLINE,
    STAGE_HIGH_GROWTH,
    STAGE_LABELS_KO,
    STAGE_MATURE_GROWTH,
    STAGE_MATURE_STABLE,
    STAGE_STARTUP,
    STAGE_YOUNG,
)

#: 회사가 스스로 쓰는 '성장 서사' 어휘. 한국어 공시와 영어 공시를 함께 본다.
_GROWTH_TERMS = (
    r"growth", r"expand\w*", r"accelerat\w*", r"scal(?:e|ing)", r"record\b",
    r"invest\w* in", r"new market", r"opportunit\w*", r"ramp\w*", r"demand",
    r"성장", r"확대", r"확장", r"가속", r"신규\s*시장", r"신사업", r"증설", r"수요\s*증가",
)
#: '성숙·수익성 방어' 어휘
_MATURE_TERMS = (
    r"efficien\w*", r"margin\s+improv\w*", r"cost\s+(?:reduction|discipline|control)",
    r"return\w*\s+(?:of|to)\s+(?:capital|shareholders)", r"dividend", r"buyback",
    r"share\s+repurchase", r"optimi[sz]\w*",
    r"효율", r"수익성\s*개선", r"원가\s*(?:절감|관리)", r"주주\s*환원", r"배당", r"자사주",
)
#: '축소·구조조정' 어휘
_SHRINK_TERMS = (
    r"restructur\w*", r"divest\w*", r"impairment", r"discontinu\w*", r"wind[- ]down",
    r"headcount reduction", r"closure",
    r"구조조정", r"매각", r"손상", r"중단", r"철수", r"감축",
)

_GROWTH_RE = re.compile("|".join(_GROWTH_TERMS), re.I)
_MATURE_RE = re.compile("|".join(_MATURE_TERMS), re.I)
_SHRINK_RE = re.compile("|".join(_SHRINK_TERMS), re.I)

#: 어휘를 세려면 표본이 있어야 한다. 너무 짧으면 판정하지 않는다.
_MIN_TEXT_CHARS = 400

_GROWTH_STAGES = (STAGE_STARTUP, STAGE_YOUNG, STAGE_HIGH_GROWTH)
_LATE_STAGES = (STAGE_MATURE_STABLE, STAGE_DECLINE)


@dataclass
class NarrativeCheck:
    """회사 서사 어조와 단계의 정합성."""

    tone: Optional[str] = None            # "growth" | "mature" | "shrink" | None
    growth_hits: int = 0
    mature_hits: int = 0
    shrink_hits: int = 0
    sample_chars: int = 0
    aligned: Optional[bool] = None        # None = 판단 보류
    verdict_ko: str = ""
    notes_ko: list[str] = field(default_factory=list)
    evidence_ko: list[str] = field(default_factory=list)
    insufficient: bool = False

    def to_dict(self) -> dict:
        return {
            "tone": self.tone,
            "growth_hits": self.growth_hits,
            "mature_hits": self.mature_hits,
            "shrink_hits": self.shrink_hits,
            "sample_chars": self.sample_chars,
            "aligned": self.aligned,
            "verdict_ko": self.verdict_ko,
            "notes_ko": self.notes_ko,
            "evidence_ko": self.evidence_ko,
            "insufficient": self.insufficient,
        }


def _sample_sentences(text: str, pattern: re.Pattern, limit: int = 2) -> list[str]:
    """어휘가 실제로 등장한 문장을 근거로 남긴다(회사가 쓴 문장 그대로)."""
    found: list[str] = []
    for match in pattern.finditer(text):
        start = max(0, text.rfind(".", 0, match.start()) + 1)
        end = text.find(".", match.end())
        end = end + 1 if end != -1 else min(len(text), match.end() + 160)
        sentence = re.sub(r"\s+", " ", text[start:end]).strip()
        if 30 <= len(sentence) <= 320 and sentence not in found:
            found.append(sentence)
        if len(found) >= limit:
            break
    return found


def check(stage: str, company_text: str) -> NarrativeCheck:
    """단계와 회사 서사의 정합성을 판정한다.

    company_text 는 반드시 **회사가 직접 쓴 문장**이어야 한다
    (MD&A / 이사의 경영진단 / 실적 보도자료). 요약본이나 뉴스는 넣지 않는다.
    """
    text = (company_text or "").strip()
    result = NarrativeCheck(sample_chars=len(text))

    if len(text) < _MIN_TEXT_CHARS:
        result.insufficient = True
        result.verdict_ko = "회사 서술 원문이 부족해 서사 일관성을 판정하지 못했다."
        return result

    result.growth_hits = len(_GROWTH_RE.findall(text))
    result.mature_hits = len(_MATURE_RE.findall(text))
    result.shrink_hits = len(_SHRINK_RE.findall(text))
    total = result.growth_hits + result.mature_hits + result.shrink_hits
    if total < 3:
        result.insufficient = True
        result.verdict_ko = "서사 어휘가 거의 없어 어조를 판정하지 못했다."
        return result

    # 가장 많이 쓰인 어조를 회사의 서사로 본다.
    counts = {
        "growth": result.growth_hits,
        "mature": result.mature_hits,
        "shrink": result.shrink_hits,
    }
    result.tone = max(counts, key=lambda key: counts[key])
    stage_label = STAGE_LABELS_KO.get(stage, stage)

    # ── 정합성 판정 ──────────────────────────────────────────────────────────
    if result.tone == "growth" and stage in _LATE_STAGES:
        result.aligned = False
        result.verdict_ko = (
            f"괴리 — 재무는 {stage_label}인데 회사 서술은 성장 어휘가 우세하다."
        )
        result.notes_ko.append(
            "성숙·쇠퇴 국면에서 성장 서사를 유지하면 그 이야기를 실현하려 "
            "과잉 투자·무리한 인수로 이어지기 쉽다(Damodaran)."
        )
        result.notes_ko.append(
            "재투자 강도와 인수 계획이 실제로 커지고 있는지 확인할 필요가 있다."
        )
        result.evidence_ko = _sample_sentences(text, _GROWTH_RE)
    elif result.tone == "mature" and stage in _GROWTH_STAGES:
        result.aligned = False
        result.verdict_ko = (
            f"괴리 — 재무는 {stage_label}인데 회사 서술은 효율·환원 어휘가 우세하다."
        )
        result.notes_ko.append(
            "성장 단계에서 조기에 환원·효율로 무게가 옮겨가면 성장 여력을 스스로 "
            "줄이는 것일 수 있다. 성장 기회가 실제로 소진됐는지 확인이 필요하다."
        )
        result.evidence_ko = _sample_sentences(text, _MATURE_RE)
    elif result.tone == "shrink" and stage in _GROWTH_STAGES:
        result.aligned = False
        result.verdict_ko = (
            f"괴리 — 재무는 {stage_label}인데 회사 서술에 축소·구조조정 어휘가 우세하다."
        )
        result.notes_ko.append("성장 지표와 회사의 축소 서술이 엇갈린다. 어느 쪽이 선행지표인지 확인이 필요하다.")
        result.evidence_ko = _sample_sentences(text, _SHRINK_RE)
    else:
        result.aligned = True
        tone_ko = {"growth": "성장", "mature": "효율·환원", "shrink": "축소"}[result.tone]
        result.verdict_ko = f"부합 — {stage_label}과 회사의 {tone_ko} 서술이 같은 방향이다."
        result.evidence_ko = _sample_sentences(
            text,
            {"growth": _GROWTH_RE, "mature": _MATURE_RE, "shrink": _SHRINK_RE}[result.tone],
            limit=1,
        )

    # 성숙 성장 단계는 성장·효율 서사가 모두 정상이라 경고하지 않는다.
    if stage == STAGE_MATURE_GROWTH and result.aligned is False:
        result.aligned = True
        result.verdict_ko = (
            f"부합 — {stage_label}은 성장과 효율 서사가 공존하는 게 정상이다."
        )
        result.notes_ko = []

    result.notes_ko.append(
        f"어휘 집계: 성장 {result.growth_hits} · 효율/환원 {result.mature_hits} · 축소 {result.shrink_hits} "
        f"(원문 {result.sample_chars:,}자 기준)"
    )
    return result
