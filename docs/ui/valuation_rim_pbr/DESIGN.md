# Valuation v2 — RIM + PBR Band 통합 설계안

> Base commit: `75f9924` (analyst-report-v5 evidence card 정리 완료 시점)
> 작성 목적: 소넷이 이 한 파일만 보고 backend (`src/agents/valuation.py`) + frontend
> (`analyst-report-v5`) 양쪽을 모두 구현할 수 있게 만든 상세 사양서.
> 운영 가설: SK하이닉스(000660.KS)처럼 **HBM CapEx 사이클을 타는 메모리 반도체** 같이,
> 순수 FCFF DCF 가 50만 원대 내재가치를 토하는 "CapEx 덫" 종목의 가치평가를
> 보완하려는 목적.

---

## §0. 한 줄 요약

기존 4개 모델(FCFF DCF · Owner Earnings · EV/EBITDA · RIM 10% weight) aggregator 에
**(1) RIM per-share 분해 출력** + **(2) PBR Band** 두 가지를 정식 패널로 노출하고,
**CapEx 비중이 큰 종목에서는 RIM/PBR 가중을 자동으로 끌어올리는 regime 로직**을 더한다.
프런트는 `analyst-report-v5` 의 Section-02 안에 **DCF · RIM · PBR Mid 3-way 비교
카드** + **PBR 밴드 thermometer** 를 추가한다.

---

## §1. 문제 정의 (왜 지금 이걸 하나)

### 1.1 CapEx 덫 (현재 시스템의 실패 모드)

- `valuation_analyst_agent` 는 `dcf_val`/`owner_val`/`ev_ebitda_val`/`rim_val` 의
  가중 평균(35/35/20/10)으로 weighted gap 을 산출 → 매수/매도 신호.
- HBM 슈퍼사이클에서 SK하이닉스는 수십조 원 CapEx 가 잡혀 **FCFF = 영업CF − CapEx
  가 일시적으로 압축**됨. `calculate_enhanced_dcf_value` 의 base_fcf 가 너무 낮게
  잡혀서 내재가치가 시가의 1/3 수준으로 찍히는 현상.
- RIM 은 이미 구현되어 있으나 (a) 가중 10%, (b) per-share 분해/근거가 reasoning
  텍스트에만 들어가서 UI 에 노출되지 않음.
- PBR 밴드는 **계산 자체가 없다**. 시클리컬 nav 기준점이 사라져 있음.

### 1.2 목표 (반드시 충족)

1. **RIM per-share** 가 valuation panel 우측 사이드바와 본문 비교 카드에 노출된다.
2. **PBR 밴드** (P10/P25/P50/P75/P90) 가 차트 + 환산 가격으로 보인다.
3. **DCF vs RIM vs PBR Mid** 의 3 모델 결과를 한 줄로 비교할 수 있는 카드가 본문
   Section-02 안에 등장한다.
4. **CapEx-heavy regime** (예: capex/revenue > 25% 또는 fcf_volatility > 0.5) 가
   감지되면 RIM/PBR 가중을 자동 상향하고, 사용자에게 "왜 비중을 옮겼는지" 한 줄로
   알려준다.
5. i18n 키는 ko + en 모두 추가, 데스크탑 우선.

### 1.3 비목표

- aggregator 의 weighted gap 로직 자체 재설계 → 다음 라운드.
- 종목별 PBR re-rating 임계값 머신러닝 → 이번엔 휴리스틱.
- Sector peer PBR 비교 → 다음 라운드. 이번엔 self-history 만.
- 모바일 < `md` 반응형 풀 최적화 → stack 만 깨지지 않게 처리.

---

## §2. 사용자 흐름 (UX 시나리오)

활성 agent = `valuation_analyst`, ticker = `000660.KS` 가정.

```
[Section-02 헤더: 밸류에이션 — DCF]
  └─ 기존 evidence cards (그대로)
  └─ SensitivityHeatmap (WACC × g)    ← 그대로
  └─ ▼ 신규: ValuationComparisonCard
        ┌─ DCF / FCFF ──┬─ RIM ──┬─ PBR Mid ─┐
        │ ₩507,057      │ ₩1,420,000 │ ₩1,680,000 │
        │ Gap −72%      │ Gap −21%   │ Gap −6%    │
        │ [bearish]     │ [bearish]  │ [neutral]  │
        └───────────────┴────────────┴────────────┘
        "왜 다를까?" expandable (regime weight + 1줄 설명)
  └─ ▼ 신규: RimDetailCard
        - 헤드라인: 1주당 RIM 내재가치 ₩1,420,000 (시가 대비 −21%)
        - Stacked bar: BV 60% | PV Excess Earnings 28% | Terminal 12%
        - Stat row: ROE 25% / Ke 10% / Spread +15% / BV growth 8%
        - "초과이익 모델은 자산(BV)을 기준으로 +초과수익만 가산하므로 CapEx
           급증기에 DCF 보다 안정적입니다." 짧은 설명
  └─ ▼ 신규: PbrBandCard
        - SVG thermometer: P10━━P25━━P50━━P75━━P90, 위에 현재 PBR 포인터
        - Sparkline: 최근 5~7y PBR 추세 + P50 가이드 라인
        - 환산 가격 칩: ₩(P25)=₩1,180k · ₩(P50)=₩1,680k · ₩(P75)=₩2,150k
        - Re-rating banner (조건부): "HBM 구조적 성장 — 상단 밴드 +25% 확장 고려"
```

