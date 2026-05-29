# v10.1 — EBITDA · ROIC‑WACC 가치평가 항목 분리 추가

Base commit: `55a5992 fix(report): mount summary bar in stock header`

## 목적
`src/agents/valuation.py` 의 가중 가치평가 앙상블에 **두 개의 독립적인 가치평가 항목**을
서로 구분(各各 구분)하여 추가한다.

1. **EBITDA 정규화 가치평가 (`ebitda_valuation`)** — 사이클 보정된 정규화/포워드 EBITDA에
   타깃 멀티플을 적용한 *수익력(earnings‑power)* 관점. 기존 `ev_ebitda`(직전 실적 + 과거
   멀티플 중앙값) 와는 **별도 라인**으로 표시된다.
2. **ROIC‑WACC 초과수익 가치평가 (`roic_wacc_valuation`)** — 경제적 부가가치(EVA / Economic
   Profit) 모델. `(ROIC − WACC) × 투하자본` 의 현재가치를 투하자본에 더해 기업가치를 구하고
   순부채를 차감해 자기자본가치를 산출한다.

두 항목 모두 기존 5개 방법론(`dcf`, `owner_earnings`, `ev_ebitda`, `residual_income`,
`pbr_band`)과 **동일한 인터페이스**(`{value, weight, gap}` → `reasoning["<key>_analysis"]`)를
따른다. 기존 메서드 계산 경로·가중치 산식·테스트는 **회귀 없이 보존**한다.

> 핵심 원칙: 기존 `calculate_ev_ebitda_breakdown` / `calculate_wacc` 는 **건드리지 않고
> 재사용**한다. 신규 항목은 전부 새 헬퍼 함수 + Optional 가중치로만 추가된다.

---

## 1. 배경 — 현재 구조 요약

`valuation_analyst_agent` (src/agents/valuation.py:101) 흐름:

1. `get_financial_metrics(period="ttm", limit=8)` → `financial_metrics` (ROIC,
   `enterprise_value_to_ebitda_ratio`, `enterprise_value`, `market_cap` 등 포함, models.py:18).
2. `search_line_items([... "ebit", "ebitda", "operating_income", "total_debt",
   "cash_and_equivalents", "outstanding_shares" ...])`.
3. `calculate_wacc(...)` (valuation.py:1024) — CAPM 자기자본비용 + 이자보상 기반 부채비용,
   세후, 6~20% clamp.
4. 5개 방법론 값 산출 → `regime`(capex_heavy 여부)에 따른 `base_weights` → `weighted_gap`
   → `signal`/`confidence`.
5. 각 방법론은 `reasoning["<m>_analysis"]` dict 로 LLM·프론트에 노출.

신규 항목 2개는 (3)~(5) 사이에 삽입된다.

데이터 가용성 확인:
- `return_on_invested_capital` : `FinancialMetrics` (models.py:37). 일부 종목 None 가능.
- `enterprise_value`, `market_cap`, `total_debt`, `cash_and_equivalents` : 순부채/투하자본 계산용.
- `book_value_per_share`, `outstanding_shares` : 장부 자기자본 계산용.
- `ebitda`, `ebitda_growth`, `operating_income` : EBITDA/EVA 계산용.

---

## 2. EBITDA 정규화 가치평가 (`ebitda_valuation`)

### 2.1 기존 `ev_ebitda` 와의 구분
| 구분 | `ev_ebitda` (기존, 보존) | `ebitda_valuation` (신규) |
|------|--------------------------|---------------------------|
| EBITDA 기준 | 직전 실적 EBITDA (`EV / 현재멀티플`) | **정규화 EBITDA** (3~8기 평균에 1년 성장 반영) |
| 멀티플 | 과거 멀티플 중앙값(p75 capex) | 동일 `_select_ev_ebitda_multiple` 재사용 |
| 관점 | 사이클 현황(trailing) | 수익력/포워드(normalized) |
| 표시 | EV/EBITDA 카드 | **별도** "EBITDA 정규화" 카드 |

