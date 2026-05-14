# Null-Score & Data-Quality 정상화 — 상세 설계안

> Base: 현재 main (HEAD: 51b52cb 또는 이후).
> 작성 목적: 소넷이 이 문서만 보고 코드를 작성할 수 있을 만큼 상세하게
> "점수 0점/N/A 인데 보고서가 단정적 약세를 외치는" 문제를 구조적으로 잡는
> 단일 소스 오브 트루스.

---

## §0. 한 줄 요약

데이터가 부족해서 계산이 불가능한 점수 항목을 **0점으로 박지 말고
`None`(데이터 부족)으로 정직하게 표기**한다. 백엔드 집계, LLM 프롬프트,
프론트엔드 표시, 합의 신뢰도, 모두 그 `None`을 인지하고
"평가 보류"로 처리한다.

---

## §1. 증상 (실제 관측)

배포된 서버 (`http://54.116.99.19/hedge/#investor-agents`) MU 분석 보고서:

| 항목 | 표시값 | 진짜 의미 |
|---|---|---|
| 종합 점수 | 25 | 0이 두 축에서 합쳐져 결과적으로 25% 신호 |
| 활성 에이전트 | 애스워스 다모다란 (BEA 14) | DCF/성장 분석을 못 했는데 active |
| 신뢰도 | 72% 매도·약세 | 가짜 확신: 데이터 없는데 강한 약세 verdict |
| 보고서 본문 #1 | "성장 분석 점수 0점/4점: ... 제공된 성장분석 세부 N/A" | LLM이 0점을 사실처럼 인용 |
| 현재가, 안전마진 | N/A, N/A | market_cap or DCF 실패 |
| 핵심 타겟 데이터 | 비어 있음 | sidebar 가 모든 축에서 못 받음 |

같은 패턴이 **Charlie Munger 예측가능성 점수** ("예측가능성 점수 0점") 에서도
이미 보고됨.

---

## §2. 원인 정리 (5-단계 파이프라인)

### §2.1 데이터 수집 단계

**`src/agents/aswath_damodaran.py:56-74`** — `search_line_items()` 호출 시
`period` 인자를 안 넘김 → 기본값 `"ttm"` 로 빠짐.
TTM 시계열은 보통 분기 단위 5건이라 **5년 CAGR 계산이 안 됨**.

**`src/tools/api.py:975`** — `search_line_items` 디폴트:
```python
def search_line_items(..., period: str = "ttm", limit: int = 10, ...)
```

Damodaran 외에도 `period` 안 넘기는 에이전트가 다수.
Munger는 `period="annual", limit=10` 이라 비교적 안전하지만,
새로 상장되거나 한국 종목은 4년치를 못 채울 수 있음.

### §2.2 점수 계산 단계 (Hard-Zero 반환)

이 패턴이 코드 전반에 박혀 있음:

```python
# src/agents/aswath_damodaran.py
if len(metrics) < 2 and len(line_items) < 2:
    return {"score": 0, "max_score": max_score, "details": "N/A: ..."}

# src/agents/charlie_munger.py
if not usable_line_items or len(usable_line_items) < MIN_PREDICTABILITY_PERIODS:
    return {"score": 0, "details": "Insufficient data..."}
```

데이터가 없는 게 0점과 동일하게 취급됨. **이는 거짓 신호다**.

### §2.3 집계 단계

`total_score = growth["score"] + risk["score"] + relative_val["score"]`

3축 중 2축이 hard-zero 면, 점수가 5점 이하가 되고 verdict 가 bearish 로
떨어짐 → 그러나 `margin_of_safety` 자체는 `None` 이라 verdict 결정 로직은
None 분기로 빠지는데, **종합 점수와 LLM 프롬프트에는 여전히 0이 들어감**.

### §2.4 LLM 프롬프트 단계

`generate_damodaran_output()` 가 `analysis_data` 를 그대로
`json.dumps(indent=2)` 해서 LLM 에 던짐. LLM 은:
- `"score": 0, "details": "N/A..."` 을 사실처럼 본다
- 자기 narrative 에 "성장 분석 점수 0점/4점" 라는 문장을 박는다
- 자신감 있게 bearish 추론을 쓴다 (72% 신뢰도)

### §2.5 프론트엔드 표시 단계

- v5 헤더 ribbon: `compositeScore = 25` 를 큰 게이지로 노출
- target-data-sidebar: `핵심 타겟 데이터가 부족합니다` (유저 입장 정직하지만,
  같은 메시지로 다른 정보를 다 가린다)
