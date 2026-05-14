# v4 — Annual Forward EPS / Annual Forward PER

Base commit: `d515d53 fix(ui): merge orphan report checklist numbers`

## 목적
Data Sandbox의 Forward PER 카드에서 기존 **TTM(직전 실적 3분기 + 컨센서스 1분기 합성)** 외에
**연간 예측 EPS / 연간 포워드 PER (FY 현재, FY+1)** 을 별도 칼럼으로 표시한다.
사용자가 값을 수동 오버라이드할 수 있어야 하고, 동일 데이터가 에이전트(`src/agents/valuation.py`)의
`forward_outlook` 페이로드에도 명시적으로 전달되어 리포트가 TTM/연간을 구분해 인용해야 한다.

TTM 계산 경로 자체는 **건드리지 않는다.** 연간 값은 모두 Optional 필드로 부가된다.

---

## 1. 데이터 모델 (`src/data/models_forward.py`)

### 1.1 신규 모델
```python
class AnnualEPSEstimate(BaseModel):
    fiscal_year: int
    fiscal_year_end: date
    eps: float
    source: Literal["consensus", "guidance", "llm_extracted"]
    provider: str
    as_of: date
    analyst_count: int | None = None
    dispersion: float | None = None
    confidence: Literal["high", "medium", "low"] = "medium"
```
- `provider`, `source` 비공백 validator
- `analyst_count`, `dispersion` 음수 금지

### 1.2 `ForwardMetrics` 확장
`extra="allow"` 유지. 기존 4-분기 composition validator는 그대로 둔다. 다음 Optional 필드 추가
(전부 default None / empty):
- `forward_eps_fy0: float | None = None`
- `forward_pe_fy0: float | None = None`
- `fy0_estimate: AnnualEPSEstimate | None = None`
- `forward_eps_fy1: float | None = None`
- `forward_pe_fy1: float | None = None`
- `fy1_estimate: AnnualEPSEstimate | None = None`
- `annual_estimates: list[AnnualEPSEstimate] = Field(default_factory=list)`

추가 validator: `forward_pe_fy{N}` 가 None 이 아니면 해당 `forward_eps_fy{N}` 는 > 0 이어야 한다.
eps ≤ 0 인 경우 pe 는 강제 None.

---

## 2. 추정 제공자 (`src/tools/estimates_api.py`, `src/tools/kr_consensus/*`)

`EstimateProvider` 프로토콜에 메서드 추가:
```python
def fetch_annual_eps_estimates(
    self, ticker: str, as_of_date: date, num_years: int = 2
) -> list[AnnualEPSEstimate]: ...
```

구현 범위
- **FMPEstimateProvider**: `GET /api/v3/analyst-estimates/{ticker}?period=annual&apikey=...`,
  `estimatedEpsAvg`, `numberAnalystEstimatedEps`, `date` → `fiscal_year_end`. `fiscal_year_end > as_of_date` 만 유지, 정렬 후 `num_years` 만큼.
- **YFinanceEstimateProvider**: `yf.Ticker(ticker).earnings_estimate` 의 `+1y`, `+2y` row 사용.
  `Ticker.calendar` 의 "Fiscal Year End" 가 있으면 그것을, 없으면 12-31(현재 연도, +1) fallback.
  `eps = row.avg/average`, `analyst_count = row.numberOfAnalysts`, dispersion 은 high/low 로 계산.
- **NaverConsensusProvider**: 기존 파서를 확장해서 `(E)` 표기된 **12월 결산 컬럼**도 `AnnualEPSEstimate`
  로 반환 (분기 파싱은 그대로). `provider="NaverFinance"`, `source="consensus"`.
- **WiseReport / Hankyung / LLM-fallback**: `[]` 반환하는 stub 메서드만 추가.

신뢰도 헬퍼 `_grade_annual_confidence(estimate)`:
- analyst_count ≥ 5 → `"high"`
- 1–4 → `"medium"`
- 0 / None → `"low"`

`default_provider_chain` 변경 없음.

---

## 3. 합성 로직 (`src/tools/forward_metrics.py`)

`get_forward_metrics` 의 TTM 합성이 성공한 직후(현재가 확보된 뒤, `ForwardMetrics(...)` 생성 직전)
에 다음을 수행:

