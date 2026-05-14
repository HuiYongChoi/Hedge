# 가격 나침반 바 (Price Compass Bar) — 상세 설계안

> Base: 현재 main (HEAD: d85b68d 이후)
> 작성 목적: 소넷이 이 문서만 보고 코드를 작성할 수 있을 만큼 상세하게
> 보고서 헤더 카드 바로 아래에 들어갈 "한눈에 보는 가격 좌표" 컴포넌트
> 설계를 정의한다.
>
> **v2 보강 (2026-05-14)**: §2.2 / §3.1 / §5.2 에 **연간 forward EPS · PER
> 마커 (FY0 + 최후년도 FY+N)** 를 추가. 두 마커 모두 PER 인라인 편집 가능,
> 회계년도 라벨 (예: "FY2027") 을 함께 표시.
>
> **v3 보강 (2026-05-14, 2nd pass)**: 통합 위치를 **우측 사이드바 → 본문
> 메인 영역 (헤더 카드 바로 아래, ToC/본문 그리드 위)** 으로 이동. 가로폭이
> 280px → 본문 전체 폭으로 확대됨에 따라:
>
> - **위치 이동**: `target-data-sidebar.tsx` 에서 `<PriceCompassBar />` 렌더
>   **제거**. `report-layout.tsx` 의 `<ReportHeaderRibbon />` **바로 다음**에
>   렌더. ToC sidebar + body + target sidebar 그리드 **위**.
> - **가로 풀 폭 시각 구성** (§2.1-v3): 좌측에 6마커가 일렬로 놓일 수 있을
>   만큼 넓어짐. 글리프를 `text-base → text-lg`, 마커 리스트는 lg 화면에서
>   2열 그리드 (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)로 조밀하게.
> - **첫 인상 강화**: 헤더 직후라 사용자가 "현재가 vs 내재가치 vs 컨센서스"
>   포지션을 본문 읽기 전에 1초 안에 인지하도록 함.
> - **모바일 친화**: 풀 폭 카드이므로 모바일에서도 그대로 잘 보임. 사이드바
>   레이아웃 잘림 이슈 (v2 의 핵심 문제) 가 자동 해소됨.

---

## §0. 한 줄 요약

보고서 **헤더 카드 바로 아래** (본문 그리드 위 풀 폭) 에, **하나의 수평 바
위에 서로 다른 가격 기준점(현재가 · DCF 내재가치 · 안전마진 조정가 · 증권사
목표가 · 연간 Fwd PER 함의가 FY0/FY+N · 베타 변동 밴드)을 동시에 표시**하는
"가격 나침반(Price Compass)" 컴포넌트를 추가한다. 사용자가 PER을 인라인으로
편집하면 함의가 마커가 실시간 재계산된다.

---

## §1. 현재 상태 (스크린샷 분석)

배포된 서버 (`http://54.116.99.19/hedge/#investor-agents`) GOOGL · 다모다란
보고서의 현재 레이아웃 (v3 가 채울 위치):

```
┌─────────────────────────── 분석 결과 카드 ────────────────────────────┐
│ [33점] [가치 투자] [비중 축소] [↓매도·약세] [67%]                       │
│ GOOGL · 애스워스 다모다란                                              │
│ 문서형 분석 리포트 · 숫자 칩과 출처 추적 포함                            │
│ [현재가 N/A] [안전마진 N/A] [기간·최근 분석]    [PDF] [원문 대조] [저장] │
└────────────────────────────────────────────────────────────────────────┘

★★★ ← 여기에 v3 의 Price Compass Bar 카드 (풀 폭) ★★★

┌─ 목차 ──┐  ┌─ 결론 요약 ──────────────────────────┐  ┌─ 핵심 타겟 ──┐
│ 01 결론  │  │ ↓매도·약세 (신뢰도 67%) · 결론        │  │ (데이터 부족) │
│ 02 DCF   │  │ Alphabet Inc 의 본업 ...              │  ├──────────────┤
│ ...      │  │                                       │  │ 다른 에이전트│
└──────────┘  └───────────────────────────────────────┘  └──────────────┘
```

**핵심 차이 (v2 → v3):**
- v2 는 우측 사이드바 (280px) 안 "합의 매트릭스 열기" 아래에 배치 → 사이드바
  가 짧게 잘려 사용자가 끝까지 보지 못함. 또 사용자 의도(헤더 직하)와 불일치.
- v3 는 **헤더 카드 바로 아래 본문 메인 영역 전체 폭**. 사용자 시선이 자연스
  럽게 헤더 → 가격 좌표 → 본문 으로 흐른다.

---

## §2. 컴포넌트 설계

### §2.1 시각 구성 (v3 — 헤더 카드 직하 풀 폭)

```
┌─ 가격 나침반 ───────────────────────────────────────────────────────────────────────────┐
│ GOOGL · USD                                                                        ↺ 초기화 │
│                                                                                              │
│ $480 ────────────────────●─────────────────────────────────────────────────────── $920      │
│                          ░░░░░░░░░░░░[β=1.27]░░░░░░░░░░░░                                   │
│        ▲             ★              ◆             ■                  ▣                     │
│      DCF           MoS            목표가         FY0                FY+N                    │
│                                                                                              │
│ ──────────────────────────── 마커 ───────────────────────────────────────────────────────── │
│ ● 현재가             $733.75    ▲ DCF 내재가치     $668.20  (-8.9%)   ★ 안전마진 (25%)  $501.15 │
│ ◆ 증권사 컨센서스    $820.50  (n=42)  ■ FY0 함의가 FY2026  $X (PER ▢)  ▣ FY+N FY2027 $X (PER ▢) │
│ ░ 베타 ±1σ 범위      $548 ~ $919  (β=1.27)                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**v3 시각 디자인 원칙:**
- **글리프 크기**: `text-base` (16px) → `text-lg` (18px). 좁은 사이드바가
  아니므로 시각적 가독성을 우선시.
- **마커 리스트 그리드**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1`.
  본문 폭이 충분하므로 한 줄에 2-3개 마커를 펼침. 모바일은 1열 유지.
- **헤더 우측 ↺ 초기화 버튼**: 라벨도 함께 표시 (`↺ 초기화`). 사이드바 v2 에선
  공간 부족으로 아이콘만 띄웠지만, v3 는 풀 폭이라 텍스트 라벨 표시 가능.
- **베타 밴드 두께**: `h-4` → `h-5`. 풀 폭이라 두께가 충분히 시각적으로 인지됨.
- **카드 패딩**: `p-3` → `p-4 md:p-5` (헤더 카드와 동일한 시각 무게감).
- **margin top**: `mt-3` → `mt-0` (v2 잔여). `<ReportHeaderRibbon />` 다음
  `<PriceCompassBar />` 사이의 간격은 부모 `space-y-4` 가 알아서 처리.

### §2.1b 시각 구성 (v2 — 사이드바 좁은 폭, 참고용. v3 에선 사용 X)