→ 두 항목은 같은 EBITDA 계열이지만 **trailing vs normalized** 로 명확히 분리되어,
사이클 저점/고점에서 단일 EBITDA 의 왜곡을 교차검증한다.

### 2.2 신규 헬퍼 `calculate_ebitda_valuation_breakdown`
```python
def calculate_ebitda_valuation_breakdown(
    financial_metrics: list,
    line_items: list,
    *,
    capex_heavy: bool = False,
) -> dict | None:
    """정규화 EBITDA × 사이클 타깃 멀티플 기반 자기자본가치."""
```
계산 순서:
1. `line_items` 에서 `ebitda` 시계열 수집 (None/0 제외). 비면 `financial_metrics` 의
   `enterprise_value / enterprise_value_to_ebitda_ratio` 로 현재 EBITDA 1개만 fallback.
2. **정규화 EBITDA**: 사용 가능한 EBITDA 표본(최대 8기)의 `statistics.mean`.
   표본이 1개면 그 값 그대로. (사이클 평탄화)
3. **1년 성장 반영**: `ebitda_growth`(metrics[0]) 가 유효하면
   `normalized_ebitda *= (1 + clamp(ebitda_growth, -0.30, 0.30))`. 없으면 생략.
4. **타깃 멀티플**: 기존 `_select_ev_ebitda_multiple(multiples, capex_heavy)` 재사용
   (멀티플 표본은 `enterprise_value_to_ebitda_ratio` 시계열, 기존과 동일 로직·clip).
   멀티플 표본이 없으면 현재 멀티플 사용, 그것도 없으면 `None` 반환.
5. `ev_implied = target_multiple * normalized_ebitda`.
6. `net_debt = (m0.enterprise_value or 0) - (m0.market_cap or 0)`  *(기존 EV/EBITDA 와 동일 정의)*.
7. `equity_value = max(ev_implied - net_debt, 0.0)`.

반환 dict:
```python
{
    "equity_value": float,
    "normalized_ebitda": float,
    "current_ebitda": float,
    "target_multiple": float,
    "multiple_basis": str,         # _select_ev_ebitda_multiple 의 basis
    "ebitda_growth_applied": float | None,
    "net_debt": float,
    "ebitda_sample_size": int,
}
```
- 어떤 필수 입력(`enterprise_value`)도 없으면 `None`.
- 음수 정규화 EBITDA(적자 기업) → `None` (이 항목은 가중에서 제외).

### 2.3 에이전트 통합
- `ev_breakdown` 계산 직후(valuation.py:219 근처)에:
  ```python
  ebitda_breakdown = calculate_ebitda_valuation_breakdown(
      financial_metrics, line_items, capex_heavy=regime == "capex_heavy",
  )
  ebitda_val = ebitda_breakdown["equity_value"] if ebitda_breakdown else 0
  ```

---

## 3. ROIC‑WACC 초과수익 가치평가 (`roic_wacc_valuation`)

### 3.1 모델 (Economic Value Added / Economic Profit)
```
NOPAT 근사     : ROIC × InvestedCapital
EVA_0          : (ROIC − WACC) × InvestedCapital
MVA            : Σ_{t=1..N} EVA_t / (1+WACC)^t  +  Terminal
EnterpriseValue: InvestedCapital + MVA
EquityValue    : EnterpriseValue − NetDebt
```
- 초과수익 스프레드 `(ROIC − WACC)` 가 양수면 투하자본 대비 프리미엄, 음수면 디스카운트.
  → 가치를 *파괴/창출* 하는 기업을 자연스럽게 구분.

