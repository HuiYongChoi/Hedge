"""기업 생애주기 진단 (Aswath Damodaran, *The Corporate Life Cycle*, 2024).

책의 핵심 주장은 두 가지다.
 1. 기업은 생애주기 단계마다 성장률·마진·재투자·현금흐름의 '정상 범위'가 다르고,
    단계에 맞는 **가치평가 방법**도 다르다. 성숙기 기업에 성장주 배수를 쓰면 틀린다.
 2. 가치 파괴의 큰 원인은 **단계와 행동의 불일치**다. 성숙기 기업이 성장기처럼
    과잉 재투자하거나, 쇠퇴기 기업이 자본을 돌려주지 않고 버티는 것이 대표적이다.
    ("Act your age.")

이 모듈은 LLM 추측이 아니라 **재무 수치에서 결정론적으로** 단계를 판정하고,
단계가 요구하는 전략 대비 실제 행동의 정합성(전략 이행도)을 점수화한다.

입력은 aswath_damodaran 에이전트가 이미 받아오는 line_items(연간 8년)로 충분하다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

# ── 단계 정의 ────────────────────────────────────────────────────────────────
#: (키, 한국어 이름, 책의 단계 번호)
STAGE_STARTUP = "startup"
STAGE_YOUNG = "young_growth"
STAGE_HIGH_GROWTH = "high_growth"
STAGE_MATURE_GROWTH = "mature_growth"
STAGE_MATURE_STABLE = "mature_stable"
STAGE_DECLINE = "decline"

STAGE_LABELS_KO = {
    STAGE_STARTUP: "1단계 · 스타트업(아이디어)",
    STAGE_YOUNG: "2단계 · 초기 성장",
    STAGE_HIGH_GROWTH: "3단계 · 고성장",
    STAGE_MATURE_GROWTH: "4단계 · 성숙 성장",
    STAGE_MATURE_STABLE: "5단계 · 성숙 안정",
    STAGE_DECLINE: "6단계 · 쇠퇴",
}

#: 단계별 처방 — 책의 표를 요약한 것. 화면과 프롬프트에 함께 쓴다.
STAGE_PLAYBOOK: dict[str, dict[str, Any]] = {
    STAGE_STARTUP: {
        "valuation_ko": "매출·시장규모(TAM) 기반 추정. 실패 확률을 명시적으로 반영해야 하며 DCF는 참고용.",
        "value_driver_ko": "숫자보다 서사(narrative). 시장 크기와 성공 확률이 가치의 대부분.",
        "strategy_ko": "제품-시장 적합성 검증과 생존 자금 확보. 이익보다 학습 속도.",
        "management_ko": "창업가·비전형. 불확실성 감내와 방향 전환 능력.",
        "key_risk_ko": "생존 실패. 자금 소진.",
    },
    STAGE_YOUNG: {
        "valuation_ko": "매출 배수(P/S)와 장기 마진 가정에 의존. 이익 배수는 의미 없음.",
        "value_driver_ko": "매출 성장 지속성과 단위경제(unit economics) 개선 여부.",
        "strategy_ko": "성장에 재투자. 점유율 확보 우선, 마진은 후순위.",
        "management_ko": "확장 실행가. 조직·시스템을 만들어내는 능력.",
        "key_risk_ko": "성장은 하는데 마진 경로가 안 보이는 것.",
    },
    STAGE_HIGH_GROWTH: {
        "valuation_ko": "선행 이익 배수 + 성장 조정. DCF는 성장 감속 가정이 핵심 변수.",
        "value_driver_ko": "성장률과 재투자 효율(ROIC)의 조합. 성장의 '질'이 중요해짐.",
        "strategy_ko": "성장 지속을 위한 대규모 재투자. 해자 구축.",
        "management_ko": "규모화 경영. 성장과 수익성의 균형 조율.",
        "key_risk_ko": "성장 둔화가 배수 급락으로 직결(디레이팅).",
    },
    STAGE_MATURE_GROWTH: {
        "valuation_ko": "이익·EBITDA 배수가 유효해짐. DCF 신뢰도 상승.",
        "value_driver_ko": "마진 방어와 초과수익(ROIC−WACC) 지속 기간.",
        "strategy_ko": "핵심사업 수익성 강화 + 선별적 재투자. 잉여현금 환원 시작.",
        "management_ko": "운영 효율형. 자본배분 규율이 실력의 기준이 됨.",
        "key_risk_ko": "성장 유지를 위한 무리한 인수합병.",
    },
    STAGE_MATURE_STABLE: {
        "valuation_ko": "안정적 이익 배수·배당할인모형이 잘 맞음. 자산가치도 참고 가능.",
        "value_driver_ko": "현금흐름의 안정성과 주주환원 규모.",
        "strategy_ko": "유지 수준 재투자 + 적극적 자본환원(배당·자사주).",
        "management_ko": "자본 배분가. 재투자보다 환원이 옳은 국면을 인정할 수 있는가.",
        "key_risk_ko": "성숙을 인정하지 않고 성장주 흉내(과잉투자·과잉인수).",
    },
    STAGE_DECLINE: {
        "valuation_ko": "장부가·청산가치 비중 상승. 이익 배수는 왜곡되기 쉬움.",
        "value_driver_ko": "남은 현금흐름의 크기와 자산 회수 가치.",
        "strategy_ko": "축소 균형. 비핵심 자산 매각과 최대한의 자본 환원.",
        "management_ko": "축소 관리자. 가장 드문 유형 — 대부분 축소를 거부한다.",
        "key_risk_ko": "쇠퇴 부정. 재투자로 가치를 계속 태우는 것.",
    },
}


def _f(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if num == num and num not in (float("inf"), float("-inf")) else None


def _series(line_items: list, field_name: str) -> list[float]:
    """오래된 → 최신 순으로 정렬된 유효 수치 시계열."""
    values = []
    for item in reversed(line_items or []):
        value = _f(getattr(item, field_name, None))
        if value is not None:
            values.append(value)
    return values


def _cagr(values: list[float]) -> Optional[float]:
    if len(values) < 2 or values[0] <= 0:
        return None
    periods = len(values) - 1
    try:
        return (values[-1] / values[0]) ** (1 / periods) - 1
    except (ZeroDivisionError, ValueError):
        return None


#: 전략 이행도에서 점검하는 항목 수(재투자 강도·지분 환원·현금흐름).
#: 데이터 결측으로 일부만 점검됐는데 만점이 나오면 '검증 완료'로 오해된다.
_ALIGNMENT_TOTAL_CHECKS = 3


@dataclass
class LifeCycleDiagnosis:
    stage: str
    stage_label_ko: str
    confidence: float                       # 0~1 — 판정 근거가 몇 개나 일치했는지
    signals: dict[str, Optional[float]] = field(default_factory=dict)
    evidence_ko: list[str] = field(default_factory=list)
    playbook: dict[str, Any] = field(default_factory=dict)
    #: 단계가 요구하는 행동 대비 실제 행동의 정합성
    alignment_score: Optional[float] = None       # 0~100
    alignment_notes_ko: list[str] = field(default_factory=list)
    #: 전략 이행도에서 실제로 점검한 항목 수 / 전체
    alignment_checked: int = 0
    alignment_total_checks: int = _ALIGNMENT_TOTAL_CHECKS
    insufficient: bool = False

    def to_dict(self) -> dict:
        return {
            "stage": self.stage,
            "stage_label_ko": self.stage_label_ko,
            "confidence": self.confidence,
            "signals": self.signals,
            "evidence_ko": self.evidence_ko,
            "playbook": self.playbook,
            "alignment_score": self.alignment_score,
            "alignment_notes_ko": self.alignment_notes_ko,
            "alignment_checked": self.alignment_checked,
            "alignment_total_checks": self.alignment_total_checks,
            "insufficient": self.insufficient,
        }


def compute_signals(line_items: list, metrics: list | None = None) -> dict[str, Optional[float]]:
    """단계 판정에 쓰는 원시 신호들을 계산한다."""
    revenue = _series(line_items, "revenue")
    op_income = _series(line_items, "operating_income") or _series(line_items, "ebit")
    fcf = _series(line_items, "free_cash_flow")
    capex = [abs(v) for v in _series(line_items, "capital_expenditure")]
    dep = _series(line_items, "depreciation_and_amortization")
    shares = _series(line_items, "outstanding_shares")

    signals: dict[str, Optional[float]] = {
        "revenue_cagr": _cagr(revenue),
        "revenue_growth_latest": None,
        "revenue_growth_delta": None,     # 성장 가속/감속
        "operating_margin": None,
        "margin_trend": None,
        "reinvestment_ratio": None,       # capex / 감가상각 — 1보다 크면 확장 투자
        "fcf_margin": None,
        "fcf_positive_years": None,
        "share_count_change": None,       # 음수면 자사주 소각(환원)
    }

    if len(revenue) >= 2 and revenue[-2] > 0:
        signals["revenue_growth_latest"] = revenue[-1] / revenue[-2] - 1
    if len(revenue) >= 3 and revenue[-3] > 0 and revenue[-2] > 0:
        prev = revenue[-2] / revenue[-3] - 1
        latest = revenue[-1] / revenue[-2] - 1
        signals["revenue_growth_delta"] = latest - prev

    if op_income and revenue and revenue[-1] > 0:
        signals["operating_margin"] = op_income[-1] / revenue[-1]
    if len(op_income) >= 3 and len(revenue) >= 3:
        try:
            recent = op_income[-1] / revenue[-1]
            older = op_income[-3] / revenue[-3]
            signals["margin_trend"] = recent - older
        except ZeroDivisionError:
            pass

    if capex and dep and dep[-1] > 0:
        signals["reinvestment_ratio"] = capex[-1] / dep[-1]

    if fcf and revenue and revenue[-1] > 0:
        signals["fcf_margin"] = fcf[-1] / revenue[-1]
    if fcf:
        signals["fcf_positive_years"] = sum(1 for v in fcf if v > 0) / len(fcf)

    if len(shares) >= 2 and shares[0] > 0:
        signals["share_count_change"] = shares[-1] / shares[0] - 1

    return signals


def _allowed_stages(cagr: Optional[float]) -> Optional[set[str]]:
    """매출 궤적으로 가능한 단계를 먼저 좁힌다.

    Damodaran 프레임워크에서 매출 성장은 1차 축이다. 마진·투자 신호와 동등하게
    투표시키면 '역성장인데 초기 성장'처럼 모순된 판정이 나온다(실측 확인).
    """
    if cagr is None:
        return None
    if cagr < -0.02:
        return {STAGE_DECLINE, STAGE_MATURE_STABLE}
    if cagr < 0.03:
        return {STAGE_MATURE_STABLE, STAGE_DECLINE, STAGE_MATURE_GROWTH}
    if cagr < 0.06:
        return {STAGE_MATURE_STABLE, STAGE_MATURE_GROWTH}
    if cagr < 0.15:
        return {STAGE_MATURE_GROWTH, STAGE_HIGH_GROWTH, STAGE_MATURE_STABLE}
    if cagr < 0.35:
        return {STAGE_HIGH_GROWTH, STAGE_MATURE_GROWTH, STAGE_YOUNG}
    return {STAGE_YOUNG, STAGE_HIGH_GROWTH, STAGE_STARTUP}


def classify_stage(signals: dict[str, Optional[float]]) -> tuple[str, float, list[str]]:
    """신호를 단계로 매핑한다. 각 단계에 투표하고 최다 득표를 고른다."""
    votes: dict[str, int] = {key: 0 for key in STAGE_LABELS_KO}
    evidence: list[str] = []

    cagr = signals.get("revenue_cagr")
    margin = signals.get("operating_margin")
    margin_trend = signals.get("margin_trend")
    reinvest = signals.get("reinvestment_ratio")
    fcf_margin = signals.get("fcf_margin")
    fcf_pos = signals.get("fcf_positive_years")
    buyback = signals.get("share_count_change")

    if cagr is not None:
        if cagr >= 0.35:
            votes[STAGE_YOUNG] += 2; votes[STAGE_HIGH_GROWTH] += 1
            evidence.append(f"매출 CAGR {cagr:.1%} — 초기·고성장 구간")
        elif cagr >= 0.15:
            votes[STAGE_HIGH_GROWTH] += 2
            evidence.append(f"매출 CAGR {cagr:.1%} — 고성장 구간")
        elif cagr >= 0.06:
            votes[STAGE_MATURE_GROWTH] += 2
            evidence.append(f"매출 CAGR {cagr:.1%} — 성숙 성장 구간")
        elif cagr >= 0.0:
            votes[STAGE_MATURE_STABLE] += 2
            evidence.append(f"매출 CAGR {cagr:.1%} — 성숙 안정 구간")
        else:
            votes[STAGE_DECLINE] += 2
            evidence.append(f"매출 CAGR {cagr:.1%} — 역성장, 쇠퇴 신호")

    if margin is not None:
        if margin < 0:
            votes[STAGE_STARTUP] += 1; votes[STAGE_YOUNG] += 2
            evidence.append(f"영업이익률 {margin:.1%} — 아직 적자")
        elif margin < 0.05:
            votes[STAGE_YOUNG] += 1; votes[STAGE_HIGH_GROWTH] += 1
            evidence.append(f"영업이익률 {margin:.1%} — 수익성 초기 단계")
        else:
            votes[STAGE_MATURE_GROWTH] += 1; votes[STAGE_MATURE_STABLE] += 1
            evidence.append(f"영업이익률 {margin:.1%} — 안정적 수익 구조")

    if margin_trend is not None:
        if margin_trend > 0.02:
            votes[STAGE_HIGH_GROWTH] += 1; votes[STAGE_MATURE_GROWTH] += 1
            evidence.append(f"영업이익률 개선 {margin_trend:+.1%}p — 마진 확장 국면")
        elif margin_trend < -0.02:
            votes[STAGE_DECLINE] += 1; votes[STAGE_MATURE_STABLE] += 1
            evidence.append(f"영업이익률 악화 {margin_trend:+.1%}p — 마진 압박")

    if reinvest is not None:
        if reinvest >= 1.5:
            votes[STAGE_HIGH_GROWTH] += 1; votes[STAGE_YOUNG] += 1
            evidence.append(f"설비투자/감가상각 {reinvest:.1f}배 — 확장 투자 국면")
        elif reinvest <= 0.8:
            votes[STAGE_MATURE_STABLE] += 1; votes[STAGE_DECLINE] += 1
            evidence.append(f"설비투자/감가상각 {reinvest:.1f}배 — 유지 이하 투자")

    if fcf_margin is not None and fcf_pos is not None:
        if fcf_margin < 0 or fcf_pos < 0.5:
            votes[STAGE_YOUNG] += 1; votes[STAGE_HIGH_GROWTH] += 1
            evidence.append("잉여현금흐름이 불안정 — 성장 투자 단계 특성")
        elif fcf_margin > 0.10:
            votes[STAGE_MATURE_GROWTH] += 1; votes[STAGE_MATURE_STABLE] += 1
            evidence.append(f"FCF 마진 {fcf_margin:.1%} — 현금 창출 성숙 단계")

    if buyback is not None and buyback < -0.02:
        votes[STAGE_MATURE_STABLE] += 1; votes[STAGE_DECLINE] += 1
        evidence.append(f"주식수 {buyback:.1%} 감소 — 자사주 소각(자본 환원) 진행")

    # 매출 궤적과 모순되는 단계는 후보에서 제외한다(마진·투자 신호가 뒤집지 못하게).
    allowed = _allowed_stages(cagr)
    if allowed:
        for key in list(votes):
            if key not in allowed:
                votes[key] = 0

    total = sum(votes.values())
    if total == 0:
        # 게이트만 남고 세부 신호가 없으면 게이트의 대표 단계를 쓴다.
        if allowed:
            fallback = sorted(allowed, key=lambda k: list(STAGE_LABELS_KO).index(k))[0]
            return fallback, 0.3, evidence or ["매출 궤적만으로 단계를 추정"]
        return STAGE_MATURE_GROWTH, 0.0, ["단계 판정에 필요한 재무 시계열이 부족"]

    stage = max(votes, key=lambda key: votes[key])
    confidence = round(votes[stage] / total, 2)
    return stage, confidence, evidence


def assess_alignment(
    stage: str, signals: dict[str, Optional[float]]
) -> tuple[Optional[float], list[str], int]:
    """단계가 요구하는 행동 대비 실제 행동의 정합성(0~100).

    Damodaran 의 핵심 주장 — 가치 파괴는 대개 '나이에 맞지 않는 행동'에서 온다.
    """
    reinvest = signals.get("reinvestment_ratio")
    buyback = signals.get("share_count_change")
    fcf_margin = signals.get("fcf_margin")
    notes: list[str] = []
    score = 100.0
    checked = 0

    growth_stages = (STAGE_STARTUP, STAGE_YOUNG, STAGE_HIGH_GROWTH)
    late_stages = (STAGE_MATURE_STABLE, STAGE_DECLINE)

    if reinvest is not None:
        checked += 1
        if stage in late_stages and reinvest >= 1.5:
            score -= 35
            notes.append(
                f"성숙·쇠퇴 단계인데 설비투자가 감가상각의 {reinvest:.1f}배 — "
                "단계에 비해 과잉 재투자로 볼 여지가 있다(자본배분 미스매치)."
            )
        elif stage in growth_stages and reinvest < 1.0:
            score -= 25
            notes.append(
                f"성장 단계인데 설비투자가 감가상각의 {reinvest:.1f}배에 그쳐 — "
                "성장 지속에 필요한 재투자가 부족할 수 있다."
            )
        else:
            notes.append(f"재투자 강도(설비투자/감가상각 {reinvest:.1f}배)는 단계와 부합한다.")

    if buyback is not None:
        checked += 1
        if stage in late_stages and buyback > 0.02:
            score -= 25
            notes.append(
                f"성숙·쇠퇴 단계인데 주식수가 {buyback:.1%} 증가 — "
                "자본 환원 대신 희석이 진행됐다."
            )
        elif stage in late_stages and buyback < -0.02:
            notes.append(f"주식수 {buyback:.1%} 감소 — 단계에 맞는 자본 환원이 이뤄지고 있다.")
        elif stage in growth_stages and buyback < -0.05:
            score -= 15
            notes.append(
                f"성장 단계인데 주식수를 {buyback:.1%} 줄였다 — "
                "성장 투자보다 환원을 앞세운 것은 이르다고 볼 여지가 있다."
            )

    if fcf_margin is not None:
        checked += 1
        if stage in late_stages and fcf_margin < 0:
            score -= 25
            notes.append("성숙·쇠퇴 단계인데 잉여현금흐름이 음수 — 현금 소진이 이어지고 있다.")
        elif stage in growth_stages and fcf_margin < 0:
            notes.append("성장 단계의 음(-)의 잉여현금흐름은 정상 범위로 볼 수 있다.")

    if checked == 0:
        return None, ["전략 이행도 판정에 필요한 투자·환원 데이터가 부족"], 0
    # 점검하지 못한 항목이 있으면 명시한다. 데이터가 없어 감점 요인을 찾지 못한 것을
    # '완벽히 부합'으로 읽으면 안 된다(실측: 삼성전자는 감가상각 결측으로 재투자 강도를
    # 확인조차 못 했는데 100점이 나왔다).
    if checked < _ALIGNMENT_TOTAL_CHECKS:
        notes.append(
            f"※ 전략 이행도는 {_ALIGNMENT_TOTAL_CHECKS}개 항목 중 {checked}개만 확인했다 "
            "— 나머지는 데이터가 없어 점검하지 못했으므로 '이상 없음'으로 단정할 수 없다."
        )
    return max(0.0, min(100.0, score)), notes, checked


def diagnose(line_items: list, metrics: list | None = None) -> LifeCycleDiagnosis:
    """생애주기 진단 전체를 수행한다."""
    signals = compute_signals(line_items, metrics)
    known = sum(1 for value in signals.values() if value is not None)
    if known < 2:
        return LifeCycleDiagnosis(
            stage=STAGE_MATURE_GROWTH,
            stage_label_ko=STAGE_LABELS_KO[STAGE_MATURE_GROWTH],
            confidence=0.0,
            signals=signals,
            evidence_ko=["재무 시계열이 부족해 생애주기 단계를 판정하지 못했다."],
            playbook={},
            insufficient=True,
        )

    stage, confidence, evidence = classify_stage(signals)
    alignment, notes, checked = assess_alignment(stage, signals)
    return LifeCycleDiagnosis(
        stage=stage,
        stage_label_ko=STAGE_LABELS_KO[stage],
        confidence=confidence,
        signals=signals,
        evidence_ko=evidence,
        playbook=STAGE_PLAYBOOK.get(stage, {}),
        alignment_score=alignment,
        alignment_notes_ko=notes,
        alignment_checked=checked,
    )