- evidence-item: 본문에 0점 인용을 그대로 렌더 (이미 v5 phase 2 텍스트
  normalizer 가 있지만 이건 의미 normalize 가 아니라 표시 normalize 라
  잡을 수 없음)

---

## §3. 설계 원칙

### §3.1 데이터 없음 ≠ 점수 0

데이터가 부족해 계산을 못 했으면 점수는 **`None`** 으로 둔다. 0은
"계산을 했고, 그 결과가 0" 일 때만 쓴다.

### §3.2 부족한 데이터는 verdict 를 만들 자격이 없다

데이터 coverage 가 일정 수준 이하 (예: 효과적 max_score 의 40% 미만) 면
verdict 를 강제로 `neutral` 로 떨어뜨리고 confidence 도 50 이하로 캡한다.
유저에게 "데이터 부족 — 평가 보류" 라는 진실을 노출한다.

### §3.3 LLM 은 None 을 보고 None 을 쓰게 해야 한다

LLM 프롬프트에 박는 `analysis_data` 를 sanitize 한다:
- `score: None` → `score: "DATA_INSUFFICIENT"` 라는 문자열 토큰
- system 메시지에 "DATA_INSUFFICIENT 가 들어 있는 축은 점수로 결론짓지 말고
  데이터 부족을 이유로 보류한다고 명시" 라는 규칙 추가

### §3.4 프론트엔드는 None 을 "—" 로 그린다

`null` 점수는 빈 칸 또는 dash 로 표기. tooltip 에 데이터 부족 이유.

---

## §4. 구체 변경 — 백엔드

### §4.1 새 공용 모듈 `src/utils/agent_data_quality.py` (신규)

```python
"""에이전트 sub-analysis 점수의 data-quality 표기 표준."""
from __future__ import annotations
from typing import Any, Optional


DATA_INSUFFICIENT = "DATA_INSUFFICIENT"  # LLM 프롬프트용 sentinel


def insufficient(max_score: int, details: str, **extra: Any) -> dict[str, Any]:
    """데이터가 모자라 계산이 불가능할 때의 표준 반환값.

    score 를 None 으로 두고, data_quality 를 'insufficient' 로 박는다.
    """
    base = {
        "score": None,
        "max_score": max_score,
        "data_quality": "insufficient",
        "details": details,
    }
    base.update(extra)
    return base


def partial(score: float, max_score: int, details: str, **extra: Any) -> dict[str, Any]:
    """일부 축은 계산됐지만 일부는 None 인 케이스."""
    base = {
        "score": score,
        "max_score": max_score,
        "data_quality": "partial",
        "details": details,
    }
    base.update(extra)
    return base


def ok(score: float, max_score: int, details: str, **extra: Any) -> dict[str, Any]:
    """완전히 계산된 정상 케이스."""
    base = {
        "score": score,
        "max_score": max_score,
        "data_quality": "ok",
        "details": details,
    }
    base.update(extra)
    return base


def aggregate_scores(components: list[dict[str, Any]]) -> dict[str, Any]:
    """None 점수를 건너뛰고 effective max 로 정규화한 집계.

    Returns:
      total_score:    sum of non-None scores
      effective_max:  sum of max_scores of non-None components
      raw_max:        sum of all max_scores (including None ones)
      coverage:       effective_max / raw_max (0..1)
      normalized_pct: total_score / effective_max  (0..1) — None 면 raw_max
    """
    raw_max = sum(c.get("max_score", 0) for c in components)
    scored = [c for c in components if c.get("score") is not None]
    effective_max = sum(c.get("max_score", 0) for c in scored)
    total = sum(float(c["score"]) for c in scored)
    coverage = (effective_max / raw_max) if raw_max else 0.0
    pct = (total / effective_max) if effective_max else None
    return {
        "total_score": total,
        "effective_max": effective_max,
        "raw_max": raw_max,
        "coverage": coverage,
        "normalized_pct": pct,
    }


def sanitize_for_llm(analysis_data: dict[str, Any]) -> dict[str, Any]:
    """LLM 프롬프트에 들어가기 직전 None 점수를 명시 토큰으로 치환.

    재귀적으로 dict 트리를 훑어서 `score: None` 만 `score: DATA_INSUFFICIENT` 로,
    그리고 `details` 가 N/A 로 시작하면 한국어/영어 둘 다 명확한 표기로 정리한다.
    원본을 mutate 하지 않도록 deep copy.
    """
    import copy
    sanitized = copy.deepcopy(analysis_data)

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            if "score" in node and node["score"] is None:
                node["score"] = DATA_INSUFFICIENT
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(sanitized)
    return sanitized


def coverage_caps_signal(coverage: float, raw_signal: str, raw_confidence: float) -> tuple[str, float]:
    """Data coverage 가 낮으면 verdict 를 보류시킨다.

    coverage < 0.4   → signal = "neutral", confidence = min(raw, 40)
    coverage < 0.6   → confidence = min(raw, 60)
    else             → 그대로
    """
    if coverage < 0.4:
        return "neutral", min(raw_confidence, 40.0)
    if coverage < 0.6:
        return raw_signal, min(raw_confidence, 60.0)
    return raw_signal, raw_confidence
```

