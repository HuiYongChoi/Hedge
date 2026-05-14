# 에이전트 보고서 품질 개선 — 회사명 정확도 + 문단 가시성 + 톤 컬러링

## 1. 진단

스크린샷 (GLW / Corning 보고서 2026-05-09) 에서 확인된 3가지 문제:

### 1.1 회사명 환각
- 본문 첫 줄: "글래스웍스(GLW)은(는) ..." → 실제는 **코닝(Corning Inc.)**.
- 원인: 에이전트들이 LLM에 **티커만 넘기고 회사 정식명을 안 넘김**. LLM은 ticker만 보고 추측 → 환각 발생.
- 코드 확인:
  - `src/agents/aswath_damodaran.py` 등 14개 personality 에이전트는 `analysis_data` dict에 `ticker`만 포함, `company_name` 없음.
  - LLM 프롬프트 human 메시지는 `Ticker: {ticker}\nAnalysis data: {analysis_data}` 형태.
- yfinance `info.longName` / FMP `companyName` / DART `corp_name`을 가져와 prompt에 포함시키면 환각 차단 가능.

### 1.2 문단 구분 약함
- LLM이 종종 빈 줄 없이 한 줄로 나열 → 프론트의 `renderMarkdownBlocks`가 한 문단으로 렌더 → 가독성 ↓.
- 코드 확인: [stock-search-tab.tsx:692](app/frontend/src/components/tabs/stock-search-tab.tsx:692) — `markdown.split('\n')` 후 `if (!trimmed)` 빈 줄로만 문단 분리.
- 해결 방향:
  - **상류** (LLM): 시스템 프롬프트에 "각 논점 사이 빈 줄 1개" 강제
  - **하류** (렌더러): `### 헤더`, `1. 번호`, `- 항목` 같은 구조 마커가 등장하면 자동 문단 구분 + 마침표(`다.`/`.`/`니다.`) + 다음 줄 첫 단어가 새 화제일 때 휴리스틱으로 split

### 1.3 줄/문단별 톤 시각화 부재
- 보고서 한 줄씩이 긍정/부정/보합/N/A인지 한눈에 안 보임.
- 사용자는 스캔하면서 톤을 빨리 잡고 싶어함.
- 해결: LLM 출력에 **inline sentiment 마커**(`[+]`, `[-]`, `[~]`, `[?]`) 부착 → 렌더러가 마커 파싱해서 좌측 색 띠 + 아이콘 + (선택) 글자색 적용.

---

## 2. 목표

1. **회사명 정확도**: 모든 personality 에이전트의 LLM 보고서에 환각 없는 회사 정식명이 등장.
2. **문단 구분**: 보고서 본문에서 논점·신호·리스크가 시각적으로 분리된 블록으로 보임.
3. **톤 컬러링**: 각 문단/리스트 항목이 [+] 긍정 · [-] 부정 · [~] 보합 · [?] 알 수 없음 4색으로 분류되어 한눈에 스캔 가능.
4. **하위호환**: 기존 trailing-only 보고서, kr-consensus 보고서, forward-aware(v3 예정) 보고서 모두 동일 톤 마커 규칙 적용.
5. **국제화**: 한/영 양쪽 대응. 마커 자체는 언어 중립(`[+]`, `[-]`, `[~]`, `[?]`).

### 비목표

- 보고서 내용 자체의 분석 깊이 개선 (별도 작업)
- 차트/그래프 추가 (현재 텍스트 보고서 범위 내)
- 새로운 에이전트 페르소나 추가

---

## 3. 설계

### 3.1 회사명 해상도

**신규 모듈: `src/tools/company_name.py`**

```python
"""Resolve canonical company names per ticker for LLM prompt grounding."""
from __future__ import annotations
import logging
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)


@lru_cache(maxsize=512)
def resolve_company_name(ticker: str, language: str = "ko") -> str:
    """Return canonical company name; falls back to ticker on failure.

    Priority:
      - Korean ticker (.KS / .KQ / 6-digit) -> DART corp_name (한글) + optional EN
      - US/global ticker -> yfinance longName (or shortName) -> FMP companyName
      - Unknown -> ticker uppercase
    """
    normalized = (ticker or "").strip().upper()
    if not normalized:
        return ticker

    if _is_korean_ticker(normalized):
        name = _resolve_korean(normalized)
        if name:
            return name

    name = _resolve_yfinance(normalized) or _resolve_fmp(normalized)
    return name or normalized


def _is_korean_ticker(t: str) -> bool:
    return t.endswith(".KS") or t.endswith(".KQ") or t.isdigit()

def _resolve_korean(t: str) -> Optional[str]:
    try:
        from src.tools.dart_api import get_corp_info
        info = get_corp_info(t)
        if info and info.get("corp_name"):
            return info["corp_name"]
    except Exception as exc:
        logger.debug("DART corp_name failed for %s: %s", t, exc)
    return None

def _resolve_yfinance(t: str) -> Optional[str]:
    try:
        import yfinance as yf
        info = yf.Ticker(t).info or {}
        return info.get("longName") or info.get("shortName")
    except Exception as exc:
        logger.debug("yfinance longName failed for %s: %s", t, exc)
        return None

def _resolve_fmp(t: str) -> Optional[str]:
    import os, requests
    api_key = os.environ.get("FMP_API_KEY")
    if not api_key:
        return None
    try:
        r = requests.get(
            f"https://financialmodelingprep.com/api/v3/profile/{t}",
            params={"apikey": api_key},
            timeout=8,
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and data:
                return data[0].get("companyName")
    except Exception as exc:
        logger.debug("FMP profile failed for %s: %s", t, exc)
    return None
```