1. 동일 `provider_chain` 을 돌면서 첫 번째로 결과가 있는 provider 에서
   `fetch_annual_eps_estimates(ticker, as_of, num_years=2)` 호출.
2. `fiscal_year_end >= as_of` 가운데 가장 빠른 estimate = FY0, 다음 = FY+1.
3. 화폐 일관성 검사는 기존 `_check_currency_consistency` 의미를 재사용. 불일치 시 두 FY pe 모두
   None 으로 강제, note 추가.
4. `forward_pe_fy{N} = current_price / eps` (eps > 0 일 때만).
5. `notes` 에 다음 추가:
   - `"annual estimate provider=<name>"`
   - `"fy0 analyst_count=<n>"` (있을 때)
6. trailing-only fallback 경로(분기 4개 actual 만)에서는 연간 합성 **생략**.

### `build_forward_metrics_override` 확장
payload 키 추가: `forward_pe_fy0`, `forward_pe_fy1` (positive float).
- 제공되면 confidence 를 `"high"` 로 승격.
- 기존 eps 가 있으면 eps 는 유지, pe 만 덮어쓴다. eps 가 없으면
  `forward_eps_fy{N} = current_price / forward_pe_fy{N}` 로 역산.
- `notes` 에 `"user override: forward_pe_fy0 manually set via Data Sandbox"` /
  `..._fy1...` 추가.

---

## 4. 에이전트 페이로드 (`src/utils/forward_outlook.py`)

`build_forward_outlook_block(...)` 반환 dict 에 추가 키:
```
forward_pe_fy0, forward_eps_fy0, fy0_fiscal_year, fy0_analyst_count, fy0_confidence
forward_pe_fy1, forward_eps_fy1, fy1_fiscal_year, fy1_analyst_count, fy1_confidence
annual_vs_ttm: {
  fy0_minus_ttm_pct: float | None,
  fy1_minus_ttm_pct: float | None,
}
```
(존재할 때만)

`FORWARD_OUTLOOK_SYSTEM_INSTRUCTION` 에 한 문장 추가:
> When `forward_pe_fy0` or `forward_pe_fy1` is present, treat them as the **annual** anchor
> and quote them alongside the TTM splice; do not average silently.

`_build_interpretation_hint` 에 FY0 pe 가 존재할 때 한 줄 추가:
> "Annual forward P/E (FY{year}): X.XXx vs TTM Y.YYx."

### `src/agents/valuation.py`
`_blend_trailing_forward_pe` **건드리지 않는다.** 단,
`reasoning["forward_per_analysis"]` 에 `forward_pe_fy0`, `forward_pe_fy1` 을 None-safe 로
함께 기록해 LLM 컨텍스트에 노출.

---

## 5. 백엔드 라우트 / 스키마

- `app/backend/models/schemas.py`: `FetchMetricsResponse.forward_metrics: Optional[Dict[str, Any]]`
  유지 — 스키마 변경 불요.
- `app/backend/routes/hedge_fund.py`: `get_forward_metrics` 호출과
  `build_forward_metrics_override` 호출부 모두 그대로. 모델만 풍부해짐.

---

## 6. 프론트엔드 (`app/frontend/src/components/tabs/data-sandbox-tab.tsx`)

### 6.1 타입
`interface ForwardMetrics` 에 Optional 신규 필드 추가:
```ts
forward_eps_fy0?: number | null;
forward_pe_fy0?: number | null;
fy0_estimate?: AnnualEPSEstimate | null;
forward_eps_fy1?: number | null;
forward_pe_fy1?: number | null;
fy1_estimate?: AnnualEPSEstimate | null;
annual_estimates?: AnnualEPSEstimate[];
```

`interface AnnualEPSEstimate { fiscal_year, fiscal_year_end, eps, source, provider, as_of, analyst_count?, dispersion?, confidence? }` 신설.

### 6.2 State
신규:
- `forwardPeFy0Override`, `setForwardPeFy0Override`
- `isForwardPeFy0OverrideDirty`
- 동일하게 FY1 한 쌍

`handleFetch` 와 Reset 핸들러에서 초기화.