### §4.2 `src/agents/aswath_damodaran.py` 변경

**§4.2.1 line_items 수집 강화 (line 56-74)**

```python
progress.update_status(agent_id, ticker, "Fetching financial line items (annual)")
line_items_annual = search_line_items(
    ticker,
    [
        "revenue", "free_cash_flow", "ebit", "interest_expense",
        "operating_income", "capital_expenditure",
        "depreciation_and_amortization", "outstanding_shares",
        "net_income", "total_debt", "shareholders_equity",
        "cash_and_equivalents",
    ],
    end_date,
    period="annual",
    limit=8,             # 8년치 — 5-yr CAGR 안전 마진
    api_key=api_key,
)
# TTM 도 보조로 (현시점 latest snapshot)
line_items_ttm = search_line_items(
    ticker,
    [...same fields...],
    end_date,
    period="ttm",
    limit=1,
    api_key=api_key,
)
# 합쳐서 전달: annual = 기간별, ttm = latest snapshot
line_items = (line_items_ttm or []) + (line_items_annual or [])
```

**§4.2.2 `analyze_growth_and_reinvestment` 변경 (line 161-219)**

```python
from src.utils.agent_data_quality import insufficient, ok, partial

def analyze_growth_and_reinvestment(metrics, line_items):
    max_score = 4
    if len(metrics) < 2 and len(line_items) < 2:
        return insufficient(
            max_score,
            "성장 분석 보류 — 기간별 매출/현금흐름 데이터가 2개 미만이라 CAGR 계산 불가",
        )

    # ... 기존 로직 그대로 ...

    # 단, 매출 CAGR 도 FCFF 도 ROIC 도 모두 None 이면 insufficient 처리
    computed_axes = 0
    if cagr is not None: computed_axes += 1
    if len(fcfs) >= 2:   computed_axes += 1
    if roic is not None: computed_axes += 1

    if computed_axes == 0:
        return insufficient(max_score, "성장 분석 보류 — 매출 CAGR, FCFF 증감, ROIC 모두 산출 불가")

    if computed_axes < 3:
        return partial(score, max_score, "; ".join(details))
    return ok(score, max_score, "; ".join(details))
```

**§4.2.3 `analyze_risk_profile` 변경 (line 222-289)**

기존:
```python
if not metrics and not line_items:
    return {"score": 0, ...}
```
→
```python
if not metrics and not line_items:
    return insufficient(max_score, "위험 지표 보류 — Beta, D/E, Interest Coverage 모두 부재")
```

또한 함수 끝에서:
```python
computed = sum(1 for k in ("beta_computed", "dte_computed", "cov_computed") if locals().get(k))
if computed == 0:
    return insufficient(max_score, "; ".join(details))
return partial(score, max_score, "; ".join(details)) if computed < 3 else ok(score, max_score, "; ".join(details))
```

**§4.2.4 `analyze_relative_valuation` 변경 (line 292-317)**

기존 두 줄:
```python
if not metrics or len(metrics) < 5:
    return {"score": 0, "max_score": max_score, "details": "Insufficient P/E history"}
...
if len(pes) < 5:
    return {"score": 0, "max_score": max_score, "details": "P/E data sparse"}
```
→
```python
if not metrics or len(metrics) < 5:
    return insufficient(max_score, "상대 P/E 비교 보류 — 5년치 P/E 이력 부족")
...
if len(pes) < 5:
    return insufficient(max_score, "상대 P/E 비교 보류 — P/E 유효값이 5개 미만")
```

