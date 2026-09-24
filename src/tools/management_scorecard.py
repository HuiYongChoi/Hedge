"""경영진 평가 — 자본배분 실적 기반 (Damodaran 관점).

Damodaran 은 경영진의 실력을 '말'이 아니라 **자본배분 결과**로 본다.
카리스마·비전 같은 정성 평가는 검증이 안 되므로, 여기서는 검증 가능한 다섯 축만 본다.

  1. 재투자 수익성  — 투자한 자본이 자본비용을 넘는 수익을 냈는가 (ROIC vs WACC)
  2. 증분 효율      — 최근 늘린 자본이 실제로 이익을 늘렸는가 (incremental ROIC)
  3. 지분 관리      — 주식수를 늘렸는가(희석) 줄였는가(환원)
  4. 재무 규율      — 부채가 이익 창출력 대비 감당 가능한 수준인가
  5. 현금 전환      — 회계이익이 실제 현금으로 들어오는가

값이 없으면 점수를 만들어내지 않고 '판단 보류'로 남긴다(없는 근거로 평가하지 않는다).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


def _f(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if num == num and num not in (float("inf"), float("-inf")) else None


def _series(line_items: list, field_name: str) -> list[float]:
    values = []
    for item in reversed(line_items or []):
        value = _f(getattr(item, field_name, None))
        if value is not None:
            values.append(value)
    return values


@dataclass
class ScoreAxis:
    key: str
    label_ko: str
    score: Optional[float]        # 0~100, None 이면 판단 보류
    detail_ko: str
    #: 그 숫자가 '그래서 무슨 뜻인지'. 숫자만 보여주면 독자가 해석을 떠안는다.
    meaning_ko: str = ""
    #: 점수의 눈금. 축마다 산식이 달라 "41.5점"만으로는 좋은지 나쁜지 알 수 없다.
    #: 몇 점이 본전인지를 밝혀야 점수가 정보가 된다.
    scale_ko: str = ""

    @property
    def full_ko(self) -> str:
        """점수 눈금 + 근거 수치 + 해석을 한 덩어리로.

        소비 측(LLM·화면)이 숫자만 떼어 인용하는 경로를 없앤다.
        """
        parts = [self.detail_ko]
        if self.scale_ko:
            parts.append(f"점수 눈금: {self.scale_ko}")
        if self.meaning_ko:
            parts.append(self.meaning_ko)
        return " — ".join(parts)


@dataclass
class ManagementAssessment:
    overall: Optional[float]
    grade_ko: str
    axes: list[ScoreAxis] = field(default_factory=list)
    strengths_ko: list[str] = field(default_factory=list)
    concerns_ko: list[str] = field(default_factory=list)
    insufficient: bool = False
    #: 화면이 할인율 옆에 나란히 놓을 수 있게 남기는 원값(세후 ROIC, 자본비용, 초과수익).
    #: 서술에서 정규식으로 긁으면 문구가 바뀔 때 값이 사라진다.
    metrics: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "overall": self.overall,
            "grade_ko": self.grade_ko,
            "axes": [
                {"key": a.key, "label_ko": a.label_ko, "score": a.score,
                 "detail_ko": a.full_ko, "meaning_ko": a.meaning_ko,
                 "scale_ko": a.scale_ko}
                for a in self.axes
            ],
            "strengths_ko": self.strengths_ko,
            "concerns_ko": self.concerns_ko,
            "insufficient": self.insufficient,
            "metrics": self.metrics,
        }


def _grade(score: Optional[float]) -> str:
    if score is None:
        return "판단 보류"
    if score >= 80:
        return "우수"
    if score >= 65:
        return "양호"
    if score >= 45:
        return "보통"
    if score >= 30:
        return "미흡"
    return "취약"


#: 초기 단계 기업을 ROIC·증분효율·차입배수로 재단하면 안 된다. 적자가 정상인 국면에
#: 성숙기 잣대를 들이대는 것은 Damodaran 이 지적한 대표적 오류다("나이에 안 맞는 평가").
_EARLY_STAGES = ("startup", "young_growth")
_MATURITY_ONLY_AXES = {"roic_spread", "incremental_roic", "leverage"}


def assess(
    line_items: list,
    metrics: list | None = None,
    wacc: Optional[float] = None,
    stage: Optional[str] = None,
) -> ManagementAssessment:
    """자본배분 실적으로 경영진을 평가한다.

    stage 를 넘기면 그 단계에 맞지 않는 잣대는 종합 점수에서 빼고 '참고'로만 남긴다.
    """
    is_early = bool(stage) and stage in _EARLY_STAGES
    revenue = _series(line_items, "revenue")
    op_income = _series(line_items, "operating_income") or _series(line_items, "ebit")
    net_income = _series(line_items, "net_income")
    fcf = _series(line_items, "free_cash_flow")
    equity = _series(line_items, "shareholders_equity")
    debt = _series(line_items, "total_debt")
    shares = _series(line_items, "outstanding_shares")

    axes: list[ScoreAxis] = []
    strengths: list[str] = []
    concerns: list[str] = []

    metrics_out: dict = {}

    # ── 1. 재투자 수익성 (ROIC vs WACC) ──────────────────────────────────────
    roic = None
    if op_income and equity and debt:
        invested = equity[-1] + debt[-1]
        if invested > 0:
            roic = op_income[-1] * 0.75 / invested  # 세후 근사(실효세율 25% 가정)
    if roic is not None:
        hurdle = wacc if wacc and wacc > 0 else 0.09
        spread = roic - hurdle
        score = max(0.0, min(100.0, 50 + spread * 500))
        detail = f"세후 ROIC 약 {roic:.1%} vs 자본비용 {hurdle:.1%} (초과수익 {spread:+.1%}p)"
        if spread > 0.03:
            meaning = (f"돈을 굴려 번 수익률({roic:.1%})이 그 돈을 끌어오는 값({hurdle:.1%})을 "
                       f"{spread:.1%}p 웃돕니다. 사업에 재투자할수록 주주 몫이 늘어나는 구간이라, "
                       "성장 투자를 늘리는 편이 유리합니다.")
        elif spread > 0:
            meaning = (f"번 수익률이 조달 비용을 겨우 {spread:.1%}p 넘습니다. 재투자를 해도 "
                       "가치가 크게 늘지는 않는 본전 언저리 구간입니다.")
        else:
            meaning = (f"그 돈을 끌어오는 값({hurdle:.1%})보다 그 돈으로 번 수익률({roic:.1%})이 "
                       f"{abs(spread):.1%}p 낮습니다. 지금 조건이 이어지면 재투자를 늘릴수록 "
                       "주주 가치가 깎입니다 — 배당·자사주로 돌려주는 편이 나은 국면입니다.")
        axes.append(ScoreAxis("roic_spread", "재투자 수익성", round(score, 1), detail, meaning,
            "0~100점. 50점이 수익률과 자본비용이 딱 맞는 본전 지점이고, 초과수익 1%p마다 5점씩 움직입니다."))
        # 화면이 할인율 옆에 나란히 놓을 수 있게 원값을 남긴다. 서술에서 정규식으로
        # 긁으면 문구가 바뀔 때 값이 사라진다.
        metrics_out["roic_after_tax"] = roic
        metrics_out["roic_hurdle"] = hurdle
        metrics_out["roic_spread"] = spread
        if spread > 0.03:
            strengths.append(f"투하자본이 자본비용을 {spread:.1%}p 웃도는 수익을 내고 있다.")
        elif spread < -0.01:
            concerns.append(f"투하자본 수익이 자본비용에 {abs(spread):.1%}p 미달 — 재투자가 가치를 깎고 있을 수 있다.")
    else:
        axes.append(ScoreAxis("roic_spread", "재투자 수익성", None, "투하자본 계산에 필요한 자본·부채 데이터 부족"))

    # ── 2. 증분 효율 (최근 늘린 자본이 이익을 늘렸는가) ──────────────────────
    if len(op_income) >= 3 and len(equity) >= 3 and len(debt) >= 3:
        d_ebit = (op_income[-1] - op_income[-3]) * 0.75
        base_capital = equity[-3] + debt[-3]
        d_capital = (equity[-1] + debt[-1]) - base_capital
        # 분모가 미미하면 증분 수익률이 폭주한다(실측: 자본 +20에 이익 -252 → -1260%).
        # 자본이 의미 있게(기존 대비 5% 이상) 늘어난 경우에만 산정한다.
        material = base_capital > 0 and d_capital > base_capital * 0.05
        if material:
            inc_roic = d_ebit / d_capital
            score = max(0.0, min(100.0, 50 + inc_roic * 400))
            detail = f"최근 2년 증분 투하자본 대비 증분 세후영업이익 {inc_roic:.1%}"
            if inc_roic < 0:
                meaning = ("최근 2년 사이 자본을 더 넣었는데 영업이익은 오히려 줄었습니다. "
                           "투자가 아직 성과로 돌아오지 않았거나 판단이 빗나갔다는 신호이므로, "
                           "무엇에 썼는지부터 확인해야 합니다.")
            elif inc_roic > 0.15:
                meaning = (f"최근 2년 새로 넣은 돈 100원이 매년 {inc_roic * 100:.0f}원을 벌어왔습니다. "
                           "최근 투자 판단이 잘 맞았다는 뜻입니다.")
            else:
                meaning = (f"새로 넣은 돈 100원이 매년 {inc_roic * 100:.0f}원을 벌어왔습니다. "
                           "자본비용 언저리라 최근 투자가 가치를 크게 더하지는 못했습니다.")
            axes.append(ScoreAxis("incremental_roic", "증분 자본 효율", round(score, 1), detail, meaning,
                "0~100점. 50점이 새로 넣은 돈의 수익 0%이고, 12.5% 이상이면 만점입니다."))
            if inc_roic < 0:
                concerns.append("자본을 더 넣었는데 영업이익은 오히려 줄었다 — 최근 투자 판단을 확인할 필요.")
            elif inc_roic > 0.15:
                strengths.append(f"추가 투입 자본이 {inc_roic:.1%}의 증분 수익을 냈다.")
        elif d_capital < 0:
            axes.append(ScoreAxis(
                "incremental_roic", "증분 자본 효율", None,
                "최근 투하자본이 순감소 — 증분 수익률 산정 대상 아님(자산 회수 국면)",
            ))
        else:
            axes.append(ScoreAxis(
                "incremental_roic", "증분 자본 효율", None,
                "투하자본 증가폭이 미미(기존 대비 5% 미만) — 증분 수익률이 과장돼 판단 보류",
            ))
    else:
        axes.append(ScoreAxis("incremental_roic", "증분 자본 효율", None, "3개 연도 이상 자본·이익 데이터 부족"))

    # ── 3. 지분 관리 (희석 vs 환원) ──────────────────────────────────────────
    if len(shares) >= 2 and shares[0] > 0:
        change = shares[-1] / shares[0] - 1
        # 소각(감소)이 주주가치 관점에서 우호적 — 단, 단계 적합성은 life_cycle 에서 따로 본다.
        # 초기 성장 단계의 증자는 정상적인 성장 자금조달이므로 완만하게 본다
        # (성숙기 기준으로 재단하면 '자금을 조달했다'는 이유로 취약 판정이 난다).
        if is_early:
            score = max(0.0, min(100.0, 70 - max(0.0, change - 0.20) * 200))
            detail = f"기간 중 주식수 {change:+.1%} (초기 성장 단계의 증자는 성장 자금조달로 해석)"
        else:
            score = max(0.0, min(100.0, 60 - change * 400))
            detail = f"기간 중 주식수 {change:+.1%}"
        if change < -0.02:
            meaning = (f"자사주를 사서 없앤 만큼 주식 수가 {abs(change):.1%} 줄었습니다. "
                       "같은 이익이라도 1주당 몫이 그만큼 커집니다.")
        elif change > 0.05:
            meaning = (f"주식 수가 {change:.1%} 늘었습니다. 회사가 같은 이익을 내도 "
                       "나눠 가질 사람이 늘어 기존 주주 몫은 그만큼 줄어듭니다(희석).")
        else:
            meaning = "주식 수가 거의 그대로입니다. 희석도 환원도 크지 않습니다."
        axes.append(ScoreAxis("share_discipline", "지분 관리", round(score, 1), detail, meaning,
            "0~100점. 60점이 주식수 변화 없음이고, 줄이면 오르고 늘리면 내려갑니다."))
        if change > 0.05 and not is_early:
            concerns.append(f"주식수가 {change:.1%} 늘어 기존 주주 지분이 희석됐다.")
        elif change > 0.35 and is_early:
            concerns.append(f"성장 단계를 감안해도 주식수가 {change:.1%} 늘어 희석 폭이 크다.")
        elif change < -0.02:
            strengths.append(f"자사주 소각 등으로 주식수를 {abs(change):.1%} 줄였다.")
    else:
        axes.append(ScoreAxis("share_discipline", "지분 관리", None, "주식수 시계열 부족"))

    # ── 4. 재무 규율 (부채 vs 이익 창출력) ───────────────────────────────────
    if debt and op_income and op_income[-1] > 0:
        leverage = debt[-1] / (op_income[-1] * 0.75)
        score = max(0.0, min(100.0, 100 - leverage * 12))
        detail = f"순영업이익 대비 총차입금 약 {leverage:.1f}배"
        if leverage > 5:
            meaning = (f"빚이 한 해 벌이의 {leverage:.1f}배입니다. 이익이 조금만 줄어도 "
                       "이자 부담이 빠르게 커지는 구조라, 불황에 특히 취약합니다.")
        elif leverage < 2:
            meaning = (f"빚이 한 해 벌이의 {leverage:.1f}배에 그칩니다. 이익이 흔들려도 "
                       "갚는 데 무리가 없고, 필요하면 더 빌려 투자할 여력도 있습니다.")
        else:
            meaning = (f"빚이 한 해 벌이의 {leverage:.1f}배입니다. 감당 가능한 수준이지만 "
                       "이익이 크게 줄면 부담이 눈에 띄게 커집니다.")
        axes.append(ScoreAxis("leverage", "재무 규율", round(score, 1), detail, meaning,
            "0~100점. 무차입이 100점, 한 해 벌이의 8배를 넘게 빌리면 0점입니다."))
        if leverage > 5:
            concerns.append(f"차입금이 세후영업이익의 {leverage:.1f}배 — 이익 변동 시 부담이 커진다.")
        elif leverage < 2:
            strengths.append(f"차입금이 세후영업이익의 {leverage:.1f}배로 부담이 낮다.")
    elif debt and op_income:
        axes.append(ScoreAxis("leverage", "재무 규율", None, "영업이익이 0 이하라 차입 배수 산정 불가"))
    else:
        axes.append(ScoreAxis("leverage", "재무 규율", None, "차입금·영업이익 데이터 부족"))

    # ── 5. 현금 전환 (회계이익 → 실제 현금) ──────────────────────────────────
    if fcf and net_income and net_income[-1] > 0:
        conversion = fcf[-1] / net_income[-1]
        score = max(0.0, min(100.0, conversion * 80))
        detail = f"잉여현금흐름 / 순이익 {conversion:.0%}"
        if conversion > 1.0:
            meaning = ("장부에 찍힌 이익보다 실제로 들어온 현금이 더 많습니다. "
                       "이익이 숫자놀음이 아니라 진짜 현금으로 확인된다는 뜻입니다.")
        elif conversion < 0.5:
            meaning = (f"장부 이익 중 {conversion:.0%}만 실제 현금으로 들어왔습니다. "
                       "나머지는 재고나 아직 못 받은 대금에 묶여 있을 수 있어, "
                       "이익의 질을 따로 확인해야 합니다.")
        else:
            meaning = (f"장부 이익의 {conversion:.0%}가 현금으로 들어왔습니다. "
                       "이익과 현금이 대체로 같이 움직이는 정상 범위입니다.")
        axes.append(ScoreAxis("cash_conversion", "현금 전환", round(score, 1), detail, meaning,
            "0~100점. 순이익의 125% 이상이 현금으로 들어오면 만점, 절반이면 40점입니다."))
        if conversion < 0.5:
            concerns.append(f"순이익 대비 현금 전환이 {conversion:.0%}에 그친다 — 이익의 질을 확인할 필요.")
        elif conversion > 1.0:
            strengths.append(f"순이익보다 많은 현금({conversion:.0%})을 실제로 창출했다.")
    else:
        axes.append(ScoreAxis("cash_conversion", "현금 전환", None, "순이익 또는 잉여현금흐름 데이터 부족"))

    # 초기 성장 단계에는 성숙기 잣대(ROIC·증분효율·차입배수)를 종합에서 제외한다.
    # 점수를 지우되 근거는 '참고'로 남겨 사용자가 수치 자체는 볼 수 있게 한다.
    if is_early:
        for axis in axes:
            if axis.key in _MATURITY_ONLY_AXES and axis.score is not None:
                axis.detail_ko = f"{axis.detail_ko} — 초기 성장 단계라 종합 점수에서 제외(참고)"
                axis.score = None
        concerns = [c for c in concerns if "자본비용" not in c and "차입금이" not in c]

    scored = [a.score for a in axes if a.score is not None]
    if not scored:
        return ManagementAssessment(
            overall=None,
            grade_ko="판단 보류",
            axes=axes,
            strengths_ko=strengths,
            concerns_ko=concerns,
            insufficient=True,
        )

    # 채점된 축이 1개뿐이면 단정하지 않는다 — 한 지표로 경영진을 등급 매기는 것은 과잉이다.
    if len(scored) < 2:
        return ManagementAssessment(
            overall=round(scored[0], 1),
            grade_ko="판단 보류 (근거 1개)",
            axes=axes,
            strengths_ko=strengths,
            concerns_ko=concerns,
            insufficient=True,
        )

    overall = round(sum(scored) / len(scored), 1)
    return ManagementAssessment(
        overall=overall,
        grade_ko=_grade(overall),
        axes=axes,
        strengths_ko=strengths,
        concerns_ko=concerns,
        metrics=metrics_out,
    )
