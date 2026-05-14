# v3 — Personality Agent에 Forward Outlook 주입

## 1. 문제 진단

### 현재 상태

| 에이전트 | forward_metrics 사용? | LLM 입력에 forward 정보? |
|---|---|---|
| `fundamentals.py` | ✅ `_blend_trailing_forward_pe()` | ✅ blended P/E + forward 분리 |
| `valuation.py` | ✅ `_blend_trailing_forward_pe()` | ✅ blended P/E + forward 분리 |
| `aswath_damodaran.py` | ❌ | ❌ (5-yr trailing P/E median만) |
| `warren_buffett.py` | ❌ | ❌ |
| `charlie_munger.py` | ❌ | ❌ |
| `peter_lynch.py` | ❌ | ❌ |
| `ben_graham.py` | ❌ | ❌ |
| `bill_ackman.py` | ❌ | ❌ |
| `cathie_wood.py` | ❌ | ❌ |
| `michael_burry.py` | ❌ | ❌ |
| `mohnish_pabrai.py` | ❌ | ❌ |
| `phil_fisher.py` | ❌ | ❌ |
| `stanley_druckenmiller.py` | ❌ | ❌ |
| `rakesh_jhunjhunwala.py` | ❌ | ❌ |
| `nassim_taleb.py` | ❌ | ❌ |

### 증상

> Damodaran의 보고서가 "5-yr CAGR이 X%였고 ROIC가 Y%였다"는 식으로 **과거에만 머무름**. 다음 분기 컨센서스 EPS, forward P/E, trailing→forward 변화율 등을 LLM이 본 적이 없으니 자연스러운 결과.

### 근본 원인

Personality 에이전트들은 `get_financial_metrics` + `search_line_items` + `get_market_cap`만 호출하고, 이를 LLM `analysis_data`에 직렬화한다. `get_forward_metrics`는 호출되지 않으며, 따라서 프롬프트에도 forward 정보가 0이다.

---

## 2. 설계 목표

1. **모든 personality 에이전트의 LLM 프롬프트에 forward outlook 블록을 표준 형식으로 주입**한다.
2. **에이전트당 fetch 1회**가 아닌, **티커당 fetch 1회**로 효율화한다 (state 캐싱).
3. **personality 코드(스코어링 로직)는 건드리지 않는다**. analysis_data dict에 한 키 추가하고, LLM 시스템 프롬프트 한 줄만 보강.
4. **Forward 데이터가 없거나 confidence=low여도 보고서가 깨지지 않게** graceful degradation. 그 경우 LLM에 명시적으로 "forward outlook unavailable; rely on trailing"이라고 알린다.
5. **trailing-only fallback과 forward-aware 출력의 차이를 테스트로 증명**한다.

### 비목표

- 에이전트별 personality에 맞춘 forward 해석 로직 (예: Lynch는 PEG, Buffett은 owner earnings × forward growth) — 이것은 v4로 분리.
- forward EPS 자체 모델 개선 — v2에서 끝남.

---

## 3. 아키텍처

### 3.1 두 단계로 구성

**Step 1: state 캐싱 (옵션 2)**

`AgentState["data"]`에 새 키 `forward_metrics_cache: dict[str, ForwardMetrics | None]`을 추가한다. 그래프 시작 시점에 모든 티커의 forward_metrics를 한 번에 prefetch.

```
state["data"]["forward_metrics_cache"] = {
    "AAPL": ForwardMetrics(...),
    "005930.KS": ForwardMetrics(...),
    "BAD_TICKER": None,  # fetch 실패한 케이스
}
```

prefetch 위치: `app/backend/services/graph.py`의 `run_graph()` (또는 동등 위치)에서 모든 에이전트 실행 전. 또는 별도 LangGraph 노드 `forward_metrics_prefetch_node`를 그래프 entry에 둔다.

**Step 2: 공통 헬퍼 + 에이전트별 주입 (옵션 1)**

`src/utils/forward_outlook.py` 신규 파일에 헬퍼 정의:

```python
def get_cached_forward_metrics(
    state: AgentState,
    ticker: str,
    end_date: str,
    api_key: str | None,
) -> ForwardMetrics | None:
    """state 캐시에서 가져오고, 없으면 fetch + 캐시 채움."""

def build_forward_outlook_block(
    forward_metrics: ForwardMetrics | None,
    trailing_pe: float | None = None,
) -> dict[str, Any]:
    """LLM 프롬프트에 직렬화될 표준 forward 블록."""

FORWARD_OUTLOOK_SYSTEM_INSTRUCTION = (
    "If `forward_outlook` is provided in analysis data, you MUST weigh forward "
    "consensus when discussing valuation. Compare forward P/E to trailing P/E "
    "and explain whether the consensus implies expansion or contraction. "
    "Never ignore forward_outlook even if it conflicts with your trailing-based "
    "narrative — explicitly reconcile the two. If forward_outlook.confidence is "
    "'low' or it is null, say so and continue with trailing analysis."
)
```