**§4.2.5 `total_score` 집계 변경 (line 98-103)**

```python
from src.utils.agent_data_quality import aggregate_scores, coverage_caps_signal

components = [growth_analysis, risk_analysis, relative_val_analysis]
agg = aggregate_scores(components)
total_score = agg["total_score"]
max_score = agg["effective_max"]
coverage = agg["coverage"]
raw_max = agg["raw_max"]
```

`analysis_data[ticker]` 에 `"data_coverage": coverage, "raw_max_score": raw_max` 추가.

**§4.2.6 verdict & confidence 캡 (line 110-116)**

기존:
```python
if margin_of_safety >= 0.25: signal = "bullish"
elif margin_of_safety <= -0.25: signal = "bearish"
else: signal = "neutral"
```
→ verdict 계산 후 LLM 결과 처리 직전:

```python
# LLM 응답 후
raw_signal = damodaran_output.signal
raw_conf   = damodaran_output.confidence
signal, confidence = coverage_caps_signal(coverage, raw_signal, raw_conf)
damodaran_output.signal = signal
damodaran_output.confidence = confidence
if coverage < 0.4 and "데이터 부족" not in damodaran_output.reasoning:
    damodaran_output.reasoning = (
        f"[데이터 커버리지 {coverage:.0%}] 핵심 축이 결측되어 정량 결론을 보류하고 중립으로 조정함.\n\n"
        + damodaran_output.reasoning
    )
```

**§4.2.7 LLM 프롬프트 sanitize (line 453-457)**

```python
from src.utils.agent_data_quality import sanitize_for_llm

prompt = template.invoke({
    "analysis_data": json.dumps(sanitize_for_llm(analysis_data), indent=2, ensure_ascii=False),
    ...
})
```

System 메시지에 다음 한 줄 추가:

```
- `score` 값이 `"DATA_INSUFFICIENT"` 인 항목은 점수를 인용하지 말고
  "데이터 부족으로 평가 보류" 라고 명시한다. 그 축을 근거로 단정적
  매수/매도 판단을 하지 않는다.
```

### §4.3 `src/agents/charlie_munger.py` 변경

같은 패턴을 모든 sub-analysis 함수에 적용:

| 함수 | 라인 | hard-zero 위치 | 변경 |
|---|---|---|---|
| `analyze_predictability` | 486-615 | line 501-505 (`if len(usable) < 4: score=0`) | `insufficient(10, "예측가능성 보류 — 4년 미만 ...")` |
| `analyze_moat_strength` | (찾을 것) | "score": 0 returns | `insufficient(...)` |
| `analyze_management_quality` | (찾을 것) | 동일 | 동일 |
| `calculate_munger_valuation` | 618- | score=0 분기 | 동일 |

`compute_confidence` (line 829-) 도 None 안전:
```python
pred = (analysis.get("predictability_analysis") or {}).get("score")
moat = (analysis.get("moat_analysis") or {}).get("score")
mgmt = (analysis.get("management_analysis") or {}).get("score")
val  = (analysis.get("valuation_analysis") or {}).get("score")
# None 인 축은 가중치 재배분
weights = {"moat": 0.35, "mgmt": 0.25, "pred": 0.25, "val": 0.15}
available = {k: v for k, v in {"moat": moat, "mgmt": mgmt, "pred": pred, "val": val}.items() if v is not None}
if not available:
    return 30  # 모든 축 결측 — 매우 낮은 신뢰도
total_w = sum(weights[k] for k in available)
quality = sum(weights[k] * float(available[k]) / total_w for k in available)
# ...
```

`make_munger_facts_bundle` (line 772-) 변경:
```python
pred_score = pred.get("score")  # ← _r(...) or 0 제거
...
"예측가능성 점수": _score_text(pred_score) if pred_score is not None else "데이터 부족 (평가 보류)",
```

`_score_text` 도 None safe:
```python
def _score_text(value):
    if value is None: return "데이터 부족"
    return f"{value}점"
```

`make_munger_facts_bundle` 의 `"핵심 체크"` 블록에서 `predictable` 도 None 안전:
```python
predictable_flag = pred_score is not None and pred_score >= 7
"예측가능성": _status_text(predictable_flag, "높음", "낮음") if pred_score is not None else "보류",
```

### §4.4 다른 에이전트 (스트레치 — 같은 패치 패턴)