**에이전트 통합 패턴**

각 personality 에이전트(`aswath_damodaran.py` 등 14개)에서:

```python
from src.tools.company_name import resolve_company_name
# 분석 루프 안에서:
company_name = resolve_company_name(ticker)
analysis_data[ticker]["company_name"] = company_name
```

LLM 프롬프트 human 메시지 변경:

```python
("human", """Ticker: {ticker}
Company name: {company_name}

Use the provided company_name when referring to the firm. Never paraphrase
or translate it. If company_name equals the ticker, you may use the ticker
itself.

Analysis data:
{analysis_data}
...""")
```

LLM 시스템 프롬프트에도 한 줄 추가:

```
COMPANY IDENTITY REQUIREMENT: Refer to the company by the company_name provided
in the human message. Do NOT invent, translate, or paraphrase the company name
under any circumstance.
```

### 3.2 톤 마커 규칙 (LLM 측 강제)

**공통 시스템 프롬프트 보강** — `src/utils/llm.py`에 신규 상수:

```python
SENTIMENT_MARKER_REQUIREMENT = (
    "TONE MARKER REQUIREMENT: Prefix every bullet point, numbered item, and "
    "standalone paragraph in the reasoning output with one of these markers:\n"
    "  [+]  positive / bullish / supportive evidence\n"
    "  [-]  negative / bearish / risk evidence\n"
    "  [~]  neutral / mixed / sideways\n"
    "  [?]  unknown / N/A / data gap\n"
    "Place the marker at the very start of the line, followed by a single "
    "space and then the sentence. Use exactly one marker per line; do not "
    "combine markers. Markers are required even inside ordered lists "
    "(e.g. '1. [+] Revenue CAGR 12%'). For headings (### / ##), do NOT add a "
    "marker — only content lines get marked.\n\n"
    "PARAGRAPH SEPARATION REQUIREMENT: Insert a blank line between "
    "paragraphs and between major topical shifts. Do not concatenate distinct "
    "ideas into one wall of text."
)
```

각 personality 에이전트의 시스템 프롬프트 끝에 이 상수 + (v3 예정인) `FORWARD_OUTLOOK_SYSTEM_INSTRUCTION` 함께 append.

**왜 마커 4종인가**: 색맹 사용자에게도 기호가 1차 신호. 색은 보조.

### 3.3 프론트엔드 렌더러 보강

**파일**: [app/frontend/src/components/tabs/stock-search-tab.tsx](app/frontend/src/components/tabs/stock-search-tab.tsx)

#### 3.3.1 마커 파서 + 톤 컬러 매핑

```tsx
type SentimentTone = 'positive' | 'negative' | 'neutral' | 'unknown' | null;

const SENTIMENT_PATTERN = /^\[([+\-~?])\]\s*/;

function parseSentimentMarker(text: string): { tone: SentimentTone; rest: string } {
  const m = text.match(SENTIMENT_PATTERN);
  if (!m) return { tone: null, rest: text };
  const tone: SentimentTone = m[1] === '+' ? 'positive'
    : m[1] === '-' ? 'negative'
    : m[1] === '~' ? 'neutral'
    : 'unknown';
  return { tone, rest: text.slice(m[0].length) };
}

const TONE_STYLES: Record<NonNullable<SentimentTone>, {
  border: string; bg: string; icon: string; iconClass: string;
}> = {
  positive: { border: 'border-l-green-500', bg: 'bg-green-500/5', icon: '✓', iconClass: 'text-green-500' },
  negative: { border: 'border-l-red-500',   bg: 'bg-red-500/5',   icon: '✗', iconClass: 'text-red-500' },
  neutral:  { border: 'border-l-amber-500', bg: 'bg-amber-500/5', icon: '–', iconClass: 'text-amber-500' },
  unknown:  { border: 'border-l-zinc-500',  bg: 'bg-zinc-500/5',  icon: '?', iconClass: 'text-zinc-400' },
};

function renderTonedLine(text: string, baseClass: string): ReactNode {
  const { tone, rest } = parseSentimentMarker(text);
  if (!tone) return renderInlineMarkdown(text);
  const s = TONE_STYLES[tone];
  return (
    <span className={`flex items-start gap-2 border-l-2 pl-2 py-0.5 ${s.border} ${s.bg} ${baseClass}`}>
      <span className={`mt-0.5 flex-shrink-0 font-mono text-xs ${s.iconClass}`} aria-label={tone}>{s.icon}</span>
      <span className="flex-1">{renderInlineMarkdown(rest)}</span>
    </span>
  );
}
```