---

## §3. 백엔드 변경 사양 (`src/agents/valuation.py`)

### 3.1 새 헬퍼: `calculate_residual_income_breakdown`

기존 `calculate_residual_income_value` 는 1개 스칼라만 리턴. 이걸 **분해해서 dict**
를 반환하는 새 함수를 옆에 만든다 (기존 함수는 호환을 위해 그대로 유지하고,
내부에서 새 함수의 `intrinsic_total` 을 받아쓰는 구조).

```python
def calculate_residual_income_breakdown(
    market_cap: float | None,
    net_income: float | None,
    price_to_book_ratio: float | None,
    shares_outstanding: float | None,
    book_value_growth: float = 0.03,
    cost_of_equity: float = 0.10,
    terminal_growth_rate: float = 0.03,
    num_years: int = 5,
) -> dict | None:
    """
    Returns:
      {
        "book_value": float,                # B0 (equity)
        "book_value_per_share": float | None,
        "roe_implied": float,               # ni / B0
        "cost_of_equity": float,
        "spread_roe_ke": float,             # roe_implied - cost_of_equity
        "book_value_growth": float,
        "ri_year_1": float,                 # residual income in year 1
        "present_value_ri": float,          # PV of years 1..N
        "terminal_pv_ri": float,
        "intrinsic_total": float,           # equity intrinsic (NOT discounted by MoS)
        "intrinsic_with_mos": float,        # x 0.8 (legacy parity)
        "intrinsic_per_share": float | None,
        "gap_to_market_cap": float,         # (intrinsic_with_mos - mc) / mc
      }
    Returns None when inputs insufficient (do NOT raise).
    """
```

규칙:
- `book_val = market_cap / price_to_book_ratio` (기존과 동일).
- `roe_implied = net_income / book_val` — book_val 가 0/None 이면 fallback `None` 후 함수 반환 None.
- `ri0 = net_income - cost_of_equity * book_val`. 음수면 `ri_year_1`, `present_value_ri`, `terminal_pv_ri` 모두 0 으로 두고, `intrinsic_total = book_val`, `intrinsic_with_mos = book_val * 0.8`. (현재 함수는 ri0<=0 일 때 0 반환이라 화면이 비는데, **bv 만이라도 보여줘야** 한다.)
- `present_value_ri = Σ ri0 * (1+g)^t / (1+ke)^t` for t in 1..num_years.
- `terminal_pv_ri = (ri0 * (1+g)^(N+1)) / ((ke - terminal_g) * (1+ke)^N)`.
  단 `ke <= terminal_g` 인 경우 `terminal_g = max(ke - 0.005, 0.005)` 로 클램프.
- `intrinsic_total = book_val + present_value_ri + terminal_pv_ri`.
- `intrinsic_per_share = intrinsic_with_mos / shares_outstanding` (shares 없으면 None).

### 3.2 새 헬퍼: `calculate_pbr_band`

```python
def calculate_pbr_band(
    financial_metrics: list,
    current_price: float | None,
    shares_outstanding: float | None,
    revenue_growth: float | None = None,
) -> dict | None:
    """
    Use trailing 5–7 years of price_to_book_ratio in financial_metrics (already a list
    of Annual/TTM rows). Returns:
      {
        "current_pbr": float,
        "percentiles": {"p10": .., "p25": .., "p50": .., "p75": .., "p90": ..},
        "history": [{"period": "FY24", "pbr": 1.12}, ...],   # newest first
        "bvps": float | None,                                # most_recent book_value_per_share
        "fair_price_p10": float | None,                      # bvps * P10 (등)
        "fair_price_p25": ...,
        "fair_price_p50": ...,
        "fair_price_p75": ...,
        "fair_price_p90": ...,
        "current_price": float | None,
        "position_label": "below_p25" | "p25_p50" | "p50_p75" | "above_p75",
        "rerating_note": str | None,
        "signal": "bullish" | "neutral" | "bearish",
      }
    None when fewer than 4 historical PBR points exist OR bvps None.
    """
```

규칙:
- 입력 list 에서 `m.price_to_book_ratio` 가 finite 인 행만 추출 → 최소 4 개 필요.
- 백분위는 `statistics.quantiles(method="inclusive")` 사용 — n=10 으로 잘라서 idx 0/2/4/6/8 = p10/p25/p50/p75/p90 매핑. 또는 numpy 없이 직접 보간식 구현.
- `bvps = financial_metrics[0].book_value_per_share` (없으면 `equity/shares` 로 fallback).
- `position_label` 은 current_pbr 위치로:
  - `< p25` → below_p25 → signal **bullish**
  - `p25 ~ p50` → p25_p50 → signal **neutral** (rising bias)
  - `p50 ~ p75` → p50_p75 → signal **neutral**
  - `> p75` → above_p75 → signal **bearish**
  마이너 보정: current_pbr 이 p90 위면 signal **bearish** 강화 (text only).
