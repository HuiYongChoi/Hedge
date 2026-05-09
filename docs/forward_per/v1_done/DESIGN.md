# Forward TTM EPS & Forward PER — 설계 플랜

> 대상 저장소: `ai-hedge-fund/`
> 목적: 직전 3개 분기 발표치(actual) + 다음 1개 분기 컨센서스(estimate)를 합성한 **Forward TTM EPS**와 **Forward PER**을 모든 애널리스트 에이전트가 트레일링 지표와 **공존**하여 참고할 수 있도록 한다.

---

## 1. 설계 원칙

1. **트레일링은 그대로 둔다.** 기존 `get_financial_metrics()` 결과(`period="ttm"`)와 `FinancialMetrics.price_to_earnings_ratio`/`earnings_per_share`는 손대지 않는다. 신규 트랙(forward)을 별도 모델/별도 함수로 추가한다.
2. **출처 추적이 필수다.** 합성된 EPS의 어느 분기가 actual이고 어느 분기가 estimate인지, 추정치 출처와 신뢰도를 모델 안에 박는다. 에이전트가 보고서에서 명시할 수 있도록.
3. **소스 어댑터 패턴.** 컨센서스 데이터 소스(FMP, yfinance, 한국 에프앤가이드/와이즈에프엔, LLM 폴백)는 모두 동일한 `EstimateProvider` 인터페이스 뒤에 둔다. 라우팅은 미국/한국 티커, 가용성에 따라 결정.
4. **EPS 정의 일관성.** 트레일링과 추정치가 다른 정의(GAAP vs adjusted, basic vs diluted)면 splicing 시 점프가 생긴다. **adjusted diluted EPS**로 정규화한다.
5. **에이전트는 데이터 레이어를 선택하지 않는다.** 데이터 레이어가 trailing/forward 둘 다 제공하고, 에이전트 페르소나가 가중치를 결정한다 (워런 버핏 = 트레일링 우선, 피터 린치 = forward에 더 비중).

---

## 2. 아키텍처 레이어

```
┌─────────────────────────────────────────────────────┐
│  Agent layer (warren_buffett.py, peter_lynch.py …)  │  ← 페르소나별 가중치
├─────────────────────────────────────────────────────┤
│  forward_metrics.get_forward_metrics(ticker)        │  ← 합성 (splicing)
├──────────────────────────┬──────────────────────────┤
│  trailing: api.get_*()   │  estimates_api.*Provider │  ← 데이터 수집
│  (기존)                   │  (신규)                   │
└──────────────────────────┴──────────────────────────┘
```

### 2.1 Data 수집 레이어 — `src/tools/estimates_api.py` (신규)

추정치 소스 어댑터. 다음 인터페이스를 따른다.

```python
class EstimateProvider(Protocol):
    name: str
    def fetch_quarterly_eps_estimates(
        self, ticker: str, end_date: date, num_quarters: int = 4,
    ) -> list[QuarterlyEPSEstimate]: ...
```

구현 어댑터 (우선순위 순, 폴백 체인):

| Provider | 커버리지 | 호출 방식 | 비고 |
|---|---|---|---|
| `FMPEstimateProvider` | 미국 + 일부 글로벌 | `/api/v3/analyst-estimates/{ticker}` | 무료 키 작동, 분기 EPS 추정치 제공 |
| `YFinanceEstimateProvider` | 미국 + 일부 | `Ticker.earnings_estimate` / `eps_trend` | 분기 단위 average estimate |
| `KrFnGuideProvider` | 한국 (KOSPI/KOSDAQ) | 와이즈에프엔/에프앤가이드 (유료) — 1차에선 stub | 미구현 시 LLM 폴백 |
| `LLMEstimateProvider` | 폴백 | DART 사업보고서 가이던스 + 뉴스에서 LLM이 추출 | confidence 낮게 표기 |

라우팅 규칙: `_is_korean_ticker(ticker)`이면 KrFnGuide → LLM 폴백, 그 외에는 FMP → yfinance → LLM 폴백. 모든 어댑터는 실패 시 빈 리스트 반환(예외 전파 X).

### 2.2 Model 확장 — `src/data/models_forward.py` (신규)

`FinancialMetrics`에 끼워넣지 않고 **별도 파일/모델**로 둔다 (출처/신뢰도 메타데이터가 많고, 기존 모델의 `extra="allow"`와 섞이면 추적이 어려워짐).