### 3.2 신규 헬퍼 `calculate_roic_wacc_breakdown`
```python
def calculate_roic_wacc_breakdown(
    *,
    roic: float | None,
    wacc: float,
    book_value_per_share: float | None,
    shares_outstanding: float | None,
    total_debt: float | None,
    cash: float | None,
    market_cap: float | None,
    eva_growth: float | None,
    margin_of_safety: float = 0.20,
    fade_years: int = 5,
    terminal_growth: float = 0.02,
) -> dict | None:
    """ROIC−WACC 스프레드 기반 EVA 자기자본가치."""
```
계산 순서:
1. **투하자본(IC)**:
   - `book_equity = book_value_per_share * shares_outstanding` (둘 다 유효할 때).
   - `net_debt = max((total_debt or 0) - (cash or 0), 0)`.
   - `invested_capital = book_equity + net_debt`.
   - `book_equity` 산출 불가 시 `market_cap` 으로 대체하되 `ic_basis="market_proxy"` 표기.
   - IC ≤ 0 → `None`.
2. **유효성 가드**: `roic is None` → `None` (이 항목 제외). `wacc` 는 항상 존재(에이전트 보장).
3. `spread = roic - wacc`.
4. `eva_0 = spread * invested_capital`.
5. **성장 페이드**: `g = clamp(eva_growth or 0.0, -0.10, 0.10)`,
   `terminal_growth = min(terminal_growth, wacc - 0.01)`.
   - `eva_t = eva_0 * (1+g)^t`, `t=1..fade_years`.
   - `pv_eva = Σ eva_t / (1+wacc)^t`.
   - 스프레드가 양수일 때만 터미널 부여(경쟁 잠식 가정으로 보수적):
     `terminal_eva = eva_fade_last * (1+terminal_growth) / (wacc - terminal_growth)`,
     `pv_terminal = terminal_eva / (1+wacc)^fade_years`. 스프레드 ≤ 0 → 터미널 0.
   - `mva = pv_eva + pv_terminal`.
6. `enterprise_value = invested_capital + mva`.
7. `equity_value = max(enterprise_value - net_debt, 0.0) * (1 - margin_of_safety)`.

반환 dict:
```python
{
    "equity_value": float,
    "invested_capital": float,
    "ic_basis": str,            # "book" | "market_proxy"
    "roic": float,
    "wacc": float,
    "spread": float,
    "eva_0": float,
    "mva": float,
    "enterprise_value": float,
    "net_debt": float,
    "fade_growth": float,
    "terminal_growth": float,
    "margin_of_safety": float,
}
```

### 3.3 에이전트 통합
- `wacc` 산출 직후(valuation.py:189 이후), `eva_growth` 는 `operating_income_growth`
  → 없으면 `earnings_growth` → 없으면 `revenue_growth` 순으로 선택:
  ```python
  eva_growth = (
      most_recent_metrics.operating_income_growth
      or most_recent_metrics.earnings_growth
      or most_recent_metrics.revenue_growth
  )
  roic_wacc_breakdown = calculate_roic_wacc_breakdown(
      roic=most_recent_metrics.return_on_invested_capital,
      wacc=wacc,
      book_value_per_share=most_recent_metrics.book_value_per_share,
      shares_outstanding=shares_outstanding,
      total_debt=getattr(li_curr, "total_debt", None),
      cash=getattr(li_curr, "cash_and_equivalents", None),
      market_cap=most_recent_metrics.market_cap,
      eva_growth=eva_growth,
  )
  roic_wacc_val = roic_wacc_breakdown["equity_value"] if roic_wacc_breakdown else 0
  ```
  (`shares_outstanding` 는 valuation.py:225 에서 이미 계산됨 → ROIC‑WACC 블록을 그 이후로
  배치하거나, shares 계산을 WACC 직후로 끌어올린다. **권장: ROIC‑WACC 계산을 shares
  계산 직후(valuation.py:231 이후)로 배치** — 순서 변경 최소화.)

---

## 4. 가중치 통합 (`base_weights`)

기존 가중치 합은 1.00. 신규 2개 항목을 추가하면서 **기존 상대 비율 보존**을 위해
재정규화한다. valuation.py:281 의 `base_weights` 정의를 다음으로 교체:

```python
if regime == "capex_heavy":
    base_weights = {
        "dcf": 0.16, "owner_earnings": 0.20, "ev_ebitda": 0.16,
        "residual_income": 0.16, "pbr_band": 0.12,
        "ebitda_valuation": 0.10, "roic_wacc_valuation": 0.10,
    }
else:
    base_weights = {
        "dcf": 0.24, "owner_earnings": 0.24, "ev_ebitda": 0.12,
        "residual_income": 0.08, "pbr_band": 0.12,
        "ebitda_valuation": 0.10, "roic_wacc_valuation": 0.10,
    }
```
- 두 regime 모두 합 = 1.00.
- 신규 두 항목 합 = 0.20 (capex_heavy/default 동일). 검증을 위한 합계 assert 를
  테스트에 추가(§7.1).
- `pbr_band` drop 시 재분배 로직(valuation.py:302)은 **그대로 사용** — 신규 키도 자동으로
  비례 재분배 대상이 됨.

`method_values` (valuation.py:310) 에 두 줄 추가:
```python
"ebitda_valuation": {"value": ebitda_val, "weight": base_weights["ebitda_valuation"]},
"roic_wacc_valuation": {"value": roic_wacc_val, "weight": base_weights["roic_wacc_valuation"]},
```
- `value > 0` 인 항목만 `total_weight` 에 포함되는 기존 로직(valuation.py:319)을 그대로 타므로,
  데이터 부족 시 자동 제외되고 나머지 항목으로 정규화된다(별도 처리 불요).

---

## 5. reasoning 페이로드

§4 의 `method_values` 루프(valuation.py:348)가 자동으로
`reasoning["ebitda_valuation_analysis"]`, `reasoning["roic_wacc_valuation_analysis"]` 기본
dict(`signal`/`details`/`intrinsic_total`/`intrinsic_per_share`/`weight_used`/`gap_to_market`)를
생성한다. 그 직후 EV/EBITDA breakdown 보강(valuation.py:387) 패턴을 따라 상세 필드를 덧붙인다:

```python
if ebitda_breakdown and "ebitda_valuation_analysis" in reasoning:
    reasoning["ebitda_valuation_analysis"].update({
        "normalized_ebitda": ebitda_breakdown["normalized_ebitda"],
        "current_ebitda": ebitda_breakdown["current_ebitda"],
        "target_multiple": ebitda_breakdown["target_multiple"],
        "multiple_basis": ebitda_breakdown["multiple_basis"],
        "ebitda_growth_applied": ebitda_breakdown["ebitda_growth_applied"],
        "net_debt": ebitda_breakdown["net_debt"],
        "ebitda_sample_size": ebitda_breakdown["ebitda_sample_size"],
    })

if roic_wacc_breakdown and "roic_wacc_valuation_analysis" in reasoning:
    reasoning["roic_wacc_valuation_analysis"].update({
        "invested_capital": roic_wacc_breakdown["invested_capital"],
        "ic_basis": roic_wacc_breakdown["ic_basis"],
        "roic": roic_wacc_breakdown["roic"],
        "wacc": roic_wacc_breakdown["wacc"],
        "spread": roic_wacc_breakdown["spread"],
        "eva_0": roic_wacc_breakdown["eva_0"],
        "mva": roic_wacc_breakdown["mva"],
        "enterprise_value": roic_wacc_breakdown["enterprise_value"],
        "fade_growth": roic_wacc_breakdown["fade_growth"],
        "terminal_growth": roic_wacc_breakdown["terminal_growth"],
    })
```
- `_ensure_numeric_evidence_details` 가 이미 `details` 에 숫자를 보장하므로
  CONCRETE_CONCLUSION_GUIDANCE 회귀 없음.

---

## 6. 프론트엔드 (Analyst Report v5)

목표: 두 신규 항목을 valuation deep‑dive 의 **별도 카드**로 노출. 백엔드 reasoning 만 읽고
새 API 는 만들지 않는다.