### 6.3 카드 UI (`ForwardMetricsCard`)
기존 3-column 그리드 (`현재가` / `Forward TTM EPS` / `Forward PER`) **아래** 에
`grid sm:grid-cols-2 gap-3 mt-3` 블록 1개 추가:
- Tile 1: 헤더 `Forward PER (연간 FY{fy0_year}E)` / `Forward PER (Annual FY{year}E)`
  - 큰 숫자 (오버라이드 적용값)
  - 원본 ratio 표시 + 수동 수정됨 표기
  - `Input` 으로 오버라이드 + dirty 시 Reset 버튼
  - 서브라벨: `Forward EPS (FY{year}E): {fmtNumber(forward_eps_fy0)}`
- Tile 2: FY+1 동일 구성
- 어느 한 쪽이라도 데이터 없으면 dashed border + "연간 컨센서스 없음 / Annual consensus unavailable"

Composition 표 아래에 **Annual Estimates 미니 테이블**:
```
회계연도 | 종료일 | EPS | 제공자 | 애널리스트 수
```
`annual_estimates` 가 빈 배열이면 섹션 자체 숨김.

### 6.4 오버라이드 직렬화
`buildForwardMetricsOverride` 가 다음 키를 병합:
- `forward_pe_fy0`: dirty + parsed > 0 + 원본과 ≥ 1e-9 차이일 때
- `forward_pe_fy1`: 동일 조건
기존 `forward_pe` 오버라이드 로직은 그대로.

스냅샷 저장(`buildDataSandboxOverrideSnapshot`)도 동일하게 두 키 포함.

---

## 7. i18n (`app/frontend/src/lib/language-preferences.ts`)

ko/en 양쪽에 신규 키:
- `forward_per_ttm_label`
- `forward_per_annual_fy0_label`
- `forward_per_annual_fy1_label`
- `forward_eps_fy0_label`
- `forward_eps_fy1_label`
- `annual_estimate_table_title`
- `annual_estimate_unavailable`
- `forward_per_card_subtitle_annual`

---

## 8. 테스트

### 8.1 단위 — `tests/test_forward_metrics.py` 확장
- FMP annual mock → `forward_pe_fy0 = current_price/eps`, FY+1 도 채워짐.
- YFinance annual mock → 동일 shape.
- 연간 provider 가 `[]` 반환 → `forward_pe_fy0/fy1` 가 None, 크래시 없음.
- 화폐 불일치 → 두 FY pe 모두 None + note.

### 8.2 신규 — `tests/test_forward_metrics_annual.py`
- requests / yfinance mock 으로 네트워크 없는 환경에서도 통과.
- `AnnualEPSEstimate` validator 동작.

### 8.3 정적 — `tests/test_forward_metrics_datasandbox_static.py` 확장
프론트 소스에 다음 문자열이 들어있는지 assert:
- `forwardPeFy0Override`
- `forwardPeFy1Override`
- `annual_estimates`
- `forward_eps_fy0`
- `forward_pe_fy0`
- 카드 라벨 i18n 키 또는 그에 해당하는 한국어/영어 문자열 1개 이상

### 8.4 에이전트 — `tests/test_forward_outlook.py` (없으면 신설)
- `ForwardMetrics` 에 FY0/FY+1 값이 있으면 `build_forward_outlook_block` 결과 dict 에
  연간 키들이 포함된다.
- 없으면 키 자체가 빠진다(or None).
- `FORWARD_OUTLOOK_SYSTEM_INSTRUCTION` 문자열에 "annual anchor" 문장이 포함된다.

---

## 9. Acceptance Criteria

1. `pytest tests/ --ignore=tests/backtesting -q` 통과.
2. `cd app/frontend && node ./node_modules/typescript/bin/tsc && node ./node_modules/vite/bin/vite.js build`
   둘 다 성공. (로컬 npm/node 없으면 CLAUDE.md 에 명시된 codex-runtime 경로 사용)
3. 백엔드 로컬 기동 후 `POST /hedge-fund/fetch-metrics` 가:
   - 미국 종목(예: `MU`) → `forward_metrics.forward_pe_fy0`, `forward_pe_fy1` 가 숫자.
   - 한국 종목(예: `005930.KS`) → Naver 파싱이 성공한 경우 같은 필드 채워짐.
4. Forward PER 카드에 **TTM tile + 두 개의 연간 tile** 가 보이고, 각 tile 의 오버라이드 인풋이
   독립적으로 동작. 연간 인풋만 수정하고 분석 실행 시 valuation reasoning dump 에
   `forward_pe_fy0` / `forward_pe_fy1` 가 함께 기록됨.