```python
class QuarterlyEPS(BaseModel):
    period: str                       # "2026Q1"
    fiscal_period_end: date           # 2026-03-31
    eps: float
    source: Literal["actual", "consensus", "guidance", "llm_extracted"]
    provider: str                     # "FMP", "DART", "YFinance", "LLM-fallback"
    as_of: date
    analyst_count: int | None = None
    dispersion: float | None = None   # estimate stdev (있으면)

class ForwardMetrics(BaseModel):
    ticker: str
    as_of_date: date
    current_price: float
    forward_eps_ttm: float
    forward_pe: float
    composition: list[QuarterlyEPS]   # 길이 4, 시간순 — actual/estimate 혼재
    confidence: Literal["high", "medium", "low"]
    notes: list[str] = []             # "estimate stale by 14 days" 등

class ForwardMetricsResponse(BaseModel):
    forward_metrics: ForwardMetrics | None
```

`confidence` 결정 규칙:
- **high**: 4분기 중 최소 3개 actual + 1개 consensus (analyst_count ≥ 5).
- **medium**: 3 actual + 1 consensus (analyst_count < 5) 또는 LLM-extracted estimate.
- **low**: actual 분기가 부족하거나, 컨센서스 부재로 트레일링 자체로 폴백한 경우.

### 2.3 합성 레이어 — `src/tools/forward_metrics.py` (신규)

핵심 함수:

```python
def get_forward_metrics(
    ticker: str,
    as_of_date: str | date | None = None,   # 기본: today
    api_key: str | None = None,
) -> ForwardMetrics | None:
```

알고리즘:

1. **최근 발표 분기 식별.** `get_financial_metrics(ticker, end_date, period="quarter", limit=8)`로 분기 EPS 시계열을 받아 가장 최근 actual 분기 `Q_n` 식별.
2. **직전 3분기 actual EPS** 추출: `Q_{n-2}`, `Q_{n-1}`, `Q_n`. 이 단계에서 EPS가 누락되면 `net_income / outstanding_shares`로 폴백.
3. **다음 분기 추정치 가져오기.** `EstimateProvider`로 `Q_{n+1}` consensus EPS 1건. 없으면 폴백 체인 진행. 모두 실패하면 트레일링 EPS를 그대로 `forward_eps_ttm`로 두고 `confidence="low"`, `notes`에 사유 기록.
4. **EPS 정의 정규화.** actual은 GAAP diluted, 추정치는 보통 adjusted. 큰 종목은 둘이 비슷하지만 조정 항목이 큰 경우 `notes`에 경고. (1차에선 정규화 변환은 생략하고 경고만, 2차에서 EBIT-bridge 도입 검토.)
5. **합산:** `forward_eps_ttm = sum(eps for q in composition)`.
6. **현재가** = `get_prices(ticker, today-7d, today).close[-1]` (장 마감가).
7. **`forward_pe = current_price / forward_eps_ttm`** — 단, `forward_eps_ttm <= 0`이면 `None` 반환 + `notes` 기록.
8. **캐시.** `src/data/cache.py`에 `_forward_metrics_cache` 추가. TTL은 분기 발표 캘린더에 의존(=구현 단순화 위해 1일 TTL로 시작, 추후 발표일 캘린더 도입).

### 2.4 에이전트 소비 레이어

각 애널리스트 파일에 다음 패턴으로 1~3줄만 추가한다 (대량 리팩토링 X):

```python
from src.tools.forward_metrics import get_forward_metrics

forward = get_forward_metrics(ticker, as_of_date=end_date)
if forward:
    # 프롬프트/지표 계산에 forward.forward_pe, forward.composition, forward.confidence 주입
    ...
```

페르소나별 권장 가중치 (1차 가이드, 추후 백테스트로 튜닝):

| 에이전트 | trailing PER | forward PER | 비고 |
|---|---|---|---|
| `warren_buffett.py` | 0.7 | 0.3 | 보수적, actual 우선 |
| `charlie_munger.py` | 0.7 | 0.3 | 동일 |
| `peter_lynch.py` | 0.4 | 0.6 | 성장주, forward 중시 |
| `cathie_wood.py` | 0.2 | 0.8 | 미래 성장 중심 |
| `michael_burry.py` | 0.6 | 0.4 | 추정치 신뢰도 가중 |
| `valuation.py`, `fundamentals.py` | 0.5 | 0.5 | 정량 중립 |
| `aswath_damodaran.py` | 0.4 | 0.6 | DCF 기반, forward 중시 |
| 그 외 | 0.5 | 0.5 | 기본값 |

`confidence="low"`인 경우 **모든 에이전트가 forward 가중치를 0으로 자동 강등** (페르소나 가중치 무시). 이는 합성 레이어가 아니라 에이전트 측에서 가드.

---

## 3. 구현 순서 (Codex가 따라갈 단계)

