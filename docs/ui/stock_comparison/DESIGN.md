# v10.1 — 종목간 비교 (Stock Comparison) 섹션

Base commit: `5c08b12 docs(valuation): design EBITDA-normalized and ROIC-WACC EVA valuation items`

## 목적
샌드박스(`data-sandbox`) · 종목 분석(`stock-search`) · 플로우(`flow`) 와 **구분되는 독립 메뉴**
"종목간 비교(Stock Comparison)" 를 신설한다. 상단 네비게이션 바(`top-bar.tsx`)의 기존 메뉴
**옆에 연결(네트워크) 아이콘**으로 진입점을 추가하고, 클릭 시 `stock-compare` 탭을 연다.

이 탭은 **3개 기업(추가 가능, 기본 3 · 최대 6)** 을 한 화면에 나란히 놓고 다음을 비교한다.

1. **가치평가 도구 결과** — 기업분석(valuation 에이전트)이 산출하는 모든 모델
   (DCF · Owner Earnings · EV/EBITDA · **EBITDA 정규화** · **ROIC−WACC EVA** · RIM · PBR Band ·
   Justified PBR)의 주당 내재가치/괴리율/시그널.
2. **재무 지표** — `fetch-metrics` 가 반환하는 핵심 재무비율(밸류에이션·수익성·성장·안정성).
3. **재무 차트** — 가격/매출/EBITDA/FCF 등 추세를 small‑multiples 또는 오버레이로.

새 백엔드 API 는 만들지 않는다. 기존 `/hedge-fund/fetch-metrics`, `/hedge-fund/run`,
`/saved-analyses` 만 사용한다. 기존 4개 탭의 동작은 **회귀 없이 보존**한다.

> v10.1 의 EBITDA·ROIC−WACC 항목(`docs/valuation/ebitda_roic_wacc/DESIGN.md`)이 구현되면
> 비교 표/카드에 두 모델이 **자동으로** 추가되도록 모델 목록을 동적으로 렌더한다.

---

## 1. 메뉴 · 탭 배선 (신규 탭 타입 `stock-compare`)

신규 탭을 추가하는 표준 체인(기존 `data-sandbox`/`saved-analyses` 패턴과 동일):

### 1.1 `src/.../contexts/tabs-context.tsx`
- `TabType` 유니온에 `'stock-compare'` 추가.
- `generateTabId` 에 단일 인스턴스 보장 케이스 추가:
  ```ts
  if (type === 'stock-compare') return 'stock-compare';
  ```
  (탭 1개만 유지 — 기존 stock-search/data-sandbox 와 동일 정책)

### 1.2 `src/services/tab-service.ts`
- `TabData['type']` 유니온에 `'stock-compare'` 추가.
- `createTabContent` switch 에 `case 'stock-compare': return createElement(StockCompareTab);`.
- `createStockCompareTab()` 추가(제목 `'Stock Comparison'`).
- `restoreTab` switch 에도 `case 'stock-compare'` 추가.
- `import { StockCompareTab } from '@/components/tabs/stock-compare-tab';`.

### 1.3 `src/components/tabs/tab-bar.tsx`
- `getTabIcon` 에 `case 'stock-compare': return <Network size={13} />;`.
- `getTabTitle` 에 `if (tab.type === 'stock-compare') return t('stockCompare', language);`.
- lucide import 에 `Network` 추가 (또는 `GitCompare`).

### 1.4 `src/components/layout/top-bar.tsx`  *(연결 아이콘 진입점)*
- `TopBarProps` 에 `onStockCompareClick: () => void;` 추가.
- lucide import 에 `Network` 추가.
- **Stock Analysis 버튼과 Saved Analyses 버튼 사이**(또는 Saved 뒤)에 새 버튼 삽입:
  ```tsx
  {/* Stock Comparison */}
  <Button
    variant="ghost"
    size="sm"
    onClick={onStockCompareClick}
    className={navButtonClass}
    aria-label="Open Stock Comparison"
    title="Stock Comparison (종목간 비교)"
  >
    <Network size={16} />
    <span className="hidden 2xl:inline">{t('stockCompare', language)}</span>
  </Button>
  ```
  → "연결 아이콘"(연결된 노드 형태의 `Network`)으로 기존 메뉴 옆에 배치.