5. 기존 TTM 카드 동작 / 기존 정적 테스트는 회귀 없음.

---

## 10. Do Not

- 4-분기 composition validator 변경 금지.
- `_blend_trailing_forward_pe` 가중치 변경 금지.
- `git add .` 금지 — 변경한 파일만 명시적으로 stage. 무관한 dirty 경로
  (`docs/forward_per/README.md`, `tmp/`, `docs/ui/`, `docs/agents/`) 는 그대로 둔다.
- 새 외부 의존성(npm/pypi) 추가 금지.

---

## 11. 분석 리포트 대시보드 재설계 (Analyst Report Dashboard)

목표: 현재 `종목 분석` 탭(`app/frontend/src/components/tabs/stock-search-tab.tsx`) 의 결과
출력 영역을 첨부 시안과 동일한 **6-패널 그리드 + 헤더 + 분석가 strip** 으로 재구성한다.
모든 데이터는 **기존 페이로드**(`forward_metrics`, `analyst_signals`, `financial_metrics`,
`prices`) 에서만 읽는다. 새 백엔드 API / 새 계산 로직은 만들지 않는다.

### 11.1 새 컴포넌트 트리
새 파일 `app/frontend/src/components/reports/analyst-report-dashboard.tsx` 를 만들고
기존 결과 영역에서 import 한다. 토글 없이 결과가 들어오면 곧장 이 레이아웃을 보여준다.
(기존 raw 결과 dump 는 하단 `<details>` 안으로 접어둔다 — 회귀 시 디버깅용)

내부 서브 컴포넌트 (모두 같은 파일에 inline):
- `<ReportHeader />`         : 티커·시장·섹터 · 현재가/변동률/스파크라인 · 시그널 배지 · 종합 점수 · 분석가 셀렉터 · "원문 대조" · "저장"
- `<DcfValuationCard />`     : 현재가 / 모델값 / 안전마진 / 좌(모델 적정가) 우(현재가) 막대 / FCFF·WACC·기준성장률·터미널성장률·전망기간·1주당 내재가치
- `<MultiplesCard />`        : 다음분기 EPS·analyst n · Forward vs Trailing 가로 막대 · 변화율 · **연간 FY0/FY+1 P/E 행** · LLM 코멘트 박스
- `<VerdictCard />`          : 신뢰도 원형 게이지 · 시그널 (BUY/HOLD/SELL · BULL/NEU/BEAR) · 한 문단 코멘트 · 시그널/신뢰도/베타/부채비율/이자보상/성장점수 mini-grid
- `<ThesisCard />`           : `BEAR THESIS` / `BULL THESIS` (시그널에 따라 헤더 라벨 전환) — 4개 번호 매김 bullet
- `<RiskCard />`             : 이자보상배율 / 부채비율 / 컨센서스 n / HBM 등 섹터 노출 — 2×2 mini-grid + 한 줄 요약
- `<CrossCheckCard />`       : 10개 항목 체크리스트 (5/10 progress) — 클라이언트 state, localStorage 영속.
- `<AnalystSignalStrip />`   : 하단 19명 분석가 카드 — 카테고리별로 묶고 시그널/신뢰도/점수 표기. 클릭 시 헤더의 활성 분석가 전환.

레이아웃: `grid grid-cols-3 gap-4` 두 줄(위: Valuation/Multiples/Verdict, 아래: Thesis/Risk/CrossCheck). 헤더는 위, strip 은 아래 sticky.

### 11.2 데이터 매핑 (기존 → 새 카드)
백엔드는 건드리지 않는다. 단 valuation 에이전트가 이미 `reasoning["dcf"]` 등을 내보내는지
점검하고, 빠진 키만 valuation.py 의 reasoning dump 끝에 추가한다.