- `rerating_note` 조건:
  - `revenue_growth and revenue_growth > 0.20` AND `current_pbr >= p50` →
    `"HBM/구조적 성장 — 상단 밴드 +25% 확장 고려"` (i18n key 로 매핑).
  - 그 외 None.

### 3.3 새 헬퍼: `detect_capex_regime`

```python
def detect_capex_regime(
    capex: float | None,
    revenue: float | None,
    fcf_history: list[float],
) -> str:
    """Returns 'capex_heavy' | 'default'."""
    capex_ratio = (abs(capex or 0) / revenue) if revenue and revenue > 0 else 0
    vol = calculate_fcf_volatility(fcf_history) if fcf_history else 0
    if capex_ratio >= 0.25 or vol >= 0.5:
        return "capex_heavy"
    return "default"
```

### 3.4 aggregator 가중치 재정의

`valuation_analyst_agent` 안의 `method_values` 빌드 로직을 regime 분기로 교체:

```python
regime = detect_capex_regime(li_curr.capital_expenditure, li_curr.revenue, fcf_history)
if regime == "capex_heavy":
    weights = {"dcf": 0.20, "owner_earnings": 0.25, "ev_ebitda": 0.20,
               "residual_income": 0.20, "pbr_band": 0.15}
else:
    weights = {"dcf": 0.30, "owner_earnings": 0.30, "ev_ebitda": 0.15,
               "residual_income": 0.10, "pbr_band": 0.15}
```

- PBR band 가중은 `calculate_pbr_band` 가 `None` 이면 0 으로 떨어뜨리고 나머지 비중을 비례 재분배.
- `pbr_band` 의 implied equity value = `fair_price_p50 * shares_outstanding`. 그 값을
  `method_values["pbr_band"]["value"]` 로 넣고, 기존 gap 산출에 그대로 합류.

### 3.5 reasoning 구조 (프런트 계약)

`valuation_analysis[ticker]["reasoning"]` 에 다음 키를 **추가**한다. 기존 키는 유지.

```jsonc
{
  "regime": "capex_heavy" | "default",
  "regime_note": "CapEx/매출 28%, FCF 변동성 0.62 → RIM/PBR 가중 상향",
  "rim_analysis": {
    "signal": "bullish" | "neutral" | "bearish",
    "details": "Equity intrinsic ₩… / Per-share ₩… / Gap −21% / Weight 20%",
    "book_value": 70_000_000_000_000,
    "book_value_per_share": 96000,
    "roe_implied": 0.25,
    "cost_of_equity": 0.10,
    "spread_roe_ke": 0.15,
    "book_value_growth": 0.08,
    "ri_year_1": ...,
    "present_value_ri": ...,
    "terminal_pv_ri": ...,
    "intrinsic_total": ...,
    "intrinsic_per_share": 1_420_000,
    "weight_used": 0.20
  },
  "pbr_band_analysis": {
    "signal": "neutral",
    "details": "현재 PBR 1.42x · p50 1.20x · 역사적 p50_p75 구간",
    "current_pbr": 1.42,
    "percentiles": {"p10": 0.80, "p25": 1.00, "p50": 1.20, "p75": 1.55, "p90": 2.05},
    "history": [{"period": "FY24", "pbr": 1.42}, {"period": "FY23", "pbr": 0.95}, ...],
    "bvps": 96000,
    "fair_price_p10": 76800, "fair_price_p25": 96000,
    "fair_price_p50": 115200, "fair_price_p75": 148800, "fair_price_p90": 196800,
    "current_price": 1800000,           // 1주당 통화, 환산이 어색하면 null 허용
    "position_label": "p50_p75",
    "rerating_note": "HBM/구조적 성장 — 상단 밴드 +25% 확장 고려",
    "weight_used": 0.15
  }
}
```

- 환산 가격은 모두 **현지 통화 원시 값** (USD 종목은 USD/share, KR 종목은 KRW/share, JP 종목은 JPY/share). 환산은 프런트가 책임.
- `details` 문자열은 evidence card 파서가 키워드 정규식으로 잡아낼 수 있게 기존
  KEY_NUMBER 패턴 (₩숫자, 숫자%, 숫자x) 형식 유지.

### 3.6 dcf method 의 per-share 보강

기존 reasoning 에 `dcf_analysis.details` 는 equity total 만 보였음. 다음을 추가:

```python
reasoning["dcf_analysis"]["intrinsic_per_share"] = dcf_val / shares_outstanding if shares_outstanding else None
reasoning["dcf_analysis"]["weight_used"] = weights["dcf"]
```

`owner_earnings_analysis`, `ev_ebitda_analysis` 도 같은 패턴으로 `intrinsic_per_share` + `weight_used` 추가. (프런트 ValuationComparisonCard 가 단일 포맷터로 그릴 수 있게.)