### 1.5 `src/components/Layout.tsx`
- `handleStockCompareClick` 추가:
  ```ts
  const handleStockCompareClick = () => {
    const tabData = TabService.createStockCompareTab();
    openTab(tabData);
  };
  ```
- `<TopBar ... onStockCompareClick={handleStockCompareClick} />` 로 전달.

### 1.6 i18n (`src/lib/language-preferences.ts`)
- ko: `stockCompare: '종목간 비교'` (stockAnalysis 인근, 240 라인대).
- en: `stockCompare: 'Stock Comparison'` (772 라인대).
- 비교 화면 내부 라벨 키도 함께 추가(§4.5).

---

## 2. 데이터 흐름

새 API 없음. 입력 티커별로 기존 엔드포인트를 호출한다.

| 비교 영역 | 소스 | 비고 |
|-----------|------|------|
| 재무 지표 / 재무 차트 입력 | `POST /hedge-fund/fetch-metrics` (ticker 1개씩) | `metrics`, `forward_metrics`, `line_items`, `prices[]` 반환 |
| 가치평가 도구 결과 | `POST /hedge-fund/run` (`tickers: [t1,t2,t3]` 일괄) | `analyst_signals.valuation_analyst_agent[ticker].reasoning` |
| 저장된 분석 가져오기(선택) | `GET /saved-analyses`, `GET /saved-analyses/{id}` | 재실행 없이 비교에 투입 |

### 2.1 두 가지 투입 모드
1. **즉석 비교(Live)**: 티커 칩 입력 → 각 티커 `fetch-metrics` 병렬 호출(재무/차트) +
   선택 에이전트로 `run` 1회(가치평가). 진행률은 기존 SSE 패턴(stock-search-tab) 재사용.
2. **저장 분석 비교(Saved)**: Saved Analyses 목록에서 항목을 골라 비교 슬롯에 채움
   (네트워크 재호출 없음). 두 모드 혼합 허용.

### 2.2 가치평가 결과 파싱
프론트는 **기존 `analyst-report-v5/helpers.ts` 의 `buildValuationDeepDive(valuationReport,
currentPrice)`** 를 그대로 재사용한다. 반환된 `ValuationDeepDive.models[]` 가 곧 비교 행이
되므로, EBITDA·ROIC−WACC 신규 모델도 자동 포함된다(별도 매핑 불필요).
재무 카드/타깃 타일은 `extractTargetTiles` / `CanonicalMetrics` 헬퍼 재사용.

---

## 3. 상태 모델 (`stock-compare-tab.tsx`)

```ts
interface CompareSlot {
  id: string;                 // 슬롯 키
  ticker: string | null;      // 입력 티커
  source: 'live' | 'saved';
  status: 'empty' | 'loading' | 'ready' | 'error';
  metrics?: Record<string, any>;      // fetch-metrics.metrics
  forwardMetrics?: ForwardMetrics | null;
  prices?: PricePoint[];              // 차트용
  lineItems?: Record<string, any>[];  // 매출/EBITDA/FCF 추세
  valuation?: ValuationDeepDive | null;
  signal?: { signal: string; confidence: number } | null;
  error?: string;
}
```
- `slots: CompareSlot[]` (기본 3개, "＋ 종목 추가" 로 최대 6, 슬롯 삭제 가능).
- localStorage `stock-compare:slots` 에 티커/소스만 직렬화(콘텐츠 제외, tabs-context 패턴과 동일).
- 비교 기준 종목(`baselineSlotId`) 선택 → 괴리율/차이를 기준 대비로 강조.

---

## 4. 레이아웃 / UI

상단 컨트롤 + 3개(이상) 컬럼의 비교 보드. 모든 카드는 `value ?? 'N/A'` 가드.