| 카드 | 필요한 값 | 출처 |
|------|----------|------|
| ReportHeader 가격/변동률/스파크라인 | `prices[]` 최근 30봉 | `fetchedData.prices` |
| ReportHeader 시그널/점수 | 모든 활성 에이전트 `signal/confidence` 평균 + 다수결 | `completeResult.analyst_signals` |
| DcfValuationCard | `intrinsic_value, current_price, margin_of_safety, base_fcff, wacc, growth_rate, terminal_growth, forecast_years` | `analyst_signals.valuation_<ticker>.reasoning.dcf_analysis` |
| MultiplesCard 분기 | `forward_eps_ttm, forward_pe, composition[next_q].eps & analyst_count` | `forward_metrics` |
| MultiplesCard 연간 (신규) | `forward_pe_fy0, forward_pe_fy1, fy0_estimate, fy1_estimate` | `forward_metrics` (§3 에서 만든 필드) |
| MultiplesCard P/E 변화율 | `forward_outlook.pe_change_pct` 와 동일 계산 클라이언트에서 | 계산 inline |
| MultiplesCard 코멘트 | `forward_outlook.interpretation_hint` 가 있으면 그것, 없으면 휴리스틱 한 줄 | 계산 inline |
| VerdictCard 신뢰도/시그널 | 활성 분석가 1명 또는 전체 합의의 confidence | `analyst_signals` |
| VerdictCard 베타/부채비율/이자보상/성장점수 | 각 `financial_metrics`의 `beta`, `debt_to_equity`, `interest_coverage`, `growth_score`(없으면 N/A) | `fetchedData.metrics` |
| ThesisCard bullets | 활성 분석가 `reasoning` 텍스트의 첫 4개 bullet (`•`, `-`, 번호) | `analyst_signals[active].reasoning` |
| RiskCard 4 metrics | VerdictCard 와 동일 + 컨센서스 n (`forward_metrics.composition[consensus].analyst_count`) | 위 동일 |
| CrossCheckCard 10 항목 | 정적 리스트(아래 §11.4) + localStorage `crosscheck:{ticker}` | 클라이언트만 |
| AnalystSignalStrip | 카테고리(가치/성장/거시/행동주의/기술) × 각 에이전트의 signal/confidence | `analyst_signals` + `agents.py`(`Agent.category`) |

valuation 에이전트가 위 키들을 이미 dump 하는지 `src/agents/valuation.py` 확인 후
누락 키만 `reasoning["dcf_analysis"]` dict 에 추가. 계산은 기존 코드 재사용.

### 11.3 에이전트 카테고리
`src/data/agents.py` (또는 `app/frontend/src/data/agents.ts`) 에 카테고리 메타가 없으면
프론트엔드 상수 맵 한 개로 처리:
```ts
const AGENT_CATEGORY: Record<string, "가치"|"성장"|"거시"|"행동주의"|"기술"> = {
  aswath_damodaran: "가치", warren_buffett: "가치", ben_graham: "가치",
  peter_lynch: "성장", phil_fisher: "성장", cathie_wood: "성장",
  george_soros: "거시", ray_dalio: "거시",
  carl_icahn: "행동주의", terry_smith: "행동주의",
  william_o_neil: "기술", richard_wyckoff: "기술",
  // 나머지 18명도 채울 것
};
```
키 매핑은 `app/frontend/src/data/agents.ts` 의 `Agent.key` 와 정확히 일치해야 함.

### 11.4 Cross-check 정적 항목
```
EPS → FCFF 전환 마진/운전자본/CAPEX        | fin
EPS 급증 일시 vs 구조 개선                  | IR
부채 만기/구조/금리 비중                    | 채권
성장률 4.0% vs 사이클 평균                  | 섹터
WACC 13.6% 동종 대비                       | 비교
스플라이스 정규화 후 재계산                 | 데이터
CAPEX 사이클 가이드                        | 경영
P/E 정상화 시 디스카운트                   | 밸류
동종 DCF (SK하이닉스, 삼전)                | 동종
HBM/AI 매출 비중 25 vs 26                  | 섹그
```
- 체크 상태는 `localStorage[`crosscheck:${ticker}`]` 에 JSON 으로 저장.
- 헤더에 `n/10` 진행률.
- 체크된 항목은 strike-through + dim.

### 11.5 헤더 시그널/점수 산출
- **시그널**: 활성 분석가가 있으면 그 분석가의 `signal`. 없으면 다수결 (`bullish/neutral/bearish` 빈도). 표시 라벨은 `BUY · BULL` / `HOLD · NEU` / `SELL · BEAR`.
- **종합 점수 (SCORE NN)**: `Math.round(평균(confidence) × 100)` (0~100).