```
┌─ 가격 나침반 ──────────────────────────────────────┐
│ MU · USD                                           │
│                                                    │
│  $XX.XX ─────────────●─────────────────── $XX.XX  │
│   (low)        ░░░[β=1.20]░░░               (high) │
│                ▲    ◆    ■  ▣                      │
│              DCF  목표가 FY0 FY+N                   │
│                                                    │
│ ─── 마커 ────────────────────────────────────────  │
│ ● 현재가              $XX.XX                       │
│ ▲ DCF 내재가치        $XX.XX  (+XX% upside)        │
│ ★ 안전마진 매수가      $XX.XX  (intrinsic × 0.75)   │
│ ◆ 증권사 컨센서스      $XX.XX  (n=12)               │
│ ■ FY0 함의가  FY2026  $XX.XX  (PER [12.5x] × EPS)  │
│ ▣ FY+N 함의가 FY2027  $XX.XX  (PER [10.8x] × EPS)  │
│ ░ 베타 ±1σ 범위       $XX.XX ~ $XX.XX  (β=1.20)    │
└────────────────────────────────────────────────────┘
```

### §2.2 마커별 정의

| 마커 | 기호 | 색상 | 데이터 출처 |
|---|---|---|---|
| 현재가 | ● (filled circle) | white / `text-foreground` | `canonicalMetrics.currentPrice.value` |
| DCF 내재가치 | ▲ (up triangle) | bullish/bearish (vs current) | `canonicalMetrics.intrinsicValue.value` |
| 안전마진 매수가 | ★ | emerald | `intrinsic × (1 - mosBuffer)` (기본 mosBuffer=0.25) |
| 증권사 컨센서스 | ◆ (diamond) | amber | FMP `/v3/price-target-consensus` 신규 백엔드 |
| **FY0 함의가** | ■ (filled square) | sky-400 | `forwardEpsFy0 × forwardPeFy0` — 회계년도 라벨 (예: FY2026), PER 인라인 편집 |
| **FY+N 함의가** | ▣ (hollow square) | sky-300 (lighter) | `forwardEpsFy1 × forwardPeFy1` — 최후 가용 회계년도 라벨 (예: FY2027), PER 인라인 편집 |
| 베타 ±1σ 밴드 | translucent rect | yellow/30 | `currentPrice × (1 ± β × σ_market)` (σ_market=0.20) |

**"최후년도(FY+N)" 정의**: 백엔드 `forward_metrics` 가 노출하는 연간 추정치
중 `fiscal_year` 가 가장 큰 것 (현재는 FY1 까지만 fetch — `num_years=2` 기본).
미래에 `num_years=3` 으로 확장하면 FY+2 가 자동으로 furthest 로 선택됨
(§5.2 의 `pickFurthestAnnual()` 헬퍼).

**두 마커 (FY0/FY+N) 동시 표시**: PER 이 같으면 EPS 차이로, EPS 비슷하면
PER 차이로 위치가 갈리며 사용자가 "단기 vs 중장기 컨센서스" 간극을 한눈에
볼 수 있다.

### §2.3 바 스케일 계산

```ts
function computeBarRange(markers: number[]): { min: number; max: number } {
  const values = markers.filter(Number.isFinite);
  if (values.length === 0) return { min: 0, max: 100 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || hi * 0.2;
  return {
    min: Math.max(0, lo - span * 0.15),
    max: hi + span * 0.15,
  };
}
```

마커가 1개뿐이면 ±20% 폭으로 자동 확장. 마커가 0개면 컴포넌트 자체 hide.

### §2.4 PER 인라인 편집 UX (FY0 + FY+N 각각 독립)

- **FY0** 마커 옆 `<input type="number" step="0.1" min="1" max="100">`:
  - 기본값: `forwardPeFy0` (없으면 `forwardPe` trailing fallback)
  - onChange: `impliedPrice_fy0 = forwardEpsFy0 × userPer_fy0` 재계산
- **FY+N** 마커 옆 별도 `<input>`:
  - 기본값: `forwardPeFy1` (없으면 `forwardPeFy0 × 0.9` 추정치 → 미래 PER 보통 약간 낮음)
  - onChange: `impliedPrice_fyN = forwardEpsFy1 × userPer_fyN` 재계산
- 각 마커 옆 회계년도 칩 (예: `FY2026`, `FY2027`) — 작은 monospace `text-[9px]`
- "초기화" 버튼은 두 PER 모두 동시 reset (헤더 우측에 작은 ↺ 아이콘 버튼)
- 값 변경은 컴포넌트 로컬 state만 (DB 저장 X, 새로고침 시 reset)
- FY0 와 FY+N 회계년도가 **같으면** (provider 가 1년치만 줬을 때) FY+N 마커
  자체를 hide 해서 중복 표시 방지

### §2.5 베타 밴드

베타 데이터가 있으면 `currentPrice × (1 ± β × 0.20)` 범위를 반투명 사각형으로
바 위에 깔아 "현재가가 베타로 인해 1년 ±1σ 흔들릴 수 있는 폭"을 시각화.

- β=1.0, σ_market=0.20 → ±20% 범위
- β=2.0, σ_market=0.20 → ±40% 범위

색상은 `bg-yellow-500/15 border border-yellow-500/30`.

### §2.6 빈 데이터 처리

- 마커 < 1 (현재가만 있어도 표시 부족) → 컴포넌트 hide
- 베타 없으면 베타 밴드 hide (다른 마커는 표시)
- 증권사 목표가 fetch 실패 → ◆ 마커 hide, 리스트에 "데이터 없음"
- 모든 marker None → 컴포넌트 자체 hide

---

## §3. 데이터 소스

### §3.1 이미 존재하는 데이터 (`CanonicalMetrics`)

현재 (수정 전):
```ts
interface CanonicalMetrics {
  forwardEpsFy0?: CanonicalMetric;   // ■ FY0 EPS
  forwardEpsTtm?: CanonicalMetric;   // fallback
  intrinsicValue?: CanonicalMetric;  // ▲ DCF
  marginOfSafety?: CanonicalMetric;
  beta?: CanonicalMetric;            // 베타 밴드
  forwardPeFy0?: CanonicalMetric;    // ■ FY0 PER 기본값
  forwardPe?: CanonicalMetric;       // fallback
  currentPrice?: CanonicalMetric;    // ● 현재가
}
```

**§3.1.1 수정 후 — FY+N 필드 추가** (`types.ts`):

```ts
interface CanonicalMetrics {
  forwardEpsFy0?: CanonicalMetric;
  forwardEpsFy1?: CanonicalMetric;      // 신규 — ▣ FY+N EPS
  forwardEpsTtm?: CanonicalMetric;
  intrinsicValue?: CanonicalMetric;
  marginOfSafety?: CanonicalMetric;
  beta?: CanonicalMetric;
  forwardPeFy0?: CanonicalMetric;
  forwardPeFy1?: CanonicalMetric;       // 신규 — ▣ FY+N PER
  forwardPe?: CanonicalMetric;
  currentPrice?: CanonicalMetric;
  fy0FiscalYear?: number | null;        // 신규 — 예: 2026
  fy1FiscalYear?: number | null;        // 신규 — 예: 2027
}
```

**§3.1.2 백엔드 출력 확인 (`forward_outlook.py` line 118-130)**