### 6.1 `helpers.ts` (`buildValuationDeepDive`)
- `MODEL_LABEL_MAP` (helpers.ts:1825) 에 추가:
  ```ts
  ebitda_valuation: 'EBITDA (정규화)',
  roic_wacc_valuation: 'ROIC−WACC EVA',
  ```
- 모델 key 배열(helpers.ts:1852)에 `'ebitda_valuation'`, `'roic_wacc_valuation'` 추가.
- `ev_ebitda` 의 `evEbitdaFields` 패턴을 따라 신규 key 별 상세 필드 매핑 추가:
  - `ebitda_valuation`: `normalizedEbitda`, `currentEbitda`, `targetMultiple`,
    `multipleBasis`, `netDebt`.
  - `roic_wacc_valuation`: `investedCapital`, `roic`, `wacc`, `spread`, `eva0`, `mva`,
    `enterpriseValue`, `icBasis`.

### 6.2 `types.ts` (`ValuationModel`)
신규 Optional 필드 추가(전부 `?: number | null` / `?: string | null`):
`normalizedEbitda`, `currentEbitda`, `targetMultiple`, `multipleBasis`,
`investedCapital`, `roic`, `wacc`, `spread`, `eva0`, `mva`, `enterpriseValue`, `icBasis`.

### 6.3 `target-data-sidebar.tsx`
- `evModel` 옆에 `ebitdaModel = dive.models.find(m => m.key === 'ebitda_valuation')`,
  `evaModel = dive.models.find(m => m.key === 'roic_wacc_valuation')` 추가.
- 카드 렌더 순서: `{evCard}` 뒤에 `{ebitdaCard}` → `{evaCard}` → 기존 `{pbrCard}`/`{rimCard}`.
- 각 카드 subtitle:
  - EBITDA 정규화: `정규화 EBITDA {n} × {mult}x · 현재 {cur}` / `Normalized EBITDA …`.
  - ROIC−WACC: `ROIC {roic}% − WACC {wacc}% = 스프레드 {spread}%` / `ROIC … − WACC …`.
- 데이터 없으면 카드 자체 미표시(기존 `hasEv && …` 패턴 동일).

### 6.4 i18n (`app/frontend/src/lib/language-preferences.ts`)
ko/en 양쪽에 신규 키:
`ebitdaValuationLabel`, `ebitdaValuationSubtitle`,
`roicWaccLabel`, `roicWaccSubtitle`, `roicWaccSpreadLabel`.

---

## 7. 테스트

### 7.1 신규 — `tests/test_valuation_roic_wacc.py`
- `calculate_roic_wacc_breakdown` 단위:
  - 양(+) 스프레드(ROIC 0.18, WACC 0.10) → `equity_value > invested_capital`(MOS 전 기준
    내부 검증), `spread == pytest.approx(0.08)`.
  - 음(−) 스프레드(ROIC 0.06, WACC 0.12) → `mva < 0` 이므로
    `enterprise_value < invested_capital`. 자기자본가치가 음수로 떨어지면 `0.0` floor.
  - `roic=None` → `None`.
  - IC ≤ 0 → `None`.
  - `book_value_per_share` 없음 + `market_cap` 있음 → `ic_basis == "market_proxy"`.
- 가중치 합 검증: capex_heavy / default 모두 `sum(base_weights.values()) == pytest.approx(1.0)`
  (상수 dict 를 직접 import 하거나 에이전트 실행 후 weight_used 합으로 검증).

### 7.2 신규 — `tests/test_valuation_ebitda_normalized.py`
- `calculate_ebitda_valuation_breakdown` 단위:
  - 다년 EBITDA 평균이 정규화에 쓰임(`normalized_ebitda == mean(samples) * (1+g)`).
  - 멀티플 basis 가 `_select_ev_ebitda_multiple` 결과와 일치(median / capex p75).
  - EBITDA 표본 1개 fallback → `normalized_ebitda == current_ebitda` (성장 미적용 시).
  - 적자(정규화 EBITDA < 0) → `None`.
  - `enterprise_value` 없음 → `None`.

