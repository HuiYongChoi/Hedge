# Codex 인계 프롬프트 — v3 Personality Agent에 Forward Outlook 주입

아래 블록을 그대로 Codex에 복붙하세요.

---

## ▼ 복붙 시작

당신은 `ai-hedge-fund` 레포의 시니어 백엔드 엔지니어입니다. **v3 작업: 모든 personality 에이전트가 forward PER/EPS 컨센서스를 LLM 보고서에 반영하도록 통합**을 수행합니다.

### 사전 컨텍스트 (반드시 먼저 읽기)

1. `docs/forward_per/v3_agent_integration/DESIGN.md` — 전체 설계 (이게 진리)
2. `docs/forward_per/v2_kr_consensus/DESIGN.md` — v2가 만들어둔 forward_metrics 파이프라인
3. `src/tools/forward_metrics.py` — `get_forward_metrics()` API
4. `src/data/models_forward.py` — `ForwardMetrics`, `QuarterlyEPS` Pydantic 모델
5. `src/agents/fundamentals.py` (line 8, 16-25, 59-61, 129-148) — 이미 forward를 쓰는 참고 사례
6. `src/agents/aswath_damodaran.py` — forward를 안 쓰는 에이전트의 대표 사례 (수정 대상)
7. `src/graph/state.py` — `AgentState` TypedDict 구조

### 진단 (왜 하는가)

현재 14개 personality 에이전트(Damodaran, Buffett, Munger, Lynch, Graham, Ackman, Wood, Burry, Pabrai, Fisher, Druckenmiller, Jhunjhunwala, Taleb, Growth)는 `get_forward_metrics`를 호출하지 않습니다. 그래서 LLM은 trailing 5년 데이터만 보고 보고서를 쓰며, "다음 분기 컨센서스 EPS", "forward P/E", "trailing→forward 변화" 같은 미래 정보를 말할 근거가 없습니다. 사용자 피드백: "Damodaran 보고서가 과거에만 머문다."

v2까지 빌드된 forward 파이프라인(US: FMP/yfinance, KR: Naver/WiseReport + DART 분기 보강)을 활용해, **personality 코드는 그대로 두고** LLM 입력에 표준 forward outlook 블록을 주입하면 보고서 톤이 자연스럽게 미래 지향으로 전환됩니다.

### 요구사항 (Acceptance Criteria — 전부 통과해야 완료)

1. **prefetch**: 그래프 실행당 동일 티커에 대해 `get_forward_metrics`가 1회만 호출됨 (state 캐시).
2. **14개 personality 에이전트의 LLM payload(`analysis_data`)에 `forward_outlook` 키가 포함**.
3. **각 에이전트의 LLM 시스템 프롬프트에 forward 가이드라인 한 단락이 포함**되어 LLM이 forward를 무시하지 못하게 강제.
4. **forward_metrics가 None / confidence=low**여도 보고서 생성이 실패하지 않고 graceful degradation.
5. **수동 검증**: 005930.KS(삼성전자) 또는 000660.KS(SK하이닉스) Damodaran 보고서가 다음 분기 컨센서스 EPS, forward P/E, trailing 대비 변화를 명시적으로 언급해야 함.
6. **기존 테스트 0 회귀**: `pytest tests/` 전체 통과.

### 구현 단계 (순서대로)

#### Phase 1 — 공통 헬퍼

**신규 파일: `src/utils/forward_outlook.py`**