이미 노출 중:
- `forward_pe_fy0`, `forward_eps_fy0`, `fy0_fiscal_year`, `fy0_analyst_count`, `fy0_confidence`
- `forward_pe_fy1`, `forward_eps_fy1`, `fy1_fiscal_year`, `fy1_analyst_count`, `fy1_confidence`

이 필드들이 agent report 의 `reasoning.forward_outlook` 블록에 들어가 있는지만
확인. 안 되어 있으면 `aswath_damodaran.py` 가 `forward_outlook` 을
`analysis_data[ticker]` 에 그대로 keep 하므로 frontend `readNested` 가 자동
파싱한다.

**§3.1.3 frontend `buildCanonicalMetrics` 확장 (`helpers.ts`)**

기존 `forwardEpsFy0` 와 `forwardPeFy0` 옆에 FY1 두 줄 추가:

```ts
const metrics: CanonicalMetrics = {
  forwardEpsFy0: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_eps_fy0']),
  forwardEpsFy1: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_eps_fy1']),  // 신규
  ...
  forwardPeFy0: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_pe_fy0']),
  forwardPeFy1: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_pe_fy1']),    // 신규
  ...
};
// fiscal year labels (scalar, 별도 readNested)
const fy0Year = readMetricValue(reports[activeAgentKey], ['fy0_fiscal_year']);
const fy1Year = readMetricValue(reports[activeAgentKey], ['fy1_fiscal_year']);
metrics.fy0FiscalYear = fy0Year !== null ? Math.round(fy0Year) : null;
metrics.fy1FiscalYear = fy1Year !== null ? Math.round(fy1Year) : null;
```

### §3.2 새로 추가할 데이터 — 증권사 컨센서스 목표가

**FMP `/stable/price-target-consensus?symbol=MU`** 응답 예시:
```json
[{
  "symbol": "MU",
  "targetHigh": 175,
  "targetLow": 80,
  "targetConsensus": 130,
  "targetMedian": 128
}]
```

**FMP `/stable/price-target-summary?symbol=MU`** (n=analyst count):
```json
[{
  "symbol": "MU",
  "lastMonth": 7,
  "lastMonthAvgPriceTarget": 132,
  "lastQuarter": 18,
  "lastQuarterAvgPriceTarget": 128,
  "allTime": 35
}]
```

신규 백엔드 엔드포인트:
- `app/backend/routes/analyst_targets.py` — `GET /analyst-targets/{ticker}`
  - 응답: `{ consensus, high, low, median, analyst_count, last_updated }`
  - 캐시: 6시간 TTL (FMP rate limit 보호)
  - 한국 종목: 일단 null 반환 (DART/Naver 통합은 후속 작업)

### §3.3 한국 종목 대응 (스트레치)

- Naver Finance `https://finance.naver.com/item/main.naver?code={code}` 스크래핑은
  법적 회색지대이므로 이번 PR 에서는 **null 반환 → ◆ 마커만 숨김** 으로 처리.
- 후속 PR 에서 DART 의견서 또는 한경/매경 API 통합 검토.

---

## §4. 백엔드 변경

### §4.1 신규 모듈 `src/tools/analyst_target_api.py`

```python
"""증권사 컨센서스 목표가 fetcher (FMP)."""
from __future__ import annotations
import logging
import time
from dataclasses import dataclass
from typing import Optional
import requests

logger = logging.getLogger(__name__)

_FMP_BASE = "https://financialmodelingprep.com/stable"
_FMP_KEY = "WnoeVdSBlKezrKNExH7jtXfEWXg8YrtE"

# In-memory cache: ticker → (timestamp, result)
_CACHE: dict[str, tuple[float, "AnalystTarget"]] = {}
_TTL_SECONDS = 6 * 3600  # 6 hours


@dataclass
class AnalystTarget:
    consensus: Optional[float]
    high: Optional[float]
    low: Optional[float]
    median: Optional[float]
    analyst_count: Optional[int]
    source: str  # "FMP" / "stub"


def fetch_analyst_target(ticker: str) -> AnalystTarget:
    cached = _CACHE.get(ticker)
    now = time.time()
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]

    try:
        r_consensus = requests.get(
            f"{_FMP_BASE}/price-target-consensus",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        r_summary = requests.get(
            f"{_FMP_BASE}/price-target-summary",
            params={"symbol": ticker, "apikey": _FMP_KEY},
            timeout=8,
        )
        consensus_data = r_consensus.json()[0] if r_consensus.ok and r_consensus.json() else {}
        summary_data = r_summary.json()[0] if r_summary.ok and r_summary.json() else {}
        result = AnalystTarget(
            consensus=consensus_data.get("targetConsensus"),
            high=consensus_data.get("targetHigh"),
            low=consensus_data.get("targetLow"),
            median=consensus_data.get("targetMedian"),
            analyst_count=summary_data.get("lastQuarter") or summary_data.get("lastMonth"),
            source="FMP",
        )
    except Exception as e:
        logger.debug("analyst target fetch failed for %s: %s", ticker, e)
        result = AnalystTarget(None, None, None, None, None, source="stub")

    _CACHE[ticker] = (now, result)
    return result
```

### §4.2 신규 라우트 `app/backend/routes/analyst_targets.py`

```python
from fastapi import APIRouter, HTTPException
from src.tools.analyst_target_api import fetch_analyst_target

router = APIRouter(prefix="/analyst-targets", tags=["analyst-targets"])


@router.get("/{ticker}")
async def get_analyst_target(ticker: str):
    ticker_clean = ticker.strip().upper()
    if not ticker_clean or len(ticker_clean) > 10:
        raise HTTPException(status_code=400, detail="invalid ticker")
    result = fetch_analyst_target(ticker_clean)
    return {
        "ticker": ticker_clean,
        "consensus": result.consensus,
        "high": result.high,
        "low": result.low,
        "median": result.median,
        "analyst_count": result.analyst_count,
        "source": result.source,
    }
```

**`app/backend/main.py`** 에 라우터 include:
```python
from app.backend.routes import analyst_targets
app.include_router(analyst_targets.router)
```

---

## §5. 프론트엔드 변경

### §5.1 신규 service `app/frontend/src/services/analyst-target-service.ts`