다음 파일에 같은 `insufficient(...)` 변환을 적용. **이번 라운드 필수**는
damodaran + munger 만. 나머지는 별도 PR 권장:

- `src/agents/warren_buffett.py`
- `src/agents/ben_graham.py`
- `src/agents/peter_lynch.py`
- `src/agents/phil_fisher.py`
- `src/agents/mohnish_pabrai.py`
- `src/agents/stanley_druckenmiller.py`
- `src/agents/cathie_wood.py`
- `src/agents/bill_ackman.py`
- `src/agents/rakesh_jhunjhunwala.py`
- `src/agents/nassim_taleb.py`

### §4.5 `src/utils/llm.py` — verdict-level coverage guard (선택)

`call_llm` 결과 후처리에 옵션으로 coverage 캡을 걸 수 있지만,
중앙화는 복잡도가 높아 보류. 에이전트별로 `coverage_caps_signal` 호출.

---

## §5. 구체 변경 — 프론트엔드

### §5.1 `app/frontend/src/components/reports/analyst-report-v5/types.ts`

```ts
export interface AnalystSignalReport {
  // 기존
  signal?: string;
  confidence?: number;
  reasoning?: string;
  // 신규
  data_coverage?: number | null;     // 0..1
  raw_max_score?: number | null;
}
```

### §5.2 `app/frontend/src/components/reports/analyst-report-v5/helpers.ts`

신규 헬퍼:

```ts
export function isInsufficient(score: number | null | undefined): boolean {
  return score === null || score === undefined;
}

export function formatScoreOrDash(score: number | null | undefined): string {
  if (isInsufficient(score)) return '—';
  return String(score);
}

export function dataCoverageLabel(coverage: number | null | undefined, language: ReportLanguage): string {
  if (coverage === null || coverage === undefined) return '';
  const pct = Math.round(coverage * 100);
  return language === 'ko'
    ? `데이터 충실도 ${pct}%`
    : `Data coverage ${pct}%`;
}
```

`extractTargetTiles` 와 `buildCanonicalMetrics` 에서 `null` 값은 tile 생성에서 제외 (이미 그렇지만, "0" 도 데이터로 처리하던 분기 제거).

### §5.3 `report-header-ribbon.tsx`

신뢰도 배지 옆에 **데이터 충실도** 칩 추가:

```tsx
{report?.data_coverage !== undefined && report.data_coverage !== null && (
  <Badge variant="outline" className={cn(
    'text-[10px] px-1 py-0',
    report.data_coverage < 0.4 ? 'border-red-500/40 text-red-600' :
    report.data_coverage < 0.6 ? 'border-amber-500/40 text-amber-600' :
    'border-emerald-500/40 text-emerald-600',
  )}>
    {dataCoverageLabel(report.data_coverage, language)}
  </Badge>
)}
```

또한 coverage < 0.4 일 때 composite score 게이지에 회색 점선 stroke 와
"보류" 캡션을 추가.

### §5.4 `report-body.tsx` 및 `evidence-item.tsx`

본문 텍스트에서 `0점/4점` 또는 `0점/10점` 패턴을 LLM 이 만들었어도
사용자에게 "데이터 부족" 으로 보이게 inline-data-chip 의 토큰 정규화에
다음 규칙 추가:

`financial-text-normalizer.ts` 확장:
```ts
// 점수 0점/N점 + 동반된 N/A 또는 '부족' 키워드 → "데이터 부족"
const ZERO_SCORE_WITH_NA_RE = /(\d+점)?\s*[\/／]\s*(\d+점)?\s*(?:[:：])?\s*([^.]*?)\b(N\/A|부족|보류|insufficient)\b/gi;
// → "데이터 부족 — 평가 보류"
```

단, 너무 광범위하게 잡으면 정상 텍스트까지 망가지므로 **score: DATA_INSUFFICIENT**
가 LLM 프롬프트에 들어가 LLM 이 직접 "보류" 라고 쓰게 만드는 §4 의 방식이
더 안전하다. 프론트 normalizer 는 backup safety net.

### §5.5 `target-data-sidebar.tsx`

`extractTargetTiles` 가 null 만 받았을 때의 빈 상태 메시지를 강화:

```tsx
{tiles.length === 0 && (
  <div className="rounded-lg border border-dashed p-4 text-center text-[11px] text-muted-foreground">
    {report?.data_coverage !== undefined && report.data_coverage !== null && report.data_coverage < 0.4
      ? t('targetDataCoverageLow', language)   // 신규 키
      : t('targetDataEmpty', language)}
  </div>
)}
```

