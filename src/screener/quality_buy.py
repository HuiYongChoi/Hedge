"""우량한가 × 지금 싼가 — 두 질문을 따로 판정해 매수 후보를 고른다.

종목분석이 중립·매도로 기우는 이유는 매수 기준이 '싸다'에 걸려 있어서다
(가치평가: 적정가가 시가총액보다 15% 넘게 높아야 매수). 우량주는 대개 비싸게
거래되니, 우량 여부와 가격을 한 신호에 섞으면 우량주가 전부 '중립'으로 묻힌다.
그래서 두 축을 나눠 보여 준다.

· 우량 — 펀더멘털 에이전트의 수익성·성장·재무건전성 세 항목 중 둘 이상이 강세이고
  약세 항목이 없을 것. 가격 배수 항목은 가격 판단이라 여기서 쓰지 않는다.
· 싼가 — 가치평가 에이전트의 괴리율(적정가 ÷ 시가총액 − 1, 이상치 제외 가중평균).
  매수 문턱은 그 에이전트의 매수 기준(+15%)과 같다.
· 관심 — 우량하지만 아직 매수 문턱에 못 미치고, 적정가보다 10% 넘게 비싸지는 않은 종목.
  조정이 오면 먼저 매수 구간에 들어올 종목이라, 매수 구간까지 필요한 하락폭을 함께 준다.

두 에이전트 모두 LLM 을 부르지 않으므로 종목당 데이터 조회 시간만 든다. 데이터도
무료 공식·공개 소스(한국 DART, 미국 SEC·yfinance)만 쓴다.
"""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Callable, Iterator, Optional

from src.agents.fundamentals import fundamentals_analyst_agent
from src.agents.valuation import valuation_analyst_agent
from src.tools import api as data_api
from src.tools import forward_metrics as forward_api
from src.tools.api import free_sources_only
from src.screener.universe import UniverseEntry

#: 가치평가 에이전트의 매수·매도 문턱과 같은 값(src/agents/valuation.py 의 signal 판정).
BUY_GAP = 0.15
#: 관심 후보의 아래 경계. 괴리율이 이보다 낮으면(적정가보다 10% 넘게 비싸면) '비쌈'이다.
WATCH_GAP = -0.10

#: 스캐너가 에이전트를 부를 때 쓰는 이름의 접두어. 진행 상황 추적기는 전역이라,
#: 종목분석 스트림이 이 접두어로 스캐너 진행 메시지를 걸러 낸다.
SCREENER_AGENT_PREFIX = "screener_"

QUALITY_AXES = {
    "profitability": "profitability_signal",
    "growth": "growth_signal",
    "financial_health": "financial_health_signal",
}

VERDICTS = (
    "buy",                # 매수 후보: 우량 + 괴리율 > +15%
    "watch",              # 관심 후보: 우량 + 괴리율 −10% ~ +15%
    "quality_expensive",  # 우량 · 비쌈: 괴리율 < −10%
    "quality_no_value",   # 우량 · 가치 계산 불가
    "not_quality",        # 품질 미달
    "insufficient",       # 재무 데이터 부족
)

AgentFn = Callable[..., Any]


def classify(fundamentals: Optional[dict], valuation: Optional[dict]) -> dict:
    """두 에이전트의 종목별 결과로 판정한다. 네트워크 없이 도는 순수 함수."""
    if not fundamentals:
        return {"verdict": "insufficient", "quality": None, "value": _value_block(valuation)}

    reasoning = fundamentals.get("reasoning") or {}
    axes = {
        axis: (reasoning.get(key) or {}).get("signal")
        for axis, key in QUALITY_AXES.items()
    }
    bullish = sum(1 for s in axes.values() if s == "bullish")
    bearish = sum(1 for s in axes.values() if s == "bearish")
    passed = bullish >= 2 and bearish == 0
    # 항목별 실제 수치(예: "ROE: 12.30%, Net Margin: N/A") — 왜 강·약인지 화면에서 보여 준다.
    details = {axis: (reasoning.get(key) or {}).get("details") for axis, key in QUALITY_AXES.items()}
    quality = {**axes, "bullish": bullish, "bearish": bearish, "passed": passed, "details": details}
    value = _value_block(valuation)

    if not passed:
        verdict = "not_quality"
    elif value["gap"] is None:
        verdict = "quality_no_value"
    elif value["gap"] > BUY_GAP:
        verdict = "buy"
    elif value["gap"] < WATCH_GAP:
        verdict = "quality_expensive"
    else:
        verdict = "watch"
    return {"verdict": verdict, "quality": quality, "value": value}