```ts
import { API_BASE_URL } from '@/services/config';

export interface AnalystTarget {
  ticker: string;
  consensus: number | null;
  high: number | null;
  low: number | null;
  median: number | null;
  analyst_count: number | null;
  source: 'FMP' | 'stub';
}

export const analystTargetService = {
  fetch: async (ticker: string): Promise<AnalystTarget | null> => {
    try {
      const res = await fetch(`${API_BASE_URL}/analyst-targets/${encodeURIComponent(ticker)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
};
```

### §5.2 신규 컴포넌트 `app/frontend/src/components/reports/analyst-report-v5/price-compass-bar.tsx`

골격:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/language-preferences';
import type { CanonicalMetrics, ReportLanguage } from './types';
import { analystTargetService, type AnalystTarget } from '@/services/analyst-target-service';

interface PriceCompassBarProps {
  ticker: string;
  metrics: CanonicalMetrics;
  language: ReportLanguage;
  mosBuffer?: number;       // 안전마진 buffer 비율 (기본 0.25)
  marketSigma?: number;     // 시장 σ (기본 0.20 → 1년 ±20%)
}

interface MarkerSpec {
  key: 'current' | 'dcf' | 'mos' | 'consensus' | 'fwdPerFy0' | 'fwdPerFy1';
  label: string;
  value: number;
  glyph: string;           // ●/▲/★/◆/■/▣
  toneClass: string;       // text + border tailwind
  subtext?: string;
  fiscalYear?: number | null;
}

// FY+N 선택: 회계년도가 더 큰 쪽. 같거나 한쪽 없으면 fallback.
function pickFurthestAnnual(
  fy0Year: number | null | undefined,
  fy1Year: number | null | undefined,
): 'fy0' | 'fy1' | 'none' {
  const a = fy0Year ?? null;
  const b = fy1Year ?? null;
  if (b !== null && (a === null || b > a)) return 'fy1';
  if (a !== null) return 'fy0';
  return 'none';
}

export function PriceCompassBar({
  ticker,
  metrics,
  language,
  mosBuffer = 0.25,
  marketSigma = 0.20,
}: PriceCompassBarProps) {
  // 1) Fetch consensus target on mount
  const [target, setTarget] = useState<AnalystTarget | null>(null);
  useEffect(() => {
    let cancelled = false;
    analystTargetService.fetch(ticker).then(r => {
      if (!cancelled) setTarget(r);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  // 2) Editable PER state — FY0 와 FY+N 독립
  const defaultPerFy0 = metrics.forwardPeFy0?.value ?? metrics.forwardPe?.value;
  const defaultPerFy1 = metrics.forwardPeFy1?.value
    ?? (defaultPerFy0 !== undefined ? defaultPerFy0 * 0.9 : undefined);
  const [editedPerFy0, setEditedPerFy0] = useState<number | undefined>(undefined);
  const [editedPerFy1, setEditedPerFy1] = useState<number | undefined>(undefined);
  const effectivePerFy0 = editedPerFy0 ?? defaultPerFy0;
  const effectivePerFy1 = editedPerFy1 ?? defaultPerFy1;
  const resetPer = () => { setEditedPerFy0(undefined); setEditedPerFy1(undefined); };

  // 3) Build markers (only include non-null)
  const markers = useMemo<MarkerSpec[]>(() => {
    const out: MarkerSpec[] = [];
    const current = metrics.currentPrice?.value;
    const intrinsic = metrics.intrinsicValue?.value;
    const fwdEps = metrics.forwardEpsFy0?.value ?? metrics.forwardEpsTtm?.value;

    if (current !== undefined) {
      out.push({ key: 'current', label: t('pcbCurrent', language), value: current, glyph: '●', toneClass: 'text-white' });
    }
    if (intrinsic !== undefined) {
      const upPct = current ? ((intrinsic - current) / current) * 100 : null;
      out.push({
        key: 'dcf',
        label: t('pcbDcf', language),
        value: intrinsic,
        glyph: '▲',
        toneClass: intrinsic > (current ?? 0) ? 'text-emerald-400' : 'text-red-400',
        subtext: upPct !== null ? `${upPct >= 0 ? '+' : ''}${upPct.toFixed(1)}%` : undefined,
      });
      const mosPrice = intrinsic * (1 - mosBuffer);
      out.push({
        key: 'mos',
        label: t('pcbMosBuy', language).replace('{pct}', `${Math.round(mosBuffer * 100)}`),
        value: mosPrice,
        glyph: '★',
        toneClass: 'text-emerald-300',
      });
    }
    if (target?.consensus) {
      out.push({
        key: 'consensus',
        label: t('pcbConsensus', language),
        value: target.consensus,
        glyph: '◆',
        toneClass: 'text-amber-400',
        subtext: target.analyst_count ? `n=${target.analyst_count}` : undefined,
      });
    }
    // FY0 implied price
    const fy0Eps = metrics.forwardEpsFy0?.value;
    const fy0Year = metrics.fy0FiscalYear ?? null;
    if (fy0Eps !== undefined && effectivePerFy0 !== undefined) {
      out.push({
        key: 'fwdPerFy0',
        label: t('pcbFwdPerFy0', language),
        value: fy0Eps * effectivePerFy0,
        glyph: '■',
        toneClass: 'text-sky-400',
        fiscalYear: fy0Year,
      });
    }
    // FY+N (furthest available) implied price — 회계년도가 FY0 보다 클 때만 추가
    const fy1Eps = metrics.forwardEpsFy1?.value;
    const fy1Year = metrics.fy1FiscalYear ?? null;
    const furthest = pickFurthestAnnual(fy0Year, fy1Year);
    if (
      furthest === 'fy1'
      && fy1Eps !== undefined
      && effectivePerFy1 !== undefined
      && (fy0Year === null || (fy1Year !== null && fy1Year > fy0Year))  // FY0 와 동일 연도면 hide
    ) {
      out.push({
        key: 'fwdPerFy1',
        label: t('pcbFwdPerFyN', language),
        value: fy1Eps * effectivePerFy1,
        glyph: '▣',
        toneClass: 'text-sky-300',
        fiscalYear: fy1Year,
      });
    }
    return out;
  }, [metrics, target, effectivePerFy0, effectivePerFy1, mosBuffer, language]);

  // 4) Compute bar range (lo, hi)
  const range = useMemo(() => {
    if (markers.length === 0) return null;
    const vals = markers.map(m => m.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || hi * 0.2;
    return { min: Math.max(0, lo - span * 0.15), max: hi + span * 0.15 };
  }, [markers]);

  // 5) Beta band
  const beta = metrics.beta?.value;
  const current = metrics.currentPrice?.value;
  const betaBand = beta && current
    ? { lo: current * (1 - beta * marketSigma), hi: current * (1 + beta * marketSigma) }
    : null;

  // 6) Hide if <1 marker
  if (markers.length < 1 || !range) return null;

  // 7) Position helper
  const pctFor = (v: number) => ((v - range.min) / (range.max - range.min)) * 100;

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('pcbTitle', language)}
          <span className="ml-1.5 text-[10px] font-mono text-muted-foreground/70">
            {ticker} · USD
          </span>
        </h3>
        {(editedPerFy0 !== undefined || editedPerFy1 !== undefined) && (
          <button
            type="button"
            onClick={resetPer}
            className="text-[10px] text-muted-foreground hover:text-foreground"
            title={t('pcbResetPer', language)}
            aria-label={t('pcbResetPer', language)}
          >
            ↺
          </button>
        )}
      </div>

      {/* Bar */}
      <div className="relative my-3 h-12">
        {/* Range track */}
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border/60" />
        {/* Range labels */}
        <span className="absolute left-0 top-full mt-0.5 font-mono text-[9px] text-muted-foreground">
          ${range.min.toFixed(0)}
        </span>
        <span className="absolute right-0 top-full mt-0.5 font-mono text-[9px] text-muted-foreground">
          ${range.max.toFixed(0)}
        </span>
        {/* Beta band */}
        {betaBand && (
          <div
            className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm bg-yellow-500/15 border border-yellow-500/30"
            style={{
              left: `${pctFor(betaBand.lo)}%`,
              width: `${pctFor(betaBand.hi) - pctFor(betaBand.lo)}%`,
            }}
            title={`β=${beta?.toFixed(2)}, ±${(beta! * marketSigma * 100).toFixed(0)}%`}
          />
        )}
        {/* Markers */}
        {markers.map(m => (
          <div
            key={m.key}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-base ${m.toneClass}`}
            style={{ left: `${pctFor(m.value)}%` }}
            title={`${m.label}: $${m.value.toFixed(2)}`}
          >
            {m.glyph}
          </div>
        ))}
      </div>

      {/* Marker list */}
      <ul className="mt-4 space-y-1 text-[11px]">
        {markers.map(m => (
          <li key={m.key} className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className={m.toneClass}>{m.glyph}</span>
              <span className="text-muted-foreground">{m.label}</span>
              {m.fiscalYear !== undefined && m.fiscalYear !== null && (
                <span className="rounded-sm border border-border/40 px-1 font-mono text-[9px] text-muted-foreground">
                  FY{m.fiscalYear}
                </span>
              )}
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono font-semibold text-foreground">${m.value.toFixed(2)}</span>
              {m.subtext && (
                <span className="font-mono text-[9px] text-muted-foreground">{m.subtext}</span>
              )}
              {m.key === 'fwdPerFy0' && defaultPerFy0 !== undefined && (
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="100"
                  value={effectivePerFy0 ?? defaultPerFy0}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setEditedPerFy0(Number.isFinite(v) ? v : undefined);
                  }}
                  className="ml-1 w-12 rounded border border-border/40 bg-transparent px-1 py-0 text-right font-mono text-[9px] text-sky-400 focus:border-sky-500 focus:outline-none"
                  title={t('pcbEditPer', language)}
                  aria-label={`${t('pcbEditPer', language)} FY0`}
                />
              )}
              {m.key === 'fwdPerFy1' && defaultPerFy1 !== undefined && (
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="100"
                  value={effectivePerFy1 ?? defaultPerFy1}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setEditedPerFy1(Number.isFinite(v) ? v : undefined);
                  }}
                  className="ml-1 w-12 rounded border border-border/40 bg-transparent px-1 py-0 text-right font-mono text-[9px] text-sky-300 focus:border-sky-500 focus:outline-none"
                  title={t('pcbEditPer', language)}
                  aria-label={`${t('pcbEditPer', language)} FY+N`}
                />
              )}
            </span>
          </li>
        ))}
        {betaBand && (
          <li className="flex items-baseline justify-between gap-2 border-t border-border/40 pt-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-yellow-500/30" />
              <span className="text-muted-foreground">
                {t('pcbBetaBand', language).replace('{beta}', beta!.toFixed(2))}
              </span>
            </span>
            <span className="font-mono text-foreground">
              ${betaBand.lo.toFixed(0)} ~ ${betaBand.hi.toFixed(0)}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
```

### §5.2-v3 컴포넌트 코드 변경 사항 (delta)

§5.2 의 컴포넌트 코드를 v3 풀폭 레이아웃에 맞춰 다음 5곳을 수정한다.
**완전 재작성이 아니라 핀포인트 수정** 이다.

**(a) 카드 래퍼 — `mt-3 p-3` → `p-4 md:p-5`:**

```diff
- <div className="mt-3 rounded-xl border border-border/60 bg-background p-3 shadow-sm">
+ <div className="rounded-xl border border-border/60 bg-background p-4 shadow-sm md:p-5">
```

(`mt-3` 제거 — 부모 `space-y-4` 가 처리. 카드 무게감을 헤더 카드와 맞추기.)

**(b) ↺ 초기화 버튼 — 라벨 추가:**

```diff
  <button
    type="button"
    onClick={resetPer}
-   className="text-[10px] text-muted-foreground hover:text-foreground"
+   className="flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/30 hover:text-foreground"
    title={t('pcbResetPer', language)}
    aria-label={t('pcbResetPer', language)}
  >
-   ↺
+   <span>↺</span>
+   <span>{t('pcbResetPer', language)}</span>
  </button>
```

**(c) 바 높이 — 베타 밴드 두께 증가:**

```diff
- <div className="relative my-3 h-12">
+ <div className="relative my-4 h-14">
```

```diff
  className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm bg-yellow-500/15 border border-yellow-500/30"
- → className="absolute top-1/2 h-5 -translate-y-1/2 rounded-sm bg-yellow-500/15 border border-yellow-500/30"
```

**(d) 마커 글리프 크기 — `text-base` → `text-lg`:**

```diff
  <div
    key={m.key}
-   className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-base ${m.toneClass}`}
+   className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg ${m.toneClass}`}
    style={{ left: `${pctFor(m.value)}%` }}
    ...
```

**(e) 마커 리스트 — `space-y-1` → 반응형 그리드:**

```diff
- <ul className="mt-4 space-y-1 text-[11px]">
+ <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
    {markers.map(m => (
      <li key={m.key} className="flex items-baseline justify-between gap-2">
        ...
      </li>
    ))}
    {betaBand && (
-     <li className="flex items-baseline justify-between gap-2 border-t border-border/40 pt-1">
+     <li className="col-span-full flex items-baseline justify-between gap-2 border-t border-border/40 pt-1.5">
        ...
      </li>
    )}
  </ul>
```

(베타 밴드 행은 항상 풀 폭으로 마지막 줄에 표시.)

---

### §5.3 (v3) `report-layout.tsx` 직접 통합 — 헤더 카드 직하

**핵심**: v2 의 `target-data-sidebar.tsx` 내부 렌더는 **제거**. `report-layout.tsx`
의 `<ReportHeaderRibbon />` 바로 다음에 `<PriceCompassBar />` 를 렌더.

```tsx
// app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx
import { PriceCompassBar } from './price-compass-bar';

return (
  <div className="space-y-4">
    <TickerSwitcher ... />

    <ReportHeaderRibbon ... />

    {/* ★ v3: 헤더 직하 풀 폭 가격 좌표 카드 */}
    <PriceCompassBar
      ticker={activeTicker}
      metrics={canonicalMetrics}
      language={language}
    />

    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_280px] md:gap-5 lg:flex lg:flex-row lg:items-start lg:gap-6">
      <ReportTocSidebar ... />
      <div className="min-w-0 flex-1 space-y-4">
        <MobileToc ... />
        <ReportBody ... />
      </div>
      <TargetDataSidebar ... />  {/* PriceCompassBar 인자 더 이상 전달 X */}
    </div>
    ...
  </div>
);
```

### §5.3b `target-data-sidebar.tsx` — v3 에서 PriceCompassBar 제거

v2 에서 추가했던 다음 코드를 **삭제**:
- `import { PriceCompassBar } from './price-compass-bar';`
- `ticker?: string; metrics?: CanonicalMetrics;` props 두 줄 (인터페이스)
- 함수 인자에서 `ticker`, `metrics` 두 줄
- `{ticker && metrics && (<PriceCompassBar ... />)}` 블록 (Button 다음)

타입 import 도 정리: `import type { ... CanonicalMetrics ... }` 에서
`CanonicalMetrics` 토큰 제거.

### §5.4 services/config.ts 확인

`API_BASE_URL` 이 이미 존재한다고 가정 (개발: `http://localhost:8000`,
프로덕션: `/hedge-api`). 신규 service 가 이 상수를 import 한다.