#### 3.3.2 `renderMarkdownBlocks` 보강

기존 list/paragraph 렌더링에서 항목 텍스트를 `renderTonedLine(item, 'leading-relaxed text-zinc-300')` 로 감쌈:

- ordered list `<li>` 안: `{renderTonedLine(item, 'text-zinc-300')}`
- unordered list `<li>` 안: `{renderTonedLine(item, 'text-zinc-300')}`
- paragraph `<p>` 안: `{renderTonedLine(trimmed, 'text-zinc-300')}`
- heading (`### / ##`)은 마커 적용 안 함 (기존 그대로)

#### 3.3.3 휴리스틱 문단 분리 (LLM이 빈 줄 깜빡한 경우 보강)

`renderMarkdownBlocks` 진입 직전에:

```tsx
function ensureParagraphBreaks(markdown: string): string {
  // 마침표 + 공백 + 다음 문장이 [+/-/~/?] 마커로 시작하면 그 앞에 빈 줄 삽입
  return markdown
    .replace(/([.다])\s+(\[[+\-~?]\])/g, '$1\n\n$2')
    // 헤딩 직전에 빈 줄
    .replace(/([^\n])\n(#{2,3}\s)/g, '$1\n\n$2')
    // 번호 항목/대시 항목 사이 빈 줄 보강 (이미 \n이면 그대로)
    .replace(/([^\n])\n(\d+[.)]\s|\-\s|\*\s)/g, '$1\n\n$2');
}
```

`renderMarkdownBlocks(ensureParagraphBreaks(markdown))` 형태로 호출.

#### 3.3.4 톤 범례 (Legend)

각 보고서 상단에 작은 범례 한 줄:

```tsx
function ToneLegend({ language }: { language: 'ko' | 'en' }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wider">
        {language === 'ko' ? '톤 표시' : 'Tone'}:
      </span>
      <span className="inline-flex items-center gap-1"><span className="text-green-500">✓</span> {language === 'ko' ? '긍정' : 'Positive'}</span>
      <span className="inline-flex items-center gap-1"><span className="text-red-500">✗</span> {language === 'ko' ? '부정' : 'Negative'}</span>
      <span className="inline-flex items-center gap-1"><span className="text-amber-500">–</span> {language === 'ko' ? '보합/중립' : 'Neutral'}</span>
      <span className="inline-flex items-center gap-1"><span className="text-zinc-400">?</span> {language === 'ko' ? '데이터 공백' : 'Unknown'}</span>
    </div>
  );
}
```

각 에이전트 보고서 카드 상단에 1회 렌더.

### 3.4 회사명 표시 보강 (선택)

보고서 헤더에서도 ticker 옆에 회사명을 큰 글씨로 표기:

```tsx
// 기존: <h2>{ticker}</h2>
// 변경: <h2>{companyName} <span className="text-muted-foreground">({ticker})</span></h2>
```

`companyName`은 백엔드 응답의 `analyst_signals[agentId][ticker].company_name` 또는 별도 메타에서 가져옴.

---

## 4. 변경 파일

### 신규

```
src/tools/company_name.py                                  # 회사명 해상도 + 캐시
tests/test_company_name.py                                  # 단위 테스트
tests/test_report_sentiment_markers_static.py              # 정적 검증 (LLM 프롬프트에 마커 규칙 포함, 렌더러에 파서 포함)
```

### 수정 (백엔드)

```
src/utils/llm.py                                            # SENTIMENT_MARKER_REQUIREMENT 상수
src/agents/aswath_damodaran.py                              # company_name 주입 + 시스템 프롬프트 보강
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

### 수정 (프론트엔드)

```
app/frontend/src/components/tabs/stock-search-tab.tsx       # parseSentimentMarker, renderTonedLine, ensureParagraphBreaks, ToneLegend, 회사명 헤더
app/frontend/src/lib/language-preferences.ts                # 톤 범례 i18n 키 추가
```

---

## 5. 동작 시나리오

### 시나리오 1: GLW (Corning) 보고서 — 환각 차단

**Before** (현재):
```
글래스웍스(GLW)은(는) 현재 가격 기준으로 FCFF DCF가 산출한 내재가치보다 높게 거래되고 있고...
```

**After**:
- 백엔드: `resolve_company_name("GLW")` → "Corning Incorporated" (yfinance longName)
- LLM 프롬프트: `Company name: Corning Incorporated` + "Do NOT translate or paraphrase"
- LLM 출력: `코닝(Corning Incorporated, GLW)은 ...`

### 시나리오 2: SK하이닉스 보고서 — 톤 가시성

**Before**:
```
1. 사업의 질적 그림(제약: 정량 성장 데이터 공백)
   - 최종 신호: 약세(베어리시) — 내재가치 대비 안전마진 -0.89로 추정치가 하방에 위치합니다.
   - 다만 전망(Forward outlook)이 '높은 신뢰도'로 제시되며...