### 3.7 가드레일 (꼭 지킬 것)

- 새 헬퍼들은 **모든 입력이 None/0 일 때 None/0 으로 fail-safe 리턴**. raise 금지.
- `book_value` 산출에서 `price_to_book_ratio <= 0` 또는 `market_cap <= 0` 이면 RIM 전체 skip + reasoning 에 `rim_analysis = {"signal": "neutral", "details": "데이터 부족"}` 정도만 남긴다.
- PBR band 가 None 이면 reasoning 에 그 키 자체를 넣지 마라 (프런트가 optional chaining 으로 처리).
- `shares_outstanding` 은 `most_recent_metrics.shares_outstanding` 또는 `li_curr.outstanding_shares` 중 우선 finite 한 값.

---

## §4. 프런트엔드 변경 사양

### 4.1 새 폴더

```
app/frontend/src/components/reports/analyst-report-v5/valuation-panel/
  index.tsx                  # 외부 진입점: ValuationDeepDivePanel
  valuation-comparison.tsx   # DCF · RIM · PBR Mid 3-way 카드
  rim-detail-card.tsx        # RIM 분해 카드
  pbr-band-card.tsx          # PBR 밴드 thermometer + sparkline
  pbr-thermometer.tsx        # SVG 게이지 (subcomponent)
  utils.ts                   # 통화 포맷터, 색 토큰
  types.ts                   # local 타입 (분해 dict shape)
```

### 4.2 types.ts (frontend)

```ts
export interface RimBreakdown {
  bookValue: number;
  bookValuePerShare: number | null;
  roeImplied: number;
  costOfEquity: number;
  spreadRoeKe: number;
  bookValueGrowth: number;
  presentValueRi: number;
  terminalPvRi: number;
  intrinsicTotal: number;
  intrinsicPerShare: number | null;
  weightUsed: number;
  signal: 'bullish' | 'neutral' | 'bearish';
  details: string;
}

export interface PbrBand {
  currentPbr: number;
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  history: Array<{ period: string; pbr: number }>;
  bvps: number | null;
  fairPriceP10: number | null;
  fairPriceP25: number | null;
  fairPriceP50: number | null;
  fairPriceP75: number | null;
  fairPriceP90: number | null;
  currentPrice: number | null;
  positionLabel: 'below_p25' | 'p25_p50' | 'p50_p75' | 'above_p75';
  reratingNote: string | null;
  weightUsed: number;
  signal: 'bullish' | 'neutral' | 'bearish';
  details: string;
}

export interface ValuationDeepDive {
  regime: 'capex_heavy' | 'default';
  regimeNote: string | null;
  rim: RimBreakdown | null;
  pbr: PbrBand | null;
  models: Array<{
    key: 'dcf' | 'owner_earnings' | 'ev_ebitda' | 'residual_income' | 'pbr_band';
    labelKey: string;                  // i18n key
    intrinsicPerShare: number | null;
    intrinsicTotal: number | null;
    weight: number;
    signal: 'bullish' | 'neutral' | 'bearish';
    gapToMarket: number | null;
  }>;
}
```

### 4.3 helpers.ts 확장

`buildCanonicalMetrics` 옆에 새 export 추가 (helpers.ts 끝부분):

```ts
export function buildValuationDeepDive(
  activeReport: AgentReport | null,
  currentPrice: number | null,
): ValuationDeepDive | null;
```

규칙:
- `activeReport.reasoning` 에서 `rim_analysis` / `pbr_band_analysis` / `dcf_analysis` /
  `owner_earnings_analysis` / `ev_ebitda_analysis` 를 안전하게 파싱.
- 한 모델이라도 `intrinsic_per_share` 가 있으면 `models[]` 에 추가. 없으면 skip.
- `gapToMarket = (intrinsicPerShare - currentPrice) / currentPrice`.
- regime / regimeNote 는 `activeReport.reasoning.regime` 그대로.
- `activeReport.reasoning` 키가 통째로 없으면 (e.g. 다른 agent 활성) → return `null`.
- 순수 함수로 export. `tests/test_analyst_report_v5_static.py` 가 이 함수만 직접 호출해서 fixture 로 검증할 수 있게.

### 4.4 ValuationDeepDivePanel 위치

- `report-section.tsx` 안에서 `section.id === 'section-02'` 일 때만 렌더.
- 현재 `SensitivityHeatmap` 바로 **아래**에 mount.
- 데이터는 `report-layout.tsx` 가 `buildValuationDeepDive(activeReport, effectiveCurrentPrice)` 한 결과를 `ReportBody → ReportSection` 으로 prop drilling.
- `ReportBody` 에 `valuationDeepDive?: ValuationDeepDive | null` prop 추가.
- `ReportSection` 에도 동일 prop 추가하고 section-02 일 때만 ValuationDeepDivePanel 에 forwarding.
- panel 은 `valuationDeepDive` 가 null 이면 nothing 렌더 (정적 텍스트 metric 들에 빈 칸 노출 안 함).