---

## §6. i18n 키 (`language-preferences.ts` 추가)

```
pcbTitle:           '가격 나침반' / 'Price Compass'
pcbCurrent:         '현재가' / 'Current'
pcbDcf:             'DCF 내재가치' / 'DCF Intrinsic'
pcbMosBuy:          '안전마진 매수가 ({pct}%)' / 'MoS Buy Price ({pct}%)'
pcbConsensus:       '증권사 컨센서스' / 'Broker Consensus'
pcbFwdPerFy0:       '연간 함의가 (FY0)' / 'Annual Implied (FY0)'
pcbFwdPerFyN:       '연간 함의가 (FY+N)' / 'Annual Implied (FY+N)'
pcbBetaBand:        '베타 ±1σ 범위 (β={beta})' / 'Beta ±1σ Range (β={beta})'
pcbEditPer:         'PER 편집' / 'Edit PER'
pcbResetPer:        'PER 초기화' / 'Reset PER'
pcbMissing:         '표시할 가격 데이터 부족' / 'Insufficient price data'
```

(총 11개 키. 기존 디자인의 `pcbFwdPerImplied` 는 `pcbFwdPerFy0` 로 대체.)

---

## §7. 테스트 계획

### §7.1 신규 static — `tests/test_price_compass_bar_static.py`

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "app/frontend/src/components/reports/analyst-report-v5/price-compass-bar.tsx"
SERVICE = ROOT / "app/frontend/src/services/analyst-target-service.ts"
SIDEBAR = ROOT / "app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx"
LANG = ROOT / "app/frontend/src/lib/language-preferences.ts"
BACKEND_ROUTE = ROOT / "app/backend/routes/analyst_targets.py"
BACKEND_TOOL = ROOT / "src/tools/analyst_target_api.py"