### §5.6 `stock-search-tab.tsx` — `calculateCompositeScore` 정규화

null 점수는 평균에서 제외하고 effective max 로 재정규화:

```ts
export function calculateCompositeScore(analystSignals, ticker, decision) {
  const reports = getTickerAnalystReports(analystSignals, ticker);
  const validScores = reports
    .map(r => Number(r.confidence))
    .filter(n => Number.isFinite(n));
  if (validScores.length === 0) return 50;
  const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  return Math.round(avg);
}
```

(이미 비슷할 수 있음 — 확인 후 미세 조정만)

---

## §6. i18n 키 (`language-preferences.ts` 추가)

```ts
// Data Quality
dataInsufficient: '데이터 부족' / 'Insufficient data',
scoreOnHold:      '평가 보류' / 'Score on hold',
dataCoverageLabel:'데이터 충실도 {pct}%' / 'Data coverage {pct}%',
nullScoreTooltip: '이 항목은 원천 데이터가 부족해 점수를 계산하지 않았습니다.' /
                  'This axis was not scored because the underlying data is insufficient.',
targetDataCoverageLow: '데이터 커버리지가 낮아 핵심 타겟을 보류했습니다.' /
                       'Target data is on hold due to low coverage.',
verdictOnHold:    '판단 보류' / 'Verdict on hold',
```

---

## §7. 테스트 계획

### §7.1 신규 unit — `tests/test_agent_data_quality.py`

```python
from src.utils.agent_data_quality import (
    insufficient, partial, ok, aggregate_scores,
    sanitize_for_llm, coverage_caps_signal, DATA_INSUFFICIENT,
)

def test_insufficient_returns_none_score():
    r = insufficient(4, "no data")
    assert r["score"] is None
    assert r["max_score"] == 4
    assert r["data_quality"] == "insufficient"

def test_aggregate_skips_none_scores():
    comps = [
        insufficient(4, "x"),
        ok(2, 3, "y"),
        ok(1, 1, "z"),
    ]
    agg = aggregate_scores(comps)
    assert agg["total_score"] == 3
    assert agg["effective_max"] == 4
    assert agg["raw_max"] == 8
    assert agg["coverage"] == 0.5
    assert agg["normalized_pct"] == 0.75

def test_sanitize_replaces_none_with_token():
    src = {"a": {"score": None, "details": "..."}, "b": {"score": 5}}
    out = sanitize_for_llm(src)
    assert out["a"]["score"] == DATA_INSUFFICIENT
    assert out["b"]["score"] == 5
    # 원본 mutate 없는지
    assert src["a"]["score"] is None

def test_coverage_low_forces_neutral():
    s, c = coverage_caps_signal(0.2, "bearish", 80.0)
    assert s == "neutral"
    assert c == 40.0

def test_coverage_mid_caps_confidence():
    s, c = coverage_caps_signal(0.5, "bearish", 80.0)
    assert s == "bearish"
    assert c == 60.0

def test_coverage_high_passes_through():
    s, c = coverage_caps_signal(0.9, "bearish", 80.0)
    assert s == "bearish"
    assert c == 80.0
```

### §7.2 신규 unit — `tests/test_damodaran_null_score.py`

```python
def test_growth_returns_insufficient_when_no_history():
    res = analyze_growth_and_reinvestment(metrics=[], line_items=[])
    assert res["score"] is None
    assert res["data_quality"] == "insufficient"
    assert "보류" in res["details"]

def test_risk_returns_insufficient_when_empty():
    res = analyze_risk_profile(metrics=[], line_items=[])
    assert res["score"] is None
    assert "위험" in res["details"]

def test_relative_val_returns_insufficient_short_history():
    metrics = [_FakeM(pe=10)]
    res = analyze_relative_valuation(metrics)
    assert res["score"] is None
```

(`_FakeM` 은 단순 namespace; 기존 테스트 패턴 따라가기)

### §7.3 신규 unit — `tests/test_munger_null_score.py`

```python
def test_predictability_returns_none_when_insufficient():
    res = analyze_predictability([])
    assert res["score"] is None

def test_make_facts_bundle_handles_none_pred():
    analysis = {"predictability_analysis": {"score": None, "details": "..."}, ...}
    bundle = make_munger_facts_bundle(analysis)
    assert "데이터 부족" in bundle["예측가능성 점수"]
```