### 3.2 표준 forward outlook 블록

```json
{
  "forward_outlook": {
    "available": true,
    "as_of_date": "2026-05-09",
    "currency": "KRW",
    "current_price": 165000.0,
    "forward_eps_ttm": 28500.0,
    "forward_pe": 5.79,
    "trailing_pe": 12.4,
    "pe_change_pct": -53.3,
    "confidence": "high",
    "composition": [
      {"period": "2025Q3", "fiscal_period_end": "2025-09-30", "eps": 7036.0, "source": "actual", "provider": "DART"},
      {"period": "2025Q4", "fiscal_period_end": "2025-12-31", "eps": 8538.0, "source": "actual", "provider": "DART"},
      {"period": "2026Q1", "fiscal_period_end": "2026-03-31", "eps": 10012.0, "source": "actual", "provider": "DART"},
      {"period": "2026Q2", "fiscal_period_end": "2026-06-30", "eps": 12914.0, "source": "consensus", "provider": "Naver", "analyst_count": 23, "dispersion": 1100.0}
    ],
    "notes": ["Latest actual is 2026Q1 (within 60 days)", "Consensus from 23 analysts"],
    "interpretation_hint": "forward P/E 5.79x is 53% below trailing 12.4x — consensus implies sharp earnings recovery. Validate the recovery thesis against your qualitative view."
  }
}
```

`available: false` 케이스:
```json
{
  "forward_outlook": {
    "available": false,
    "reason": "Korean ticker 000660.KS — kr_consensus providers all returned 0 estimates",
    "fallback_guidance": "Use trailing metrics only; do not speculate about next quarter."
  }
}
```

### 3.3 에이전트 변경 패턴

각 personality 에이전트 (예: `aswath_damodaran.py`)에서:

**Before**:
```python
analysis_data[ticker] = {
    "signal": signal,
    "growth_analysis": growth_analysis,
    ...
}
```

**After**:
```python
forward_metrics = get_cached_forward_metrics(state, ticker, end_date, api_key)
trailing_pe = getattr(metrics[0], "price_to_earnings_ratio", None) if metrics else None
forward_outlook = build_forward_outlook_block(forward_metrics, trailing_pe=trailing_pe)

analysis_data[ticker] = {
    "signal": signal,
    "growth_analysis": growth_analysis,
    ...
    "forward_outlook": forward_outlook,
}
```

LLM 시스템 프롬프트에 `FORWARD_OUTLOOK_SYSTEM_INSTRUCTION`을 추가:

```python
template = ChatPromptTemplate.from_messages([
    ("system", f"""You are Aswath Damodaran...
    {existing_persona_instructions}
    {FORWARD_OUTLOOK_SYSTEM_INSTRUCTION}"""),
    ("human", "..."),
])
```

---

## 4. 적용 범위

### 4.1 수정 대상 (14개 personality 에이전트)

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

### 4.2 수정 제외

- `fundamentals.py`, `valuation.py`: 이미 forward 사용 중. **단** `get_cached_forward_metrics`로 교체해서 캐시 공유는 받게 함.
- `news_sentiment.py`, `sentiment.py`, `technicals.py`: 가격/뉴스 기반이라 forward EPS 무관.
- `portfolio_manager.py`, `risk_manager.py`: 분석가 시그널을 집계하는 메타 에이전트. 직접 forward 안 봄.

### 4.3 신규 파일

```
src/utils/forward_outlook.py            # 헬퍼 함수 + 시스템 프롬프트 상수
tests/test_forward_outlook.py           # 헬퍼 단위 테스트
tests/test_agents_forward_integration.py # 에이전트 LLM payload에 forward_outlook 포함 검증
```

### 4.4 prefetch 위치

후보 1 (권장): 그래프 entry 노드로 `forward_metrics_prefetch_node` 추가.
- LangGraph 흐름에서 `START → forward_metrics_prefetch_node → [모든 분석가 에이전트들] → portfolio_manager → END`
- 에이전트 코드 수정 시 fallback fetch 로직(`get_cached_forward_metrics`가 캐시 미스 시 직접 fetch)을 두면 prefetch 노드 없이도 동작.

후보 2: `app/backend/services/graph.py`의 그래프 빌드 직전 동기 prefetch.
- LangGraph 안 쓰는 백엔드 진입점에서 미리 채움.

→ **두 위치 다 채움**. 노드 추가가 안전하고 캐시 미스 시 폴백 fetch가 안전망.

---

## 5. 동작 시나리오