class PriceCompassBarStaticTests(unittest.TestCase):
    def test_component_exists(self):
        self.assertTrue(COMPONENT.exists())
        src = COMPONENT.read_text(encoding="utf-8")
        for needle in [
            "PriceCompassBar", "MarkerSpec", "betaBand", "pctFor",
            "editedPerFy0", "editedPerFy1",
            "pickFurthestAnnual", "fwdPerFy0", "fwdPerFy1",
            "fy0FiscalYear", "fy1FiscalYear",
        ]:
            self.assertIn(needle, src, needle)

    def test_canonical_metrics_extended(self):
        types_src = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/types.ts").read_text(encoding="utf-8")
        for needle in ["forwardEpsFy1", "forwardPeFy1", "fy0FiscalYear", "fy1FiscalYear"]:
            self.assertIn(needle, types_src, needle)
        helpers_src = (ROOT / "app/frontend/src/components/reports/analyst-report-v5/helpers.ts").read_text(encoding="utf-8")
        for needle in ["forward_eps_fy1", "forward_pe_fy1", "fy0_fiscal_year", "fy1_fiscal_year"]:
            self.assertIn(needle, helpers_src, needle)

    def test_service_exists(self):
        self.assertTrue(SERVICE.exists())
        src = SERVICE.read_text(encoding="utf-8")
        self.assertIn("analystTargetService", src)
        self.assertIn("/analyst-targets/", src)

    def test_sidebar_wires_pcb(self):
        src = SIDEBAR.read_text(encoding="utf-8")
        self.assertIn("PriceCompassBar", src)
        self.assertIn("ticker", src)
        self.assertIn("metrics", src)

    def test_layout_passes_metrics(self):
        src = LAYOUT.read_text(encoding="utf-8")
        self.assertIn("metrics={canonicalMetrics}", src)

    def test_backend_endpoint(self):
        self.assertTrue(BACKEND_ROUTE.exists())
        src = BACKEND_ROUTE.read_text(encoding="utf-8")
        self.assertIn('"/analyst-targets"', src) or self.assertIn("analyst-targets", src)
        self.assertIn("def get_analyst_target", src)

    def test_tool_module(self):
        self.assertTrue(BACKEND_TOOL.exists())
        src = BACKEND_TOOL.read_text(encoding="utf-8")
        self.assertIn("fetch_analyst_target", src)
        self.assertIn("AnalystTarget", src)
        self.assertIn("price-target-consensus", src)

    def test_i18n_keys(self):
        src = LANG.read_text(encoding="utf-8")
        for key in [
            "pcbTitle", "pcbCurrent", "pcbDcf", "pcbMosBuy",
            "pcbConsensus", "pcbFwdPerFy0", "pcbFwdPerFyN",
            "pcbBetaBand", "pcbEditPer", "pcbResetPer", "pcbMissing",
        ]:
            self.assertIn(f"{key}:", src, key)


if __name__ == "__main__":
    unittest.main()
```

### §7.2 신규 unit — `tests/test_analyst_target_api.py`

```python
import unittest
from unittest.mock import patch, MagicMock
from src.tools.analyst_target_api import fetch_analyst_target, _CACHE


