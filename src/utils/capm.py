"""CAPM 입력을 한 곳에서 정한다.

왜 모으는가
    무위험이자율이 두 엔진에 따로 박혀 있었다.

        aswath_damodaran.estimate_cost_of_equity   risk_free 0.04  / ERP 0.05
        valuation.compute_cost_of_equity           risk_free 0.045 / ERP 0.06

    두 엔진의 적정가는 같은 리포트에 나란히 표시된다. 한쪽에만 실시간 금리를 넣으면
    같은 화면에 서로 다른 금리로 계산된 두 적정가가 뜬다. 그래서 '금리를 어디서
    가져오는가'만 여기로 모은다.

무엇을 모으고 무엇을 안 모으는가
    · 무위험이자율 — 모은다. 시장에 하나뿐인 관측값이므로 엔진마다 다를 이유가 없다.
    · ERP — 모으지 않는다. 이건 관측값이 아니라 모형 가정이고, 엔진마다 다르게
      잡는 것이 정상이다. 억지로 합치면 기존 밸류에이션이 조용히 바뀐다.

기본값을 왜 엔진별로 받는가
    매크로가 없을 때는 각 엔진이 쓰던 값을 그대로 써야 한다. 여기서 하나로
    통일해 버리면 매크로 연동과 무관하게 기존 결과가 달라진다.
"""

from __future__ import annotations

from typing import Any, Optional

#: 매크로를 못 받았을 때 각 엔진이 쓰던 값(동작 보존용).
DAMODARAN_RISK_FREE = 0.04
DAMODARAN_ERP = 0.05
VALUATION_RISK_FREE = 0.045
VALUATION_ERP = 0.06

#: 실시간 금리라도 이 범위를 벗어나면 받아쓰지 않는다.
#: 공급 측 단위 실수(4.72 vs 0.0472)나 이상치가 그대로 할인율이 되면
#: 적정가가 통째로 무너진다.
MIN_PLAUSIBLE_RISK_FREE = 0.005      # 0.5%
MAX_PLAUSIBLE_RISK_FREE = 0.15       # 15%


def resolve_risk_free_rate(macro: Optional[dict], default: float) -> tuple[float, Optional[str]]:
    """(사용할 무위험이자율, 출처 설명). 매크로가 없거나 이상하면 기본값.

    반환에 출처를 함께 담는 이유: 저장된 분석을 나중에 열었을 때
    "이건 금리 몇 %로 계산한 건가"를 되짚을 수 있어야 한다.
    """
    if not isinstance(macro, dict):
        return default, None

    inputs = macro.get("discountInputs")
    if not isinstance(inputs, dict):
        return default, None

    raw = inputs.get("riskFreeRate")
    if not isinstance(raw, (int, float)):
        return default, None

    # 공급 계약은 퍼센트(4.72). 소수(0.0472)로 와도 받아들인다.
    rate = float(raw) / 100 if float(raw) > 1 else float(raw)
    if not (MIN_PLAUSIBLE_RISK_FREE <= rate <= MAX_PLAUSIBLE_RISK_FREE):
        return default, None

    as_of = macro.get("asOf") or "시점 미상"
    return rate, f"미국채 10년 {rate:.2%} ({as_of} 기준)"


def cost_of_equity(beta: Optional[float], risk_free: float, erp: float) -> float:
    """CAPM: r_e = r_f + β × ERP.

    ERP 자리에 '이익수익률 − 국채금리'(Fed 모델 스프레드)를 넣으면 안 된다.
    그 값은 음수가 될 수 있고, 그러면 할인율이 영구성장률 아래로 내려가
    고든 성장식의 분모가 0에 근접해 적정가가 수십 배로 폭증한다
    (실측: β 1.55 에서 758조 → 68,443조).
    """
    if erp <= 0:
        raise ValueError(
            "ERP 는 양수여야 한다. 이익수익률 갭(equityBondGap)은 ERP 가 아니다 — "
            "할인율 입력으로 쓰면 적정가가 붕괴한다."
        )
    return risk_free + (beta if beta is not None else 1.0) * erp


def macro_from_state(state: Any) -> Optional[dict]:
    """AgentState 에서 매크로 페이로드를 꺼낸다. 없으면 None."""
    try:
        data = state["data"] if isinstance(state, dict) else getattr(state, "data", None)
        macro = (data or {}).get("macro_regime")
        return macro if isinstance(macro, dict) else None
    except Exception:
        return None