def _value_block(valuation: Optional[dict]) -> dict:
    reasoning = (valuation or {}).get("reasoning") or {}
    raw_gap = reasoning.get("weighted_gap")
    gap = float(raw_gap) if isinstance(raw_gap, (int, float)) else None
    # 괴리율과 같은 기준의 적정가 — 둘이 어긋나면 '적정가 대비 몇 %'가 맞지 않는다.
    raw_per_share = reasoning.get("blended_intrinsic_per_share")
    per_share = float(raw_per_share) if isinstance(raw_per_share, (int, float)) and raw_per_share > 0 else None
    return {
        "gap": gap,
        "signal": (valuation or {}).get("signal"),
        "intrinsic_per_share": per_share,
        # 괴리율 = 적정가 ÷ 시가 − 1 이므로 시가 = 적정가 ÷ (1 + 괴리율).
        "price_per_share": per_share / (1 + gap) if per_share is not None and gap is not None and gap > -1 else None,
        # 괴리율이 매수 문턱을 넘는 주가 = 적정가 ÷ 1.15.
        "buy_price_per_share": per_share / (1 + BUY_GAP) if per_share is not None else None,
        # 지금 주가에서 몇 % 내려야 매수 구간인가. 이미 매수 구간이면 0.
        "drop_to_buy": max(0.0, 1 - (1 + gap) / (1 + BUY_GAP)) if gap is not None and gap > -1 else None,
    }


def _run_agent(agent: AgentFn, agent_id: str, ticker: str, end_date: str, api_keys: dict | None) -> Optional[dict]:
    """에이전트 하나를 종목 하나로 돌려 그 종목 결과만 돌려준다."""
    state = {
        "messages": [],
        "data": {
            "tickers": [ticker],
            "end_date": end_date,
            "start_date": None,
            "analyst_signals": {},
        },
        "metadata": {
            "show_reasoning": False,
            # get_api_key_from_state 는 request.api_keys 를 읽는다.
            "request": SimpleNamespace(api_keys=api_keys or {}),
        },
    }
    agent(state, agent_id=agent_id)
    return (state["data"]["analyst_signals"].get(agent_id) or {}).get(ticker)


def _ticker_cache_stores() -> list[dict]:
    """종목별로 쌓이는 조회 캐시들. 스캔이 끝난 종목의 몫은 비운다."""
    shared = data_api._cache
    return [
        shared._prices_cache,
        shared._financial_metrics_cache,
        shared._pbr_history_cache,
        shared._forward_metrics_cache,
        data_api._MARKET_CAP_CACHE,
        data_api._ENRICHMENT_LINE_ITEMS_CACHE,
        forward_api._FORWARD_CACHE,
    ]


def _owned_by(key: object, ticker: str) -> bool:
    if isinstance(key, tuple):
        return bool(key) and str(key[0]).upper() == ticker.upper()
    if isinstance(key, str):
        return key.upper() == ticker.upper() or key.upper().startswith(f"{ticker.upper()}_")
    return False


@contextmanager
def release_ticker_caches(ticker: str) -> Iterator[None]:
    """이 블록에서 이 종목 때문에 새로 생긴 캐시 항목을 블록이 끝나면 지운다.

    조회 캐시는 크기 제한이 없어, 수백 종목을 훑으면 가격 이력·재무 수치가 계속 쌓여
    서버 메모리가 바닥난다. 스캔 전에 이미 있던 항목(사용자가 넣은 데이터 샌드박스
    수정값, 종목분석이 받아 둔 데이터)은 건드리지 않는다.
    """
    stores = _ticker_cache_stores()
    before = [set(list(store)) for store in stores]
    try:
        yield
    finally:
        for store, existed in zip(stores, before):
            for key in list(store):
                if key not in existed and _owned_by(key, ticker):
                    store.pop(key, None)


def scan_ticker(
    entry: UniverseEntry,
    end_date: str,
    api_keys: dict | None = None,
    *,
    fundamentals_agent: AgentFn = fundamentals_analyst_agent,
    valuation_agent: AgentFn = valuation_analyst_agent,
) -> dict:
    """종목 하나를 판정한다. 실패해도 예외를 올리지 않고 결과에 사유를 담는다."""
    ticker = entry["ticker"]
    errors: list[str] = []

    def attempt(agent: AgentFn, name: str) -> Optional[dict]:
        try:
            # 무료 소스만 쓴다(한국 DART, 미국 SEC·yfinance). 수백 종목을 훑어도 유료 API
            # 사용량을 쓰지 않고, 요청 한도에 걸려 멈추지도 않는다.
            with free_sources_only():
                return _run_agent(agent, f"{SCREENER_AGENT_PREFIX}{name}", ticker, end_date, api_keys)
        except Exception as exc:  # 한 종목의 실패가 스캔 전체를 멈추면 안 된다
            errors.append(f"{name}: {exc}")
            return None

    with release_ticker_caches(ticker):
        fundamentals = attempt(fundamentals_agent, "fundamentals")
        # 우량을 통과하지 못하면 가치평가를 돌려도 판정이 바뀌지 않는다. 가치평가가 조회가
        # 가장 많은 단계라, 통과한 종목만 돌려 스캔 시간을 줄인다.
        quality = classify(fundamentals, None)["quality"]
        valuation = attempt(valuation_agent, "valuation") if quality and quality["passed"] else None

    return {
        "ticker": ticker,
        "name": entry["name"],
        "market": entry["market"],
        **classify(fundamentals, valuation),
        "error": "; ".join(errors) or None,
    }