### 4.1 헤더 바
- 티커 칩 입력 + "비교 실행" 버튼 + "저장 분석에서 가져오기" 드롭다운.
- 에이전트 선택(가치평가는 `valuation_analyst_agent` 기본 포함) — stock-search 재사용.
- 통화/언어 토글(기존 컨텍스트 재사용), "기준 종목" 셀렉터.

### 4.2 가치평가 비교 매트릭스 (핵심)
행 = 가치평가 모델, 열 = 종목. 셀 = 주당 내재가치 · 괴리율(색상) · 시그널 배지.
```
모델 \ 종목        |  AAPL    |  MSFT    |  GOOGL
DCF               | $x (▲12%)| $y (▼3%) | $z (▲5%)
Owner Earnings    | ...
EV/EBITDA         | ...
EBITDA (정규화)    | ...   ← v10.1 신규
ROIC−WACC EVA     | ...   ← v10.1 신규
RIM               | ...
PBR Band          | ...
Justified PBR     | ...
─────────────────────────────────────────────
가중 종합 시그널    | BUY 72  | HOLD 40  | BUY 65
```
- 모델 목록은 `models[].key` 합집합으로 **동적 생성**(누락 모델은 해당 종목 셀 N/A).
- `MODEL_LABEL_MAP`(helpers.ts) 라벨 재사용.
- 행/열 호버 하이라이트, 기준 종목 대비 우위 셀에 미세 강조.

### 4.3 재무 지표 비교 표
`fetch-metrics.metrics` 의 핵심 비율을 그룹별로:
- 밸류에이션: PER(trailing/forward) · PBR · EV/EBITDA · PSR · FCF yield
- 수익성: 영업이익률 · 순이익률 · ROE · **ROIC** · ROA
- 성장: 매출/EPS/EBITDA 성장
- 안정성: 부채비율 · 이자보상배율 · 유동비율
각 행에 종목별 값 + (기준 종목 대비 우열 화살표). 라벨은 `getFinancialFieldLabel`
(data-sandbox/metrics-grid) 재사용.

### 4.4 재무 차트 비교
- 기존 `data-sandbox/trend-charts`(lazy) 컴포넌트를 종목별로 small‑multiples 배치
  하거나, 정규화(기준=100) 오버레이 라인으로 가격/매출/EBITDA/FCF 추세 비교.
- `prices[]`(최근 N봉) + `line_items`(매출/EBITDA/FCF 시계열) 사용.
- 차트 미존재 종목은 빈 상태 placeholder.

### 4.5 i18n 키 (ko/en)
`stockCompare`, `compareAddTicker`, `compareRun`, `compareImportSaved`,
`compareBaseline`, `compareValuationMatrix`, `compareFinancials`, `compareCharts`,
`compareEmptySlot`, `compareNoData`.

---

## 5. 회귀 방지 / 안전장치
- 기존 4개 탭(`flow`/`settings`/`stock-search`/`data-sandbox`/`saved-analyses`) 의 타입·아이콘·
  핸들러는 **추가만** 하고 변경 금지.
- 슬롯이 비면 비교 보드는 빈 상태 안내만 표시(크래시 없음).
- 일부 종목 `fetch-metrics`/`run` 실패 → 해당 슬롯만 error 표시, 나머지 정상.
- `buildValuationDeepDive` 가 `null` → 그 종목 가치평가 열 전체 N/A.
- localStorage 접근은 try/catch.
- 비교 `run` 호출은 디바운스 + 중복 방지(이미 loading 인 슬롯 재요청 차단).

---