### §7.4 신규 static — `tests/test_data_quality_ui_static.py`

```python
def test_helpers_export_isinsufficient_and_format():
    src = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text()
    assert "isInsufficient" in src
    assert "formatScoreOrDash" in src
    assert "dataCoverageLabel" in src

def test_i18n_keys_added():
    src = (ROOT / "app/frontend/src/lib/language-preferences.ts").read_text()
    for key in ["dataInsufficient", "scoreOnHold", "dataCoverageLabel",
                "nullScoreTooltip", "verdictOnHold", "targetDataCoverageLow"]:
        assert f"{key}:" in src
```

### §7.5 기존 테스트 회귀 확인

- `tests/test_munger_facts_bundle_static.py` — `"예측가능성 점수"` 가 여전히
  존재하지만 값이 dynamic 일 수 있으므로 키 존재만 확인하는 형태인지 점검.
- `tests/test_munger_predictability_data_static.py` — `MIN_PREDICTABILITY_PERIODS`
  4 가 유지되는지 확인 (값 자체는 안 바꿈).
- `tests/test_financial_output_readability_static.py` — 0점 출력 문자열 매칭이
  있으면 "데이터 부족" 도 허용하도록 완화.

### §7.6 빌드 / 타입

```
pytest tests/ --ignore=tests/backtesting -q   → all pass
tsc --noEmit                                   → 0 errors
vite build                                     → succeeds
```

---

## §8. 수용 기준 (Acceptance Criteria)

- [ ] `src/utils/agent_data_quality.py` 신규 모듈 추가, 5개 헬퍼 export.
- [ ] `aswath_damodaran.py` 의 4개 hard-zero return 이 `insufficient(...)` 로 변경.
- [ ] `aswath_damodaran.py` 가 annual + ttm 두 번 fetch 해서 합쳐 사용.
- [ ] `aswath_damodaran.py` 의 `total_score` / `max_score` 가
      `aggregate_scores()` 로 계산되고 `data_coverage` 가 `analysis_data` 에 들어감.
- [ ] LLM 프롬프트가 `sanitize_for_llm()` 거쳐서 들어가고 system 메시지에
      `DATA_INSUFFICIENT` 규칙 추가됨.
- [ ] LLM 응답 후 `coverage_caps_signal()` 적용, coverage < 0.4 면
      neutral 로 강제, reasoning 앞에 "[데이터 커버리지 X%]" 프리픽스.
- [ ] `charlie_munger.py` 의 같은 패턴 변환 (예측가능성 + moat + management +
      valuation 4개 분석 함수).
- [ ] `make_munger_facts_bundle` 가 None 점수를 "데이터 부족" 으로 렌더.
- [ ] 프론트 `helpers.ts` 에 `isInsufficient`, `formatScoreOrDash`,
      `dataCoverageLabel` 신규 export.
- [ ] `report-header-ribbon.tsx` 가 `data_coverage` 배지를 렌더.
- [ ] `target-data-sidebar.tsx` 가 low-coverage 메시지 분기 사용.
- [ ] i18n 키 6개 ko/en 양쪽 추가.
- [ ] 새 테스트 4개 파일 (`agent_data_quality`, `damodaran_null_score`,
      `munger_null_score`, `data_quality_ui_static`) 모두 pass.
- [ ] 기존 테스트 전수 pass.
- [ ] tsc 0 error, vite build 성공.
- [ ] git push origin main (`0  0`).
- [ ] `./deploy_aws.sh` 성공, smoke check 200 OK.

---

## §9. 구현 순서 (소넷용)