class AnalystTargetApiTests(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_returns_parsed_consensus(self, mock_get):
        def side_effect(url, **_):
            mock = MagicMock(ok=True)
            if "consensus" in url:
                mock.json.return_value = [{"targetConsensus": 130, "targetHigh": 175, "targetLow": 80, "targetMedian": 128}]
            else:
                mock.json.return_value = [{"lastQuarter": 18}]
            return mock
        mock_get.side_effect = side_effect

        result = fetch_analyst_target("MU")
        self.assertEqual(result.consensus, 130)
        self.assertEqual(result.high, 175)
        self.assertEqual(result.low, 80)
        self.assertEqual(result.analyst_count, 18)
        self.assertEqual(result.source, "FMP")

    @patch("src.tools.analyst_target_api.requests.get", side_effect=Exception("boom"))
    def test_fetch_returns_stub_on_failure(self, _):
        result = fetch_analyst_target("XYZ")
        self.assertIsNone(result.consensus)
        self.assertEqual(result.source, "stub")

    @patch("src.tools.analyst_target_api.requests.get")
    def test_fetch_uses_cache(self, mock_get):
        mock_resp = MagicMock(ok=True)
        mock_resp.json.return_value = [{"targetConsensus": 100}]
        mock_get.return_value = mock_resp

        fetch_analyst_target("MU")
        fetch_analyst_target("MU")
        # Both calls per request × 2 tickets = expected ≤ 2 HTTP calls cached
        self.assertLessEqual(mock_get.call_count, 2)


if __name__ == "__main__":
    unittest.main()
```

### §7.3 빌드 / 타입

```
pytest tests/test_price_compass_bar_static.py tests/test_analyst_target_api.py -v   → all pass
tsc --noEmit                                                                          → 0 errors
vite build                                                                            → succeeds
```

---

## §8. 수용 기준 (v3 갱신)

**v3 의 베이스라인은 main HEAD `d85b68d`** 다. v1/v2 에서 이미 done 인 항목은
유지 표기 (✅), v3 신규/변경 항목은 [ ] 로 표시.

### v1/v2 에서 완료된 기반 (확인만, 재구현 X)

- ✅ `src/tools/analyst_target_api.py` (FMP + yfinance 현재가)
- ✅ `app/backend/routes/analyst_targets.py` + `__init__.py` 라우터 등록
- ✅ `app/frontend/src/services/analyst-target-service.ts` (`current_price` 포함)
- ✅ `types.ts` 에 `forwardEpsFy1` / `forwardPeFy1` / `fy0FiscalYear` /
  `fy1FiscalYear` 추가
- ✅ `helpers.ts` `buildCanonicalMetrics` 가 FY1 EPS/PER + fiscal_year 매핑
- ✅ `price-compass-bar.tsx` 컴포넌트 (FY0/FY+N 마커 + 베타 밴드 + 두 PER 독립
  편집 + reset 버튼 + `target?.current_price` fallback)
- ✅ i18n 키 11개 ko/en
- ✅ 테스트 2개 파일 pass (`test_analyst_target_api.py`,
  `test_price_compass_bar_static.py`)

### v3 신규/변경 (이번 PR 범위)

- [ ] `target-data-sidebar.tsx` 에서 PriceCompassBar 렌더 **제거** (import,
      props 인터페이스의 `ticker?`/`metrics?` 2줄, 함수 인자 2줄, `<aside>`
      안 `<PriceCompassBar />` 블록 모두 삭제)
- [ ] `report-layout.tsx` 에서 `<TargetDataSidebar>` 의 `ticker={activeTicker}` /
      `metrics={canonicalMetrics}` props **제거**
- [ ] `report-layout.tsx` 에서 `<ReportHeaderRibbon />` 바로 다음 줄에
      `<PriceCompassBar ticker={activeTicker} metrics={canonicalMetrics} language={language} />` **추가** (본문 그리드 위)
- [ ] `price-compass-bar.tsx` §5.2-v3 delta 5곳 반영
      - (a) 카드 래퍼 `mt-3 p-3` → `p-4 md:p-5`
      - (b) ↺ 버튼에 라벨 표시 + border + padding
      - (c) 바 컨테이너 `h-12 my-3` → `h-14 my-4`, 베타 밴드 `h-4` → `h-5`
      - (d) 마커 글리프 `text-base` → `text-lg`
      - (e) 마커 `<ul>` 을 반응형 그리드 (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`),
        베타 밴드 행은 `col-span-full`
- [ ] 정적 테스트 (`test_price_compass_bar_static.py`) 에 다음 assert 추가:
      - `target-data-sidebar.tsx` 에 `PriceCompassBar` 토큰 **없음** (regression
        가드: 사이드바에 다시 추가되는 일이 없도록)
      - `report-layout.tsx` 에 `<PriceCompassBar` 토큰 존재
      - `price-compass-bar.tsx` 의 마커 리스트 그리드 클래스 (`sm:grid-cols-2` 또는
        `lg:grid-cols-3`) 존재
- [ ] tsc 0 error, vite build 성공
- [ ] git push origin main (`0  0`)
- [ ] `./deploy_aws.sh` 성공, smoke check 200 OK
- [ ] 브라우저 검증: GOOGL 보고서 헤더 카드 바로 아래에 풀폭 가격 나침반 바가
      렌더되고, 우측 사이드바에는 더 이상 표시되지 않는다 (시각 회귀)

---

## §9. 구현 순서 (v3, 소넷용)

**전제**: v1/v2 가 이미 main HEAD `d85b68d` 에 머지됨. 컴포넌트 자체와 모든
백엔드/타입/i18n 은 이미 존재. v3 는 **위치 이동 + 시각 보강 + 회귀 가드**
만 진행하는 가벼운 PR.

1. 본 DESIGN.md 정독 (특히 v3 보강 노트 + §2.1-v3 + §5.2-v3 + §5.3 / §5.3b).

2. **`target-data-sidebar.tsx` 정리** (PriceCompassBar 제거):
   - `import { PriceCompassBar } from './price-compass-bar';` 삭제
   - `TargetDataSidebarProps` 인터페이스에서 `ticker?: string;` 과
     `metrics?: CanonicalMetrics;` 두 줄 삭제
   - 함수 인자에서 `ticker`, `metrics` 두 줄 삭제
   - "합의 매트릭스 열기" `</Button>` 뒤의 `{ticker && metrics && (
     <PriceCompassBar ... />)}` 블록 통째로 삭제
   - `import type { CanonicalMetrics, ... }` 에서 `CanonicalMetrics` 토큰 제거
     (다른 곳에서 사용 안 하면)

3. **`report-layout.tsx` 위치 이동**:
   - 상단 import 에 `import { PriceCompassBar } from './price-compass-bar';` 추가
   - `<ReportHeaderRibbon ... />` 닫힘 바로 다음 줄에
     `<PriceCompassBar ticker={activeTicker} metrics={canonicalMetrics} language={language} />` 추가
   - 본문 그리드 안 `<TargetDataSidebar>` 호출에서 `ticker={activeTicker}` 와
     `metrics={canonicalMetrics}` props 두 줄 삭제 (`report={activeReport}` 는 유지)

4. **`price-compass-bar.tsx` 시각 보강** (§5.2-v3 delta 5곳):
   - (a) 카드 래퍼: `mt-3 ... p-3` → `... p-4 ... md:p-5`
   - (b) ↺ 버튼: `className`을 라벨 표시 형태로, `<span>↺</span><span>{t('pcbResetPer', language)}</span>`
   - (c) 바 컨테이너 `h-12 my-3` → `h-14 my-4`, 베타 밴드 `h-4` → `h-5`
   - (d) 바 위 마커 글리프 `text-base` → `text-lg`
   - (e) 마커 `<ul>` 의 `space-y-1` → `grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3`,
     베타 밴드 `<li>` 에 `col-span-full` 추가

5. **정적 테스트 보강** (`tests/test_price_compass_bar_static.py`):
   - `test_sidebar_does_not_contain_pcb`: `target-data-sidebar.tsx` 본문에
     `PriceCompassBar` 토큰이 **없음을** assert (regression 가드)
   - `test_layout_renders_pcb`: `report-layout.tsx` 본문에 `<PriceCompassBar`
     토큰이 존재함을 assert
   - `test_marker_grid_layout`: `price-compass-bar.tsx` 본문에 `sm:grid-cols-2`
     또는 `lg:grid-cols-3` 토큰 존재 assert
   - 기존 `test_sidebar_wires_pcb` 는 **삭제** (이제 사이드바에 없으므로
     반대로 의미가 됨)

6. **회귀 검증**:
   ```
   pytest tests/test_price_compass_bar_static.py tests/test_analyst_target_api.py -v
   cd app/frontend && tsc --noEmit
   cd app/frontend && vite build --base=/hedge/
   ```

7. **스테이지** (정확히 4개 파일):
   ```
   git add \
     app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx \
     app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx \
     app/frontend/src/components/reports/analyst-report-v5/price-compass-bar.tsx \
     tests/test_price_compass_bar_static.py
   git diff --cached --check
   ```
   `docs/`, `tmp/`, `claude.md`, `agents.md` 는 stage 금지.