### 4.5 ValuationComparisonCard 디자인

```
┌─ rounded-xl border border-border/60 bg-background p-4 shadow-sm ─────────┐
│ 헤더: "밸류에이션 모델 비교" + regime chip (capex-heavy → amber pill)      │
│ Grid: md:grid-cols-3 (모델 수에 따라 grid-cols-2..5 동적)                  │
│  ┌─ DCF / FCFF ──┐  ┌─ RIM ──┐  ┌─ PBR Mid ─┐                              │
│  │ label         │  │ label  │  │ label     │                              │
│  │ ₩값 (big)     │  │ ₩값    │  │ ₩값       │  (font-mono text-2xl)        │
│  │ Gap pill ±%   │  │ Gap    │  │ Gap       │  (bullish/bearish color)     │
│  │ 가중 N%       │  │ 가중   │  │ 가중      │  (text-[10px])               │
│  └───────────────┘  └────────┘  └───────────┘                              │
│ ▼ "왜 다를까?" expandable → regimeNote + 각 model 의 details 1 줄씩         │
└──────────────────────────────────────────────────────────────────────────┘
```

- Gap pill 색:
  - `> 0.15` → bullish (`bg-emerald-500/20 text-emerald-300 border-emerald-500/40`)
  - `< -0.15` → bearish (`bg-red-500/20 text-red-300 border-red-500/40`)
  - else → neutral (`bg-amber-500/20 text-amber-300 border-amber-500/40`)
- Gap pill 안에 `formatPercentSmart` 재사용. 색깔 토큰은 기존 evidence-item.tsx 의 tone classes 와 동일하게.

### 4.6 RimDetailCard 디자인

```
┌─ card ────────────────────────────────────────────────────────────────┐
│ 헤더: "RIM (초과이익모델) — 자산 기반 가치"                              │
│ 헤드라인: 1주당 ₩1,420,000  · vs 시가 (−21%) bear pill                  │
│ 분해 stacked bar (가로 100%, 3 colors):                                 │
│   ▓▓▓▓▓▓▓▓▓▓▓▓ BV 60%   ▒▒▒▒▒▒ Excess 28%   ░░░░ Terminal 12%          │
│   (작은 legend 글자 아래)                                               │
│ Stat grid (2x2 또는 1x4):                                               │
│   ROE 25% | Ke 10% | Spread +15% | BV growth 8%                         │
│ Footnote: "RIM 은 자산(BV)에서 출발해 +초과수익만 가산하므로 …"          │
└───────────────────────────────────────────────────────────────────────┘
```

- stacked bar 는 단순 div w/ flex:
  ```tsx
  <div className="flex h-3 rounded overflow-hidden">
    <div style={{flexBasis: `${bvPct}%`}} className="bg-sky-500" />
    <div style={{flexBasis: `${exPct}%`}} className="bg-emerald-500" />
    <div style={{flexBasis: `${tvPct}%`}} className="bg-amber-500" />
  </div>
  ```
- pct 는 `bookValue / intrinsicTotal`, `presentValueRi / intrinsicTotal`, `terminalPvRi / intrinsicTotal` 로 정규화. 음수면 0 으로 clamp.
- Spread 색: 양수 emerald, 음수 red, 0 amber.

### 4.7 PbrBandCard 디자인

```
┌─ card ────────────────────────────────────────────────────────────────┐
│ 헤더: "PBR 밴드 — 시클리컬 나침반" + 현재 PBR 1.42x pill                 │
│ thermometer (svg, w-full h-8):                                          │
│   [P10 0.80x ─── P25 1.00x ─── P50 1.20x ─── P75 1.55x ─── P90 2.05x]   │
│   gradient cool → warm. ▼ 포인터 (current_pbr 위치) + tick 라벨           │
│ 환산 가격 칩 row:                                                       │
│   ₩(P25) 96만 · ₩(P50) 115만 · ₩(P75) 149만 · ₩(P90) 197만              │
│   현재가 ₩180만 (red pill, ">P75 이상" badge)                            │
│ Sparkline (recharts 또는 순수 svg, 폭 w-full h-16):                     │
│   PBR 5~7y line + p50 dashed guide                                      │
│ 조건부 banner: 노란 박스 "HBM/구조적 성장 — 상단 밴드 +25% 확장 고려"      │
└───────────────────────────────────────────────────────────────────────┘
```

- recharts 는 이미 의존성에 있음 (확인: app/frontend/package.json → `recharts`). 만약 없으면 순수 SVG (`<polyline>`) 로 구현.
- thermometer 는 100% width SVG, x = `(pbr - p10) / (p90 - p10)` 로 위치. clamp [0, 1].
- 현재가 pill 색은 `positionLabel`:
  - `below_p25` → emerald (bullish)
  - `p25_p50` / `p50_p75` → amber (neutral)
  - `above_p75` → red (bearish)

### 4.8 통화/포맷팅