1. `docs/agents/null_score_data_quality/DESIGN.md` 정독.
2. `src/utils/agent_data_quality.py` 신규 작성.
3. `tests/test_agent_data_quality.py` 작성 — TDD 로 §7.1 먼저 통과시켜라.
4. `src/agents/aswath_damodaran.py` 변경 (§4.2 7개 서브섹션).
5. `tests/test_damodaran_null_score.py` 작성 → pass 확인.
6. `src/agents/charlie_munger.py` 변경 (§4.3).
7. `tests/test_munger_null_score.py` 작성 → pass 확인.
8. `app/frontend/src/components/reports/analyst-report-v5/helpers.ts` 헬퍼 추가.
9. `app/frontend/src/components/reports/analyst-report-v5/types.ts` 필드 추가.
10. `report-header-ribbon.tsx` / `target-data-sidebar.tsx` UI 변경.
11. `app/frontend/src/lib/language-preferences.ts` 키 추가 (ko + en).
12. `tests/test_data_quality_ui_static.py` 작성 → pass.
13. 기존 회귀 확인 — pytest, tsc, vite build.
14. 단일 커밋:
    ```
    fix(agents): treat insufficient data as null score, not zero

    Damodaran's growth/risk/relative-valuation and Munger's predictability/moat/
    management/valuation now return score=None plus data_quality='insufficient'
    when the underlying line_items or metrics are too sparse to compute. The
    aggregator skips null axes, normalizes by effective max, and exposes
    data_coverage on the analysis envelope. The LLM prompt is sanitized so
    DATA_INSUFFICIENT tokens replace null scores, and a coverage_caps_signal
    gate forces low-coverage analyses to neutral with reasoning prefixed by
    the coverage percentage. Frontend helpers, header ribbon, and target-data
    sidebar render '—' / '데이터 부족' instead of '0점'.

    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
    ```
15. push origin main → `0  0` 확인.
16. `./deploy_aws.sh` → smoke check.

---

## §10. 스테이지 대상 (정확한 경로 리스트)

```
src/utils/agent_data_quality.py
src/agents/aswath_damodaran.py
src/agents/charlie_munger.py
app/frontend/src/components/reports/analyst-report-v5/types.ts
app/frontend/src/components/reports/analyst-report-v5/helpers.ts
app/frontend/src/components/reports/analyst-report-v5/report-header-ribbon.tsx
app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx
app/frontend/src/lib/language-preferences.ts
tests/test_agent_data_quality.py
tests/test_damodaran_null_score.py
tests/test_munger_null_score.py
tests/test_data_quality_ui_static.py
```

`docs/`, `tmp/`, `claude.md`, `agents.md` 등 다른 dirty 파일은 **stage 금지**.

---

## §11. 위험 / 미해결

1. **다른 9개 에이전트** (warren_buffett, ben_graham, …) 는 이번 라운드에서
   건들지 않는다. 같은 패턴이라 후속 PR 에서 일괄 적용 권장.
2. **LLM 이 system 메시지를 무시하고 DATA_INSUFFICIENT 를 0 으로 해석할
   가능성** — system 메시지에 강하게 "정량 인용 금지" 명시. 그래도 모델이
   어기면 `financial-text-normalizer.ts` 의 backup 정규화가 잡는다 (§5.4).
3. **기존 저장된 분석 (saved-analyses)** 의 옛 result_data 는 여전히
   "0점" 을 포함한다. 새로 실행한 보고서만 새 동작. 옛 데이터 마이그레이션은
   불필요 (read-only 표시는 정상 동작).
4. **`compute_confidence` (Munger)** 의 가중치 재배분이 모든 축 None 일 때
   `total_w == 0` 분기로 30 을 리턴하지만, 이 케이스가 발생하면 verdict 도
   neutral 로 떨어져야 함 — `coverage_caps_signal` 이 호출되는 위치를
   놓치지 말 것.
5. **DCF (`calculate_intrinsic_value_dcf`)** 는 이미 `intrinsic_value: None`
   을 반환한다. 이 None 이 verdict 결정에 영향을 주는 곳은 line 106-108
   인데, 이미 None safe (`if intrinsic_value and market_cap`). 단, frontend
   에서 안전마진 N/A → "데이터 부족 (DCF 보류)" 로 wording 만 통일.

---

## §12. 배포 후 검증 시나리오

서버에서 실제로 MU 분석을 실행한 뒤:

1. v5 헤더 ribbon 에 **"데이터 충실도 X%"** 칩이 보이는가?
2. 데이터 부족인 축은 **"성장 분석 점수: 데이터 부족 (평가 보류)"** 처럼
   본문 텍스트에 나오는가? "0점/4점" 이 더 이상 안 보이는가?
3. coverage < 40% 면 verdict 가 **"중립"** 으로 떨어지고 신뢰도가 40% 이하인가?
4. 좌측 본문 evidence-item 들이 "0점" 을 인용하지 않는가?
5. 우측 target-data-sidebar 가 **"데이터 커버리지가 낮아 핵심 타겟을
   보류했습니다"** 로 나오는가?

원본 데이터가 충분한 종목 (예: AAPL, MSFT) 에서는 기존과 동일 동작인지
A/B 비교.