## 6. 테스트
### 6.1 정적 — `tests/test_stock_comparison_static.py` (신규)
- `app/frontend/src/components/tabs/stock-compare-tab.tsx` 존재.
- `tab-service.ts` 에 `createStockCompareTab`, `'stock-compare'` 포함.
- `tabs-context.tsx` 에 `'stock-compare'` 포함.
- `tab-bar.tsx` 에 `stock-compare` 아이콘/타이틀 분기 포함.
- `top-bar.tsx` 에 `onStockCompareClick`, `Network`(연결 아이콘), `stockCompare` 포함.
- `Layout.tsx` 에 `handleStockCompareClick`, `createStockCompareTab` 포함.
- `language-preferences.ts` 에 `stockCompare:` 가 ko/en 각 1회 이상.
- `stock-compare-tab.tsx` 가 `buildValuationDeepDive` 를 import/사용(가치평가 재사용 보장).

### 6.2 정적 — 모델 동적성 검증
- 비교 매트릭스가 `ebitda_valuation`, `roic_wacc_valuation` 키를 하드코딩으로 **제외하지
  않음**(models 합집합 렌더) 을 소스 문자열로 확인.

### 6.3 기존 정적 회귀
- `tests/test_topbar_polish_static.py`, `test_topbar_cleanup_static.py`,
  `test_tab_bar_localization_static.py` 통과(메뉴 추가가 기존 assert 를 깨지 않음).

---

## 7. Acceptance Criteria
1. `pytest tests/ --ignore=tests/backtesting -q` 통과(신규 정적 포함).
2. `cd app/frontend && node ./node_modules/typescript/bin/tsc && node ./node_modules/vite/bin/vite.js build` 성공.
3. 상단바에 기존 메뉴(플로우·샌드박스·종목분석·저장분석) **옆에 연결(Network) 아이콘**의
   "종목간 비교" 진입점이 보이고, 클릭 시 `stock-compare` 탭이 단일 인스턴스로 열린다.
4. 티커 3개 입력 후 비교 실행 시:
   - 가치평가 매트릭스에 모든 모델(EBITDA·ROIC−WACC 포함)이 행으로, 종목이 열로 표시.
   - 재무 지표 표·재무 차트가 종목별로 나란히 렌더.
5. "＋ 종목 추가" 로 4번째 이상 슬롯을 더해 비교, 슬롯 삭제도 동작.
6. 저장 분석에서 가져오기로 재실행 없이 슬롯을 채울 수 있다.
7. 일부 종목 데이터 결손/실패 시 해당 슬롯만 N/A, 전체 화면은 정상.
8. 기존 4개 탭 동작/기존 정적 테스트 회귀 없음.

---

## 8. Do Not
- 새 백엔드 API/라우트 추가 금지 — `fetch-metrics`/`run`/`saved-analyses` 재사용.
- 기존 탭 타입·아이콘·핸들러 **변경** 금지(추가만).
- 가치평가 파싱 로직 중복 구현 금지 — `buildValuationDeepDive`/`extractTargetTiles` 재사용.
- 비교 매트릭스에 모델 키 하드코딩으로 신규 모델 누락시키지 말 것(동적 합집합).
- 새 외부 의존성(npm/pypi) 추가 금지.
- `git add .` 금지 — 변경/신규 파일만 명시적으로 stage.

---

## 9. 변경 파일 요약
| 파일 | 변경 |
|------|------|
| `app/frontend/src/contexts/tabs-context.tsx` | `TabType` + `generateTabId` 케이스 |
| `app/frontend/src/services/tab-service.ts` | 타입·switch·`createStockCompareTab`·restore |
| `app/frontend/src/components/tabs/tab-bar.tsx` | 아이콘(Network)·타이틀 분기 |
| `app/frontend/src/components/layout/top-bar.tsx` | 연결 아이콘 진입 버튼 + prop |
| `app/frontend/src/components/Layout.tsx` | `handleStockCompareClick` + prop 전달 |
| `app/frontend/src/lib/language-preferences.ts` | `stockCompare` 외 비교 라벨 키(ko/en) |
| `app/frontend/src/components/tabs/stock-compare-tab.tsx` (신규) | 비교 보드(매트릭스/재무/차트) |
| `tests/test_stock_comparison_static.py` (신규) | 배선·동적 모델·재사용 정적 검증 |