- `formatCurrency(value, currency)` 는 helpers.ts 에 이미 존재하므로 재사용. KR/JP/US 모두 처리됨.
- 한국 종목은 `₩` + `toLocaleString('ko-KR')`. 일본 종목은 `¥` + `ja-JP`. 미국은 `$` + B/M abbreviation. **PBR band 가격칩은 abbreviation 금지** (정확한 ₩ 가격이 핵심) — 별도 `formatPriceExact(value, currency)` 를 utils.ts 에 작성.
- 천 단위 구분: locale 따라 `Intl.NumberFormat` 사용.

### 4.9 i18n 키 (ko + en)

`app/frontend/src/lib/language-preferences.ts` 의 `translations.ko` 와 `translations.en` 양쪽에 추가:

| key | ko | en |
| --- | --- | --- |
| `valuationCompareTitle` | 밸류에이션 모델 비교 | Valuation models — side by side |
| `valuationCompareWhy` | 왜 다를까? | Why do they disagree? |
| `valuationRegimeCapex` | CapEx 가중 시기 — RIM/PBR 비중 상향 | CapEx-heavy regime — RIM/PBR up-weighted |
| `valuationRegimeDefault` | 일반 시기 — DCF 중심 가중 | Default regime — DCF-centric weighting |
| `valuationModelDcf` | DCF / FCFF | DCF / FCFF |
| `valuationModelOwner` | Owner Earnings | Owner Earnings |
| `valuationModelEvEbitda` | EV/EBITDA | EV/EBITDA |
| `valuationModelRim` | RIM (초과이익) | RIM (residual income) |
| `valuationModelPbrMid` | PBR Mid (P50) | PBR Mid (P50) |
| `valuationGapLabel` | 시가 대비 갭 | Gap vs market |
| `valuationWeightLabel` | 가중 | Weight |
| `rimPanelTitle` | RIM — 자산 기반 가치 | RIM — Book-value anchored |
| `rimHeadlinePerShare` | 1주당 RIM 내재가치 | RIM intrinsic / share |
| `rimCompositionBV` | 순자산 (BV) | Book value |
| `rimCompositionExcess` | 초과이익 PV | PV of excess earnings |
| `rimCompositionTerminal` | 잔여가치 | Terminal value |
| `rimStatRoe` | ROE | ROE |
| `rimStatKe` | 자기자본비용 (Ke) | Cost of equity |
| `rimStatSpread` | 스프레드 (ROE − Ke) | Spread (ROE − Ke) |
| `rimStatBvGrowth` | BV 성장률 | BV growth |
| `rimFootnote` | RIM 은 자산(BV)에서 출발해 +초과수익만 가산하므로 CapEx 급증기에 DCF 보다 안정적입니다. | RIM starts from book value and only adds excess returns, making it more stable than DCF during heavy-CapEx phases. |
| `pbrPanelTitle` | PBR 밴드 — 시클리컬 나침반 | PBR Band — Cyclical compass |
| `pbrCurrentLabel` | 현재 PBR | Current PBR |
| `pbrPercentileP10` | P10 (역사적 저점) | P10 (historical low) |
| `pbrPercentileP25` | P25 (저평가) | P25 (cheap) |
| `pbrPercentileP50` | P50 (중앙) | P50 (median) |
| `pbrPercentileP75` | P75 (고평가) | P75 (rich) |
| `pbrPercentileP90` | P90 (역사적 고점) | P90 (historical high) |
| `pbrPositionBelowP25` | 역사적 저평가 구간 | Historical cheap zone |
| `pbrPositionP25P50` | 중앙 하단 구간 | Below-median zone |
| `pbrPositionP50P75` | 중앙 상단 구간 | Above-median zone |
| `pbrPositionAboveP75` | 역사적 고평가 구간 | Historical rich zone |
| `pbrReratingBanner` | HBM/구조적 성장 — 상단 밴드 +25% 확장 고려 | HBM/structural growth — consider +25% upper-band expansion |
| `pbrPriceImpliedLabel` | 환산 가격 | Implied price |
| `pbrSparklineLabel` | 최근 PBR 추이 | Recent PBR trajectory |

### 4.10 우측 사이드바 (Target data) 영향

`extractTargetTiles` 는 그대로 두되, RIM intrinsic 이 있으면 `targetIntrinsicSubtitle` 을 동적으로 바꾸는 옵션 *없음*. 즉, 우측 사이드바 tile 의 `targetIntrinsicLabel` 은 여전히 DCF 기반. **사용자 혼란 방지를 위해 RIM 은 본문 패널에서만 노출** 하고 사이드바 변경은 다음 라운드.

---

## §5. 파일별 변경 체크리스트

### Backend

- [ ] `src/agents/valuation.py`
  - [ ] add `calculate_residual_income_breakdown`
  - [ ] add `calculate_pbr_band`
  - [ ] add `detect_capex_regime`
  - [ ] in `valuation_analyst_agent`: regime 분기 + weights 재정의 + `method_values["pbr_band"]` 합류 + reasoning 에 `regime`/`regime_note`/`rim_analysis`/`pbr_band_analysis` 풀 dict 삽입
  - [ ] dcf/owner_earnings/ev_ebitda 의 `*_analysis` 에 `intrinsic_per_share` + `weight_used` 추가
  - [ ] `shares_outstanding` 안전 추출 (`most_recent_metrics.shares_outstanding` 우선, `li_curr.outstanding_shares` fallback)