### 5.1 미국 종목 AAPL — forward 가능

1. prefetch 노드: `get_forward_metrics("AAPL", ...)` → `confidence="high"` 4분기 composition 캐시.
2. Damodaran 에이전트:
   - 기존 분석 그대로 수행.
   - `forward_outlook` 블록 LLM에 전달, P/E 12.4x → forward 9.8x (-21%).
   - 시스템 프롬프트가 "consensus implies expansion or contraction" 강제.
3. LLM 출력:
   - 기존 "5-yr CAGR was 8%" 만 말하던 보고서가, "trailing P/E 12.4x reflects past earnings; consensus 4Q forward EPS implies P/E 9.8x, suggesting 21% earnings growth priced in. My DCF supports this trajectory if reinvestment efficiency holds." 식으로 미래 시점이 들어옴.

### 5.2 한국 종목 005930.KS — v2 효과로 forward 가능

1. prefetch: `get_forward_metrics("005930.KS", ...)` → DART 3분기 actual + Naver 1분기 consensus.
2. Buffett 에이전트:
   - composition에 currency=KRW, confidence=high.
   - LLM 프롬프트: "Forward EPS implies KRW 6,200 vs trailing KRW 5,400. Consensus from 18 analysts."
3. LLM 출력: "다음 분기 컨센서스 6,200원은 trailing 5,400원 대비 14.8% 증가 — 반도체 사이클 회복 가설을 시사. 하지만 평균 보유기간 10년 관점에선..."

### 5.3 한국 종목 — kr_consensus 모두 실패

1. prefetch: `forward_metrics=None`.
2. `forward_outlook.available=false`, reason 명시.
3. LLM은 "forward outlook unavailable for this ticker; analysis based on trailing metrics" 한 문장 추가하고 평소처럼 진행.

---

## 6. 테스트 전략

### 6.1 `tests/test_forward_outlook.py` (헬퍼 단위)

- `build_forward_outlook_block`이 `ForwardMetrics`를 받았을 때 표준 dict 반환.
- `forward_metrics=None`일 때 `available: false` + reason 포함.
- `trailing_pe`가 주어지면 `pe_change_pct` 정확히 계산.
- `interpretation_hint`가 confidence/방향에 따라 변형.
- `get_cached_forward_metrics`가 state 캐시 hit/miss 모두 처리.

### 6.2 `tests/test_agents_forward_integration.py` (LLM payload 검증)

각 14개 personality 에이전트에 대해:
- `call_llm`을 monkeypatch해서 prompt를 가로챔.
- `analysis_data` 직렬화 결과에 `"forward_outlook"` 키가 있는지 assert.
- 시스템 메시지에 `FORWARD_OUTLOOK_SYSTEM_INSTRUCTION`의 일부 (예: `"forward consensus"`)가 포함되는지 assert.

### 6.3 회귀 테스트

기존 `tests/test_forward_metrics.py` 31개, `tests/test_kr_consensus.py` 14개, 기타 정적 테스트 모두 통과.

---

## 7. Acceptance Criteria

1. **prefetch 노드 또는 service-level prefetch가 동작**해서 동일 티커에 대해 `get_forward_metrics`가 그래프 실행당 1회만 호출됨 (테스트로 검증).
2. **14개 personality 에이전트의 LLM payload에 `forward_outlook` 키가 포함**됨.
3. **각 에이전트의 시스템 프롬프트에 forward 가이드라인이 포함**됨.
4. **forward_metrics가 None이거나 confidence=low**여도 에이전트 보고서가 깨지지 않고 graceful degradation.
5. **수동 검증**: SK하이닉스(005930.KS) 또는 SK하이닉스(000660.KS) Damodaran 보고서가 다음 분기 컨센서스 EPS, forward P/E, trailing 대비 변화를 명시적으로 언급.
6. **기존 테스트 0 회귀**.

---

## 8. 작업 분해

```
Phase 1 — 헬퍼 (~1h)
  □ src/utils/forward_outlook.py 작성
  □ tests/test_forward_outlook.py

Phase 2 — prefetch (~1h)
  □ src/agents/forward_prefetch.py (LangGraph 노드)
  □ app/backend/services/graph.py에 노드 등록
  □ AgentState 캐시 키 정의 (state.py 또는 인라인)

Phase 3 — 에이전트 일괄 적용 (~3h)
  □ 14개 에이전트 patch (analysis_data + 시스템 프롬프트)
  □ fundamentals.py / valuation.py도 캐시 사용으로 교체

Phase 4 — 테스트 + 회귀 (~1h)
  □ tests/test_agents_forward_integration.py
  □ pytest tests/ 전체 통과 확인
  □ 수동 검증 (SK하이닉스 Damodaran 보고서)
```