```python
"""Forward outlook block for personality agent LLM payloads.

Provides:
  - get_cached_forward_metrics(): state-aware fetcher
  - build_forward_outlook_block(): standardized dict for analysis_data
  - FORWARD_OUTLOOK_SYSTEM_INSTRUCTION: prompt fragment to enforce usage
"""
from __future__ import annotations

import logging
from typing import Any

from src.data.models_forward import ForwardMetrics
from src.tools.forward_metrics import get_forward_metrics

logger = logging.getLogger(__name__)

CACHE_KEY = "forward_metrics_cache"

FORWARD_OUTLOOK_SYSTEM_INSTRUCTION = (
    "FORWARD OUTLOOK REQUIREMENT: If `forward_outlook` is provided in the analysis "
    "data and `available` is true, you MUST weigh forward consensus when discussing "
    "valuation. Compare forward P/E to trailing P/E and explain whether the consensus "
    "implies earnings expansion or contraction. Quote the next-quarter consensus EPS "
    "value explicitly. Never ignore forward_outlook even if it conflicts with your "
    "trailing-based narrative — explicitly reconcile the two views. "
    "If `forward_outlook.available` is false or `confidence` is 'low', acknowledge "
    "the limitation in one sentence and continue with trailing analysis."
)


def get_cached_forward_metrics(
    state: dict,
    ticker: str,
    end_date: str,
    api_key: str | None,
) -> ForwardMetrics | None:
    """Return cached ForwardMetrics for ticker; fetch + cache on miss."""
    data = state.setdefault("data", {})
    cache: dict[str, ForwardMetrics | None] = data.setdefault(CACHE_KEY, {})

    if ticker in cache:
        return cache[ticker]

    try:
        result = get_forward_metrics(ticker, as_of_date=end_date, api_key=api_key)
    except Exception as exc:
        logger.warning("forward_metrics fetch failed for %s: %s", ticker, exc)
        result = None

    cache[ticker] = result
    return result


def build_forward_outlook_block(
    forward_metrics: ForwardMetrics | None,
    trailing_pe: float | None = None,
) -> dict[str, Any]:
    """Serialize ForwardMetrics into the standard LLM-facing block."""
    if forward_metrics is None:
        return {
            "available": False,
            "reason": "forward_metrics could not be computed for this ticker",
            "fallback_guidance": "Use trailing metrics only; do not speculate about next quarter.",
        }

    forward_pe = getattr(forward_metrics, "forward_pe", None)
    pe_change_pct: float | None = None
    if trailing_pe is not None and forward_pe is not None and trailing_pe > 0:
        pe_change_pct = round((forward_pe - trailing_pe) / trailing_pe * 100, 2)

    composition = [
        {
            "period": q.period,
            "fiscal_period_end": q.fiscal_period_end.isoformat(),
            "eps": q.eps,
            "source": q.source,
            "provider": q.provider,
            "analyst_count": q.analyst_count,
            "dispersion": q.dispersion,
        }
        for q in forward_metrics.composition
    ]

    interpretation = _build_interpretation_hint(
        forward_metrics, trailing_pe, forward_pe, pe_change_pct
    )

    return {
        "available": True,
        "as_of_date": forward_metrics.as_of_date.isoformat(),
        "currency": forward_metrics.currency,
        "current_price": forward_metrics.current_price,
        "forward_eps_ttm": forward_metrics.forward_eps_ttm,
        "forward_pe": forward_pe,
        "trailing_pe": trailing_pe,
        "pe_change_pct": pe_change_pct,
        "confidence": forward_metrics.confidence,
        "composition": composition,
        "notes": list(forward_metrics.notes),
        "interpretation_hint": interpretation,
    }


def _build_interpretation_hint(
    fm: ForwardMetrics,
    trailing_pe: float | None,
    forward_pe: float | None,
    pe_change_pct: float | None,
) -> str:
    parts: list[str] = []
    if forward_pe is not None and trailing_pe is not None and pe_change_pct is not None:
        direction = "expansion" if pe_change_pct < 0 else "contraction"
        parts.append(
            f"Forward P/E {forward_pe:.2f}x vs trailing {trailing_pe:.2f}x ({pe_change_pct:+.1f}%) "
            f"— consensus implies earnings {direction}."
        )
    elif forward_pe is not None:
        parts.append(f"Forward P/E {forward_pe:.2f}x (no trailing P/E for direct comparison).")

    consensus_quarter = next(
        (q for q in fm.composition if q.source.startswith("consensus")), None
    )
    if consensus_quarter is not None:
        analyst_str = (
            f" from {consensus_quarter.analyst_count} analysts"
            if consensus_quarter.analyst_count
            else ""
        )
        parts.append(
            f"Next-quarter ({consensus_quarter.period}) consensus EPS: "
            f"{consensus_quarter.eps:.2f} {fm.currency}{analyst_str}."
        )

    if fm.confidence == "low":
        parts.append("Confidence is LOW — treat forward figures as directional only.")

    return " ".join(parts) if parts else "No interpretive hint available."
```