### Frontend

- [ ] `app/frontend/src/lib/language-preferences.ts` — §4.9 키 ko + en 추가
- [ ] `app/frontend/src/components/reports/analyst-report-v5/helpers.ts` — `buildValuationDeepDive` export
- [ ] `app/frontend/src/components/reports/analyst-report-v5/types.ts` — `ValuationDeepDive`, `RimBreakdown`, `PbrBand` export
- [ ] **NEW** `app/frontend/src/components/reports/analyst-report-v5/valuation-panel/` 아래 7 개 파일 (§4.1)
- [ ] `app/frontend/src/components/reports/analyst-report-v5/report-section.tsx` — `valuationDeepDive` prop 받아 section-02 에서 ValuationDeepDivePanel 렌더
- [ ] `app/frontend/src/components/reports/analyst-report-v5/report-body.tsx` — prop 전달
- [ ] `app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx` — `buildValuationDeepDive` 호출 + ReportBody 에 전달

### Tests

- [ ] `tests/test_valuation_rim_breakdown.py` (new) — fixture: 5y history, capex-heavy + default 둘 다, edge cases (ri0<0, missing pbr).
- [ ] `tests/test_valuation_pbr_band.py` (new) — fixture: 4/5/7 points history, position label 4 가지, rerating note 조건.
- [ ] `tests/test_analyst_report_v5_static.py` — extend: ValuationDeepDivePanel 의 3 카드가 mock reasoning fixture 로 렌더되는지 (presence 체크) + i18n 키 누락 없는지 (ko/en 양쪽).

---

## §6. 데이터 흐름 다이어그램

```
LangGraph SSE → analyst_signals.valuation_analyst[ticker] → CompleteResult
                                  │
                                  ▼  (in report-layout.tsx)
                          buildCanonicalMetrics(...)   ← 기존 (변경 없음)
                          buildValuationDeepDive(activeReport, currentPrice)
                                  │
                                  ▼
                          ReportBody (props 추가)
                                  │
                                  ▼
                          ReportSection (section-02 에서만)
                                  │
                                  ▼
                          ValuationDeepDivePanel
                            ├ ValuationComparisonCard
                            ├ RimDetailCard
                            └ PbrBandCard ── PbrThermometer / Sparkline
```

---

## §7. 검증 계획

### 7.1 단위 테스트 (Python)

`tests/test_valuation_rim_breakdown.py`:

```python
def test_rim_breakdown_normal_case():
    out = calculate_residual_income_breakdown(
        market_cap=120e12,         # 120조
        net_income=20e12,          # 20조
        price_to_book_ratio=1.7,
        shares_outstanding=728e6,  # 7.28억 주
        book_value_growth=0.08,
        cost_of_equity=0.10,
    )
    assert out is not None
    assert out["roe_implied"] > 0
    assert out["spread_roe_ke"] > 0
    assert out["intrinsic_per_share"] > 0
    assert "book_value" in out

def test_rim_breakdown_negative_ri():
    out = calculate_residual_income_breakdown(
        market_cap=100e12,
        net_income=1e12,          # ROE ~1%, Ke 10% → ri0 음수
        price_to_book_ratio=1.0,
        shares_outstanding=100e6,
    )
    assert out["ri_year_1"] == 0
    assert out["intrinsic_total"] == out["book_value"]

def test_rim_breakdown_missing_inputs_returns_none():
    assert calculate_residual_income_breakdown(None, 1e12, 1.0, 1e6) is None
```

`tests/test_valuation_pbr_band.py`:

```python
def test_pbr_band_basic():
    metrics = [_metric(pbr=1.42, bvps=96000), _metric(pbr=0.95), _metric(pbr=0.85),
               _metric(pbr=1.10), _metric(pbr=1.55)]
    out = calculate_pbr_band(metrics, current_price=1_800_000,
                             shares_outstanding=728e6, revenue_growth=0.25)
    assert out["position_label"] in {"p25_p50", "p50_p75"}
    assert out["fair_price_p50"] == pytest.approx(96000 * out["percentiles"]["p50"], rel=0.01)
    assert out["rerating_note"] is not None   # rev_growth 0.25 > 0.20

def test_pbr_band_insufficient_history_returns_none():
    metrics = [_metric(pbr=1.42, bvps=96000), _metric(pbr=0.95)]
    assert calculate_pbr_band(metrics, current_price=1e6, shares_outstanding=1e6) is None
```

### 7.2 정적 테스트 (Python → 프런트 import 검사)

`tests/test_analyst_report_v5_static.py` 에 추가:

```python
def test_valuation_panel_files_exist():
    base = "app/frontend/src/components/reports/analyst-report-v5/valuation-panel"
    for fname in ["index.tsx", "valuation-comparison.tsx", "rim-detail-card.tsx",
                  "pbr-band-card.tsx", "pbr-thermometer.tsx", "utils.ts", "types.ts"]:
        assert os.path.exists(f"{base}/{fname}"), fname

def test_valuation_panel_i18n_keys_present():
    with open("app/frontend/src/lib/language-preferences.ts", encoding="utf-8") as f:
        src = f.read()
    for key in ["valuationCompareTitle", "rimPanelTitle", "pbrPanelTitle",
                "pbrReratingBanner", "rimStatSpread"]:
        assert f"{key}:" in src
```

### 7.3 빌드 검증

```bash
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pytest tests/ --ignore=tests/backtesting -q
cd app/frontend
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/typescript/bin/tsc --noEmit
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/vite/bin/vite.js build
```

---

## §8. 수용 기준 (Acceptance)

소넷은 다음 체크리스트를 모두 충족했다고 응답할 때만 작업 종료.

- [ ] `valuation_analyst` agent 가 capex_heavy 종목에서 weights 를 자동 조정하고 reasoning 에 `regime` / `regime_note` 가 포함된다.
- [ ] `valuation_analyst.reasoning.rim_analysis` 에 §3.5 의 모든 키가 존재하고 `intrinsic_per_share` 가 None 또는 양수다.
- [ ] `valuation_analyst.reasoning.pbr_band_analysis` 가 (a) history >= 4 일 때 존재, (b) 없으면 키 자체 미존재.
- [ ] 프런트 Section-02 가 (a) 기존 evidence cards (b) WACC×g heatmap (c) ValuationComparisonCard (d) RimDetailCard (e) PbrBandCard 순으로 그려진다.
- [ ] 카드 3 개는 모두 활성 agent 가 `valuation_analyst` 또는 `aswath_damodaran` 일 때만 보이고, 그 외 agent (예: warren_buffett) 활성 시에는 숨겨진다.
- [ ] ko/en 토글 시 모든 새 라벨이 번역된다.
- [ ] capex-heavy fixture 로 그릴 때 regime chip 이 amber 로, regime banner 가 노출된다.
- [ ] `npm run build` 또는 동치 명령이 무경고로 통과한다.
- [ ] 새 pytest 2 개 + 기존 `test_analyst_report_v5_static.py` 추가 케이스가 통과한다.

---

## §9. 작업 순서 (소넷 Phase 1 → 2)

### Phase 1 — Backend 먼저 (한 커밋)

1. `calculate_residual_income_breakdown` 작성 + 단위 테스트.
2. `calculate_pbr_band` 작성 + 단위 테스트.
3. `detect_capex_regime` 작성.
4. `valuation_analyst_agent` 에 통합 + reasoning 출력 + dcf/owner/ev 의 `intrinsic_per_share`/`weight_used` 보강.
5. pytest 전체 그린.
6. 커밋: `feat(valuation): RIM breakdown, PBR band, CapEx-aware regime weights`.

### Phase 2 — Frontend (한 커밋)

7. i18n 키 ko + en 추가.
8. `types.ts` 신규 타입 + helpers.ts `buildValuationDeepDive`.
9. `valuation-panel/` 폴더 + 5 컴포넌트 + utils.
10. `report-section.tsx` / `report-body.tsx` / `report-layout.tsx` prop drilling.
11. `test_analyst_report_v5_static.py` 확장.
12. tsc + vite build 그린.
13. 커밋: `feat(report): valuation deep-dive panel (DCF/RIM/PBR comparison + PBR band)`.

### Phase 3 — 배포

14. `git push origin main`.
15. `./deploy_aws.sh`.
16. smoke check (curl + ssh).

---

## §10. 가드레일 / 주의사항

- `git add .` 절대 금지. 명시 stage 만.
- `docs/forward_per/`, `docs/ui/` 안의 dirty 파일은 보존.
- recharts 의존성이 없으면 순수 SVG 로 대체 (package.json 수정 금지).
- 라이브 종목 단위 검증은 SK하이닉스(`000660.KS`), 삼성전자(`005930.KS`), 마이크론(`MU`) 3 종으로 한다.
- 한국 종목 통화 단위가 *원* 인지 *백만 원* 인지 헷갈리지 마라. `most_recent_metrics.market_cap` 은 원 단위. `shares_outstanding` 도 주 단위.
- RIM 의 cost_of_equity 는 우선 0.10 고정 (TODO: WACC 와 연동은 다음 라운드).
- PBR 계산에서 음수/0 PBR 은 필터링 (적자기업 일시 PBR 왜곡).
- frontend 컴포넌트는 SSR 안전하게 — `window` 접근 금지 (useEffect 안이 아니면).

---

## §11. 향후 (Out of scope, 다음 라운드)

- Sector peer PBR/PER 비교 패널.
- RIM 의 Ke 를 WACC × leverage 로 동적 계산.
- 시클리컬 종목 자동 분류 (KOSPI 반도체 GICS code 인식).
- PBR re-rating 임계값 종목별 학습.
- 우측 Target Data sidebar 에 RIM intrinsic 토글 노출.