```

**After** (LLM이 마커 부착):
```
1. 사업의 질적 그림(제약: 정량 성장 데이터 공백)
   - [-] 최종 신호: 약세(베어리시) — 내재가치 대비 안전마진 -0.89로 추정치가 하방에 위치합니다.
   - [+] 전망(Forward outlook)이 '높은 신뢰도'로 제시되며 예상 EPS가 개선되는 구간입니다.
   - [?] 입력 데이터에 기간별 매출/이익 성장률이 N/A로 제공되어...
```

렌더러 결과:
- 첫 항목: 좌측 빨간 띠 + ✗ 아이콘 (부정)
- 둘째 항목: 좌측 초록 띠 + ✓ 아이콘 (긍정)
- 셋째 항목: 좌측 회색 띠 + ? 아이콘 (데이터 공백)

상단에 톤 범례 4색 1줄.

### 시나리오 3: 한 줄로 뭉친 LLM 출력

**LLM 응답**:
```
[-] 매출 성장률이 둔화되고 있습니다. [-] 영업마진도 압박을 받고 있습니다. [+] 다만 자사주 매입은 지속됩니다.
```

`ensureParagraphBreaks` 후:
```
[-] 매출 성장률이 둔화되고 있습니다.

[-] 영업마진도 압박을 받고 있습니다.

[+] 다만 자사주 매입은 지속됩니다.
```

세 문단으로 분리되어 각각 색 띠 적용.

---

## 6. Acceptance Criteria

1. **회사명**: `resolve_company_name("GLW")` → "Corning"이 들어간 값 반환. `resolve_company_name("005930.KS")` → "삼성전자"가 들어간 값.
2. **에이전트 프롬프트**: 14개 personality 에이전트 모두의 LLM `human` 메시지에 `Company name:` 라인 포함, system 메시지에 `COMPANY IDENTITY REQUIREMENT` 포함.
3. **톤 마커 규칙**: 14개 모두의 system 메시지에 `SENTIMENT_MARKER_REQUIREMENT` 포함.
4. **렌더러**: stock-search-tab.tsx에 `parseSentimentMarker`, `renderTonedLine`, `ensureParagraphBreaks`, `ToneLegend` 함수가 구현되고 사용됨.
5. **회사명 헤더**: 보고서 상단에 `회사명 (티커)` 형식으로 표시.
6. **하위호환**: 마커 없는 기존 보고서 텍스트는 색 띠 없이 그대로 렌더 (회귀 없음).
7. **빌드**: `npm run build` 성공.
8. **테스트**: `pytest tests/test_company_name.py tests/test_report_sentiment_markers_static.py` 통과.
9. **회귀 0**: `pytest tests/ --ignore=tests/backtesting -q`.
10. **수동 검증**: GLW 또는 SK하이닉스 보고서 재생성 시 (a) 회사명 정확 (b) 각 줄 톤 색 표시 (c) 문단 분리 명확.

---

## 7. 작업 분해

```
Phase 1 — 회사명 해상도 (~1.5h)
  □ src/tools/company_name.py
  □ DART corp_name 헬퍼 (없으면 dart_api에 get_corp_info 추가)
  □ tests/test_company_name.py (mocked yfinance/FMP/DART)

Phase 2 — LLM 프롬프트 통합 (~2h)
  □ src/utils/llm.py에 SENTIMENT_MARKER_REQUIREMENT 상수
  □ 14개 personality agent 일괄 수정 (company_name 주입 + system prompt 추가)

Phase 3 — 프론트엔드 렌더러 (~2h)
  □ stock-search-tab.tsx에 parseSentimentMarker, TONE_STYLES, renderTonedLine
  □ ensureParagraphBreaks 휴리스틱
  □ ToneLegend 컴포넌트 + 보고서 카드 상단 렌더
  □ 회사명 헤더 (ticker → companyName + ticker)
  □ language-preferences.ts에 톤 범례 i18n 추가

Phase 4 — 테스트 + 빌드 + 회귀 (~1h)
  □ tests/test_report_sentiment_markers_static.py
  □ npm run build
  □ pytest 전체 통과
  □ 수동 검증 (GLW, SK하이닉스, AAPL)
```