1. **모델 추가**: `src/data/models_forward.py` 작성 (skeleton 참고).
2. **추정치 어댑터**: `src/tools/estimates_api.py` 작성. 1차에선 `FMPEstimateProvider` + `YFinanceEstimateProvider`만 실제 구현, 한국용/LLM은 stub (빈 리스트 반환)으로 남기고 TODO 마커.
3. **합성 함수**: `src/tools/forward_metrics.py` 작성. 분기 EPS 시계열 추출 → splicing → forward PER 계산 → 캐시.
4. **캐시 확장**: `src/data/cache.py`에 `get_forward_metrics`/`set_forward_metrics` 메서드 추가.
5. **테스트**: `tests/test_forward_metrics.py` 신규 — AAPL/MSFT/005930.KS 3종에 대해
   - 직전 3분기 actual + 1분기 estimate 합성 확인
   - 추정치 부재 시 트레일링 폴백 + `confidence="low"` 확인
   - `forward_eps_ttm <= 0` 시 None 반환 확인
6. **에이전트 통합 (1단계)**: `valuation.py`, `fundamentals.py` 두 곳만 먼저 통합. 보고서/시그널에 forward PER 반영 + 트레일링과 가중 평균.
7. **에이전트 통합 (2단계)**: 나머지 페르소나 에이전트들에 위 표의 가중치로 통합. 이 단계는 PR을 분리.
8. **문서**: `CLAUDE.md` 또는 `agents.md`에 forward 트랙 사용법 한 단락 추가.

---

## 4. 명시적 비-범위 (Out of scope, 1차 PR에서 하지 않을 것)

- 기존 `FinancialMetrics`, `get_financial_metrics()` 시그니처/동작 변경
- 분기 발표 캘린더(어닝 캘린더) 통합 — TTL은 1일 고정으로 시작
- EPS 정의 정규화(GAAP↔Adjusted bridge) — 1차는 경고만
- 한국 에프앤가이드 유료 어댑터 실제 호출 — stub만
- 프론트엔드 노출 — 백엔드 데이터 레이어/에이전트 통합까지만

---

## 5. 짚어둘 트레이드오프 / 리스크

| 리스크 | 대응 |
|---|---|
| Stale estimate (분기 발표 직후 컨센서스 미갱신) | `as_of` 타임스탬프 노출, 14일 초과 시 `notes`에 경고, confidence 강등 |
| 소스 간 EPS 정의 차이 | adjusted diluted로 명시, 1차는 경고만 → 2차 normalize |
| 한국 종목 컨센서스 빈약 | LLM 폴백 + confidence="low" 자동 강등으로 안전망 |
| `forward_eps_ttm` 음수 (적자 전환 예상) | `forward_pe = None` 반환, 에이전트는 PEG/PSR로 폴백 |
| 캐시 stale | 1일 TTL, 분기 발표일 캘린더는 후속 작업 |

---

## 6. 검증 (Acceptance Criteria)

- [ ] `get_forward_metrics("AAPL")` → composition 4분기 중 정확히 1개가 `source="consensus"`, 3개가 `source="actual"`.
- [ ] `forward_pe`가 트레일링 PE와 5~30% 범위 내에서 다름 (성장주는 더 낮고, 역성장은 더 높음).
- [ ] 추정치 미수집 시 `confidence="low"` + `forward_eps_ttm == trailing_eps_ttm`.
- [ ] 적자 전환 케이스(예: 일부 바이오)에서 `forward_pe is None` 반환, 예외 없음.
- [ ] `valuation.py` 시그널에 `trailing_pe`와 `forward_pe`가 모두 reasoning에 노출됨.
- [ ] 기존 테스트 스위트(`pytest tests/`) 모두 그대로 통과.
- [ ] 한국 티커(`005930.KS`)에 대해 LLM 폴백이 작동하거나, 명확하게 `confidence="low"`로 처리됨.

---

## 7. 참고 — 기존 코드 후크

- `src/tools/api.py:864 get_financial_metrics()` — 트레일링 메트릭 진입점, 분기 시계열 추출에 그대로 활용
- `src/tools/api.py:1207 get_market_cap()` — 현재가/시총 조회 (재귀 주의: 함수 본문 주석 참고)
- `src/tools/api.py:200 _is_korean_ticker()` — 라우팅 분기 기준
- `src/data/cache.py:1 Cache` — `_forward_metrics_cache` 추가 위치
- `src/agents/valuation.py`, `src/agents/fundamentals.py` — 1차 통합 타깃
- `src/agents/peter_lynch.py:289 analyze_lynch_valuation()` — PE/PEG 사용 사례 (forward 통합 시 참조)