### 11.6 i18n
`app/frontend/src/lib/language-preferences.ts` 에 ko/en 키:
`report_header_save, report_header_compare_source, dcf_valuation_title, multiples_title,
verdict_title, bear_thesis_title, bull_thesis_title, risk_title, crosscheck_title,
crosscheck_progress, analyst_strip_total, view_full_consensus, signal_buy, signal_hold,
signal_sell, signal_bull, signal_neu, signal_bear`. (이미 있는 키는 재사용)

### 11.7 정적 테스트 추가
`tests/test_analyst_report_dashboard_static.py` 신설. 다음을 assert:
- `app/frontend/src/components/reports/analyst-report-dashboard.tsx` 존재.
- 다음 식별자가 소스에 포함: `DcfValuationCard`, `MultiplesCard`, `VerdictCard`,
  `ThesisCard`, `RiskCard`, `CrossCheckCard`, `AnalystSignalStrip`, `forward_pe_fy0`,
  `forward_pe_fy1`, `crosscheck:`, `AGENT_CATEGORY`.
- `stock-search-tab.tsx` 가 위 파일을 import.

### 11.8 안전장치 / 회귀 방지
- 결과 페이로드가 비어있으면 새 컴포넌트가 아닌 기존 빈상태 UI 표시.
- 활성 분석가가 분석에 포함되지 않은 경우 ThesisCard 는 "분석 데이터 없음" placeholder.
- DCF reasoning 의 일부 키가 None 이어도 카드가 깨지지 않게 모두 `value ?? "N/A"`.
- localStorage 접근은 try/catch.

---

## 12. Acceptance Criteria (v4 + 대시보드 통합)

기존 §9 1~5번 + 다음을 모두 만족:

6. `종목 분석` 탭에서 분석 실행 후 결과가 들어오면 6-패널 대시보드 + 헤더 + 분석가 strip
   이 첨부 시안과 유사한 레이아웃으로 렌더된다.
7. MultiplesCard 는 **분기 Forward** 와 **연간 FY0 / FY+1** P/E 를 동시에 보여준다.
8. CrossCheckCard 체크박스 상태는 새로고침 후에도 유지된다 (ticker 단위).
9. 분석가 strip 의 카드를 클릭하면 헤더의 활성 분석가가 바뀌고 Thesis / Verdict / Risk
   카드의 내용이 그 분석가 기준으로 갱신된다.
10. 새 정적 테스트 `tests/test_analyst_report_dashboard_static.py` 통과.
11. `pytest tests/ --ignore=tests/backtesting -q` 와 프론트 빌드 모두 통과.

---

## 13. 커밋 · 배포 (이번엔 직접 수행)

작업 완료 + 모든 테스트 + 빌드 통과 후 직접 수행한다.

### 13.1 커밋
- 변경 파일만 명시적으로 stage. `git add .` 금지.
- 무관한 dirty 경로는 보존 (`docs/forward_per/README.md`, `tmp/`, `docs/ui/`, `docs/agents/`).
- 2개 커밋으로 나눈다:
  1. `feat(forward-per): annual FY0/FY+1 forward EPS + PER`
  2. `feat(report): redesign analyst dashboard layout (6-panel grid + analyst strip)`
- 각 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 추가.

### 13.2 GitHub push
- `gh auth status` 확인. 인증 OK면 일반 push.
- `git push origin main` → `git rev-list --left-right --count origin/main...HEAD` 가 `0  0` 인지 검증.

### 13.3 서버 배포
- 로컬에서 `./deploy_aws.sh` 실행 (서버 SSH 안에서 돌리지 말 것).
- 성공 신호 3줄 (`Backend restarted.`, `✓ built in ...`, `Frontend built and copied.`) 모두 확인.
- 배포 후 smoke check:
  ```
  curl -I --max-time 10 http://54.116.99.19/hedge/
  ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
    'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
  ```
- 서버 HEAD 가 방금 푼 커밋 sha 와 같은지 확인.

### 13.4 보고
보고에 포함:
- 두 커밋의 sha
- 서버 HEAD sha
- `pytest` 요약 라인
- `tsc` / `vite build` 성공 여부
- `curl` 200 응답 여부
- 대시보드 레이아웃 한 줄 묘사 (사용자가 브라우저 검증 전에 신뢰할 수 있게)
