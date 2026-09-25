"""큰 금액을 한국어 단위로 읽어 준다.

972,992,820,105,704 원은 자릿점을 찍어도 안 읽힌다. '약 973조 원'이라야 크기가 잡힌다.
보고서 곳곳에서 같은 규칙을 써야 하므로 한 곳에 둔다.
"""

from __future__ import annotations

from typing import Optional

_JO = 1_000_000_000_000        # 조
_EOK = 100_000_000             # 억


# 금액 뒤에 붙일 한국어 통화 이름. 모르는 통화는 코드를 그대로 붙인다.
_CURRENCY_WORD_KO = {"KRW": "원", "USD": "달러", "JPY": "엔", "EUR": "유로", "CNY": "위안"}


def format_money_ko(value: Optional[float], currency: Optional[str] = None) -> str:
    """금액을 통화에 맞는 한국어 단위로 → '973조 원' / '1,806억 달러'.

    통화를 모르면 원화로 본다(종전 동작). 달러 종목을 원화로 적으면 '1,806억 원'이
    되는데, 실제로는 약 250조 원이라 크기가 140배 틀린다(실측: 맥도날드 보고서).
    """
    if value is None:
        return "확인 불가"
    code = (currency or "KRW").upper()
    unit = _CURRENCY_WORD_KO.get(code, code)
    magnitude = abs(value)
    sign = "-" if value < 0 else ""
    if magnitude >= _JO:
        jo = magnitude / _JO
        # 1000조를 넘으면 소수점이 의미 없다.
        text = f"{jo:,.0f}조" if jo >= 100 else f"{jo:,.1f}조"
        return f"{sign}{text} {unit}"
    if magnitude >= _EOK:
        return f"{sign}{magnitude / _EOK:,.0f}억 {unit}"
    return f"{sign}{magnitude:,.0f}{unit}"


def format_krw(value: Optional[float]) -> str:
    """원 단위 금액 → '약 973조 원' / '1,802조 원' / '4,250억 원'."""
    return format_money_ko(value, "KRW")


def describe_valuation_gap(
    intrinsic_value: Optional[float],
    market_cap: Optional[float],
    margin_of_safety: Optional[float],
    currency: Optional[str] = None,
) -> str:
    """'내재가치 얼마 vs 시가총액 얼마 → 그래서 싼가 비싼가'를 한 문단으로.

    계산 결과만 던지면 독자가 두 수를 직접 나눠 봐야 한다. 그 나눗셈을 대신 해 준다.
    """
    if intrinsic_value is None or market_cap is None or not market_cap:
        return ""

    gap = margin_of_safety if margin_of_safety is not None else (intrinsic_value - market_cap) / market_cap
    intrinsic_text = format_money_ko(intrinsic_value, currency)
    market_text = format_money_ko(market_cap, currency)

    if gap >= 0.25:
        verdict = (f"계산된 값이 시장가보다 {gap:.0%} 큽니다. 이 계산 기준으로는 "
                   "지금 가격이 싼 편이고, 안전마진이 확보된 구간입니다.")
    elif gap >= 0:
        verdict = (f"계산된 값이 시장가보다 {gap:.0%} 큽니다. 방향은 저평가지만 폭이 얇아 "
                   "가정이 조금만 틀려도 뒤집히는 구간입니다.")
    elif gap > -0.25:
        verdict = (f"시장가가 계산된 값보다 {abs(gap):.0%} 높습니다. 살짝 비싼 정도라 "
                   "가정 차이로 설명될 수 있는 범위입니다.")
    else:
        verdict = (f"시장가가 계산된 값보다 {abs(gap):.0%} 높습니다. 이 계산 기준으로는 "
                   "지금 가격이 비쌉니다 — 시장이 이 모델에 담기지 않은 성장이나 "
                   "현금흐름 지속성을 이미 값에 넣고 있다는 뜻입니다.")

    return (f"DCF로 계산한 기업 가치는 {intrinsic_text}이고, 시장이 매긴 값(시가총액)은 "
            f"{market_text}입니다. {verdict}")