**신규 파일: `tests/test_forward_outlook.py`**

다음 케이스를 커버:
- `build_forward_outlook_block(None)` → `available=False`, `reason` 포함
- `build_forward_outlook_block(forward_metrics, trailing_pe=12.0)` → `pe_change_pct` 정확
- composition에 consensus 분기가 있으면 `interpretation_hint`에 EPS 값 포함
- `confidence='low'`일 때 hint에 "LOW" 경고 포함
- `get_cached_forward_metrics` hit/miss/fetch-실패 모두 처리

#### Phase 2 — Prefetch 노드

**신규 파일: `src/agents/forward_prefetch.py`**

```python
"""LangGraph node that prefetches forward_metrics for all tickers once."""
from __future__ import annotations

import logging

from src.graph.state import AgentState
from src.utils.api_key import get_api_key_from_state
from src.utils.forward_outlook import CACHE_KEY, get_cached_forward_metrics
from src.utils.progress import progress

logger = logging.getLogger(__name__)


def forward_prefetch_node(state: AgentState, agent_id: str = "forward_prefetch") -> dict:
    """Prefetch ForwardMetrics for all tickers into state cache."""
    data = state["data"]
    end_date = data["end_date"]
    tickers = data.get("tickers", [])
    api_key = get_api_key_from_state(state, "FINANCIAL_DATASETS_API_KEY")

    data.setdefault(CACHE_KEY, {})

    for ticker in tickers:
        progress.update_status(agent_id, ticker, "Prefetching forward metrics")
        get_cached_forward_metrics(state, ticker, end_date, api_key)

    progress.update_status(agent_id, None, "Done")
    return {"data": state["data"]}
```

**그래프 등록**: `app/backend/services/graph.py` (또는 동등 위치 — `git grep -n "add_node\|StateGraph"` 으로 찾으세요) 에서 분석가 노드들 추가 직전에 `forward_prefetch_node` 추가하고 `START → forward_prefetch → [analysts]` 엣지 연결.

#### Phase 3 — 14개 에이전트 일괄 패치

각 에이전트에 동일한 패턴 적용:

**1) import 추가**
```python
from src.utils.forward_outlook import (
    build_forward_outlook_block,
    get_cached_forward_metrics,
    FORWARD_OUTLOOK_SYSTEM_INSTRUCTION,
)
```

**2) 분석 루프 안에서 forward 블록 생성** (티커별로):
```python
forward_metrics = get_cached_forward_metrics(state, ticker, end_date, api_key)
trailing_pe = None
if metrics:
    trailing_pe = getattr(metrics[0], "price_to_earnings_ratio", None)
forward_outlook = build_forward_outlook_block(forward_metrics, trailing_pe=trailing_pe)
```

**3) `analysis_data[ticker]`에 `"forward_outlook": forward_outlook` 추가**

**4) LLM 시스템 프롬프트 업데이트** — 기존 페르소나 지시문 끝에 `\n\n{FORWARD_OUTLOOK_SYSTEM_INSTRUCTION}` 추가 (f-string 또는 concatenation).