8. **단일 커밋**:
   ```
   refactor(report): move Price Compass Bar to under header card, full-width

   The bar was rendered inside the right-hand target-data-sidebar in v1/v2,
   which was both visually cramped (280px column) and not where users
   expected to see it. Move it to immediately below the report header
   ribbon at full main-content width so the eye flows naturally header
   → price compass → body. Sidebar integration is removed; the same
   component now renders directly from ReportLayout. Visual polish:
   marker glyphs upgraded text-base → text-lg, marker list switches to
   responsive grid (1/2/3 columns by breakpoint), reset button gains a
   text label and bordered chip, beta band thickness h-4 → h-5. Static
   test gains regression guards so the sidebar can never silently regain
   this component.

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   ```

9. **푸시 + 배포**:
   ```
   git push origin main
   git fetch origin && git rev-list --left-right --count origin/main...HEAD   # 0  0
   ./deploy_aws.sh
   curl -sI --max-time 10 http://54.116.99.19/hedge/ | head -2                # 200 OK
   ```

10. **브라우저 검증** (§12 v3 시나리오).

---

## §10. 스테이지 대상 (v3, 정확한 경로 리스트)

v3 는 위치 이동 + 시각 보강만 진행하므로 **4개 파일만 stage**:

```
app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx
app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx
app/frontend/src/components/reports/analyst-report-v5/price-compass-bar.tsx
tests/test_price_compass_bar_static.py
```

`docs/`, `tmp/`, `claude.md`, `agents.md` 등 다른 dirty 파일은 **stage 금지**.

(참고: v1/v2 의 12개 파일은 `d85b68d` 에 이미 머지되어 있으므로 v3 에서는
재차 staging 하지 않는다. 신규 백엔드/서비스 파일은 건드릴 일 없음.)

---

## §11. 위험 / 미해결

1. **FMP rate limit**: 무료 키 250 req/day. 6h TTL 캐시로 같은 ticker 하루
   4회만 hit. 동일 ticker 다수 사용자에는 메모리 캐시 공유로 안전.
2. **한국 종목 컨센서스**: FMP 데이터에 한국 종목 일부 누락. stub 반환 시
   ◆ 마커만 hide 되고 나머지는 정상 — 이번 PR 의 범위 내.
3. **베타 ±1σ 산정의 단순화**: σ_market=0.20 은 1년 기준 미국 시장 평균값.
   파라미터로 노출하지만 UI 편집은 후속 PR.
4. **PER 편집은 로컬 state만**: 새로고침 시 reset. 사용자가 시나리오를
   저장하려면 향후 saved-analyses 와 연계해야 함.
5. **마커 1개 케이스**: 현재가만 있고 다른 모든 마커 결측 → 컴포넌트 hide
   기준 (`markers.length < 1`) 변경 검토. 일단 1개 이상이면 표시.
6. **DCF 가 current 보다 너무 멀리 있는 경우**: 바 스케일이 비대칭이 되어
   현재가 마커가 한쪽 끝에 몰림. 자동 스케일 보정 (§2.3) 으로 최소한 ±15%
   여백을 보장.
7. **FY+N 데이터 없음 (1년치만 fetch 된 케이스)**: `forwardEpsFy1` /
   `forwardPeFy1` 이 모두 None 이면 ▣ 마커 hide. 단, `fy1_fiscal_year` 가
   존재하면서 EPS 만 None 인 변칙 케이스는 §5.2 의 `if (fy1Eps !== undefined
   && effectivePerFy1 !== undefined)` 가드로 안전 처리.
8. **FY0 == FY+N 회계년도**: provider 가 1년치만 반환했거나 fiscal year
   판단 로직이 같은 해를 두 번 매핑한 경우. §5.2 의 동일 회계년도 hide
   분기로 중복 표시 방지.
9. **사용자 PER 입력 검증**: `<input type="number" min="1" max="100">`
   가드로 음수/0/극단값 차단. 빈 문자열 입력 시 `editedPer = undefined`
   로 default 복귀.
10. **FY+N PER 기본값 추정** (`defaultPerFy0 × 0.9`): provider 가 FY+N PER
    을 안 줬을 때만 fallback. 향후 회사별 평균 PER decay 통계로 교체 가능.

---

## §12. 배포 후 검증 시나리오 (v3)

서버에서 실제로 GOOGL 분석을 실행 후 또는 기존 결과 페이지에서:

### v3 핵심 (위치/시각 확인)

1. ★ **위치 변경 회귀 가드**: "GOOGL · 애스워스 다모다란" 헤더 카드 **바로
   아래**, ToC/본문/우측 사이드바 그리드가 시작되기 **전** 에 "가격 나침반"
   카드가 렌더되는가?
2. ★ **사이드바에서 제거 확인**: 우측 "핵심 타겟 데이터" 사이드바를 끝까지
   스크롤해도 "가격 나침반" 카드가 **없는가**? ("합의 매트릭스 열기" 버튼이
   사이드바 마지막 요소)
3. **풀 폭 렌더**: 카드 폭이 본문 컨테이너 가로 폭 전체를 채우는가? (좌측
   `목차` 사이드바보다 왼쪽으로 튀어나가지 않고, 본문 + 우측 사이드바를
   합친 폭과 동일)
4. **마커 그리드**: lg 화면에서 마커 리스트가 3열로, sm 화면에서 2열로,
   모바일에서 1열로 표시되는가?
5. **베타 밴드 행**: 마커 그리드 마지막에 풀 폭 한 줄로 표시되는가?
6. **↺ 초기화 버튼**: PER 한 번이라도 편집 후 우측 상단에 `↺ PER 초기화`
   라벨이 보이는가? 클릭 시 두 input 동시 reset?

### v1/v2 회귀 (이미 동작하던 것, 깨졌는지 확인)

7. 현재 주가 ● 마커가 바 위에 표시되는가? (yfinance fallback 확인 — 헤더의
   "현재가 N/A" 라벨과 무관하게 바에는 표시되어야 함)
8. DCF 내재가치 ▲ 마커가 보이는가? (다모다란 보고서면 표시되어야 함)
9. ★ 안전마진 매수가 마커가 ▲ 의 75% 위치에 표시되는가?
10. ◆ 증권사 컨센서스 마커가 표시되는가? (FMP 가 데이터 있을 때)
11. ■ FY0 함의가 옆에 `FY2026` 같은 회계년도 칩이 보이는가?
12. ▣ FY+N 함의가 옆에 `FY2027` 같은 다음 회계년도 칩이 보이는가?
    (FY1 데이터 있을 때만, 없으면 ▣ hide)
13. FY0 PER input 편집 → ■ 마커만 이동, ▣ 그대로 유지?
14. FY+N PER input 편집 → ▣ 마커만 이동, ■ 그대로 유지?
15. β 가 있을 때 yellow band 가 현재가 좌우로 깔리는가?

### Edge case

16. 한국 종목 (예: 005930.KS) 에서 ◆ 만 사라지고 나머지는 정상?
17. 신규 상장 종목 (FY1 데이터 없음) 에서 ▣ 만 사라지고 ■ FY0 는 정상?
18. 모든 데이터 결측 + yfinance 도 실패 → 컴포넌트 자체가 hide (헤더 카드와
    본문 그리드 사이에 빈 카드 보이지 않음)?