### 7.3 에이전트 통합 — `tests/test_valuation_ev_ebitda.py` 확장(또는 신규 파일)
기존 `test_valuation_agent_emits_ev_ebitda_breakdown` 와 동일한 monkeypatch 패턴으로:
- `reasoning["ebitda_valuation_analysis"]` 와 `reasoning["roic_wacc_valuation_analysis"]` 가
  존재하고 `intrinsic_total > 0`, 상세 필드 포함.
- 기존 `ev_ebitda_analysis` assertion 회귀 없음(두 항목 공존 확인).

### 7.4 정적 — `tests/test_valuation_roic_wacc_static.py`
프론트 소스 문자열 assert:
- `helpers.ts` 에 `roic_wacc_valuation`, `ebitda_valuation`, `investedCapital`, `spread`.
- `target-data-sidebar.tsx` 에 `ebitdaModel`, `evaModel`, `{ebitdaCard}`, `{evaCard}`.
- `types.ts` 에 `normalizedEbitda`, `investedCapital`, `spread`.
- `language-preferences.ts` 에 `roicWaccLabel`, `ebitdaValuationLabel` (ko/en 각 1회 이상).

---

## 8. Acceptance Criteria

1. `pytest tests/ --ignore=tests/backtesting -q` 통과 (신규 4개 파일 포함).
2. `cd app/frontend && node ./node_modules/typescript/bin/tsc && node ./node_modules/vite/bin/vite.js build`
   둘 다 성공.
3. `POST /hedge-fund/fetch-metrics` 또는 분석 실행 시 valuation `reasoning` 에:
   - `ebitda_valuation_analysis`, `roic_wacc_valuation_analysis` 두 블록이 **별도로** 존재.
   - 각 블록의 `weight_used` 합이 신규 0.20 배분과 일치(데이터 결손 시 재정규화 반영).
4. Analyst Report v5 사이드바에 **EV/EBITDA · EBITDA(정규화) · ROIC−WACC EVA** 세 카드가
   각각 구분되어 렌더.
5. ROIC 또는 EBITDA 데이터가 없는 종목에서도 크래시 없이 해당 카드만 빠지고 나머지 정상 동작.
6. 기존 `test_valuation_ev_ebitda.py`, `test_valuation_rim_pbr.py`,
   `test_valuation_justified_pbr.py`, `test_valuation_sensitivity_matrix.py` 회귀 없음.

---

## 9. Do Not

- `calculate_ev_ebitda_breakdown`, `calculate_wacc`, `_select_ev_ebitda_multiple`,
  `_blend_trailing_forward_pe` 의 **기존 로직 변경 금지**(재사용만).
- 기존 5개 방법론의 reasoning 키 이름/형태 변경 금지.
- 새 외부 의존성(pypi/npm) 추가 금지.
- `git add .` 금지 — 변경/신규 파일만 명시적으로 stage.
- 백엔드 신규 API/라우트 추가 금지 — reasoning 페이로드 확장만.

---

## 10. 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `src/agents/valuation.py` | 헬퍼 2개 추가, WACC 직후/네트 계산부 통합, `base_weights`·`method_values`·reasoning 확장 |
| `app/frontend/src/components/reports/analyst-report-v5/helpers.ts` | MODEL_LABEL_MAP·모델 key·상세필드 매핑 |
| `app/frontend/src/components/reports/analyst-report-v5/types.ts` | `ValuationModel` Optional 필드 |
| `app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx` | 신규 카드 2개 |
| `app/frontend/src/lib/language-preferences.ts` | i18n 키 5개 (ko/en) |
| `tests/test_valuation_roic_wacc.py` (신규) | EVA 단위 + 가중치 합 |
| `tests/test_valuation_ebitda_normalized.py` (신규) | 정규화 EBITDA 단위 |
| `tests/test_valuation_roic_wacc_static.py` (신규) | 프론트 정적 |
| `tests/test_valuation_ev_ebitda.py` (확장) | 에이전트 통합 assertion |