**대상 14개 파일**:
```
src/agents/aswath_damodaran.py
src/agents/warren_buffett.py
src/agents/charlie_munger.py
src/agents/peter_lynch.py
src/agents/ben_graham.py
src/agents/bill_ackman.py
src/agents/cathie_wood.py
src/agents/michael_burry.py
src/agents/mohnish_pabrai.py
src/agents/phil_fisher.py
src/agents/stanley_druckenmiller.py
src/agents/rakesh_jhunjhunwala.py
src/agents/nassim_taleb.py
src/agents/growth_agent.py
```

**중요**: `metrics`나 `line_items` 변수명이 에이전트마다 다를 수 있으니 (예: `financial_metrics`, `latest_metrics`) 그대로 매칭해서 trailing_pe 추출. `state` 인자가 함수 시그니처에 없는 helper에서 분석 데이터를 만든다면, 메인 에이전트 함수에서 한 번만 build하고 `analysis_data` dict에 주입.

**fundamentals.py / valuation.py 보너스 패치**: 기존 `get_forward_metrics` 직접 호출을 `get_cached_forward_metrics(state, ...)`로 교체 (캐시 공유). 시스템 프롬프트는 이미 forward를 쓰니 추가 불필요.

#### Phase 4 — 통합 테스트

**신규 파일: `tests/test_agents_forward_integration.py`**

각 14개 에이전트에 대해 (parametrize 추천):
- `call_llm`을 monkeypatch — prompt를 캡처해서 검증.
- 더미 ticker, end_date로 에이전트 실행.
- 캡처된 `analysis_data` JSON에 `"forward_outlook"` 키 존재.
- 캡처된 system message 텍스트에 `"forward consensus"` 또는 `"FORWARD OUTLOOK"` 부분 문자열 존재.
- `forward_metrics_cache`에 ticker가 들어가 있음 (prefetch 또는 lazy fetch 동작 확인).

**회귀 검증**:
```bash
pytest tests/ --ignore=tests/backtesting -q
```
모두 통과해야 함.

### 작업 가이드라인

- **personality 스코어링 로직(analyze_*, calculate_*)은 절대 수정 금지**. 분석 결과 dict와 LLM 프롬프트만 건드림.
- forward_metrics fetch 실패 → exception 던지지 말고 `available=false` 블록으로 graceful 처리.
- 시스템 프롬프트 추가 시, 각 페르소나의 기존 톤(Buffett의 신중함, Lynch의 활기 등)을 깨지 않도록 **추가 단락**으로만 붙이고 기존 텍스트 수정 금지.
- 모든 신규 함수는 type hint 필수 (Python 3.11+ 문법, `X | None` 사용).
- 모든 신규 모듈에 짧은 module docstring.
- import 순서는 isort 기본(표준 라이브러리 → 3rd party → 로컬).

### 보고 형식

작업 완료 후 다음을 출력:

1. **변경 파일 리스트** (신규 / 수정 분리)
2. **테스트 결과**: `pytest tests/ --ignore=tests/backtesting -q` 결과 라인 (예: `259 passed in 2.3s`)
3. **수동 검증 스크립트** (있다면): 005930.KS Damodaran 호출 + 보고서 발췌
4. **남은 TODO**: forward outlook이 personality별로 다르게 해석되도록 하는 v4 계획 (한 단락)

## ▲ 복붙 끝

---

## 보조: 빠른 검증 수동 스크립트 (작업 완료 후 사용자가 직접 돌려볼 용)

```python
# scripts/verify_v3_forward_outlook.py
import os
from src.agents.aswath_damodaran import aswath_damodaran_agent

state = {
    "data": {
        "tickers": ["005930.KS"],
        "end_date": "2026-05-09",
        "analyst_signals": {},
    },
    "metadata": {"show_reasoning": True},
}
os.environ.setdefault("OPENAI_API_KEY", "...")
result = aswath_damodaran_agent(state)
print(result["data"]["analyst_signals"])
```

기대: `reasoning` 텍스트 안에 "다음 분기 컨센서스", "forward P/E", "consensus implies"같은 문구가 등장.
