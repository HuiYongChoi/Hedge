# Sonnet 인계 프롬프트 — 에이전트 보고서 품질 개선

아래 블록을 그대로 Sonnet에 복붙하세요.

---

## ▼ 복붙 시작

당신은 `ai-hedge-fund` 레포의 풀스택 시니어 엔지니어입니다. 사용자가 종목 분석 보고서에서 발견한 **3가지 품질 문제를 한 번에 해결**하는 작업을 수행합니다.

- **문제 1**: GLW(Corning) 보고서가 회사명을 "글래스웍스"로 환각 — 에이전트 LLM에 회사 정식명을 안 넘겨서 발생
- **문제 2**: 보고서가 한 줄로 뭉쳐 보일 때가 있어 문단 구분이 약함
- **문제 3**: 각 줄·문단이 긍정/부정/보합/N/A인지 시각적으로 구분 안 됨 → 스캔이 어려움

### 사전 컨텍스트 (반드시 먼저 읽기)

1. `docs/agents/report_polish/DESIGN.md` — 전체 설계 (이게 진리)
2. `src/agents/aswath_damodaran.py` — 14개 personality 에이전트의 대표 사례 (LLM prompt 구조 파악)
3. `src/agents/fundamentals.py` — `get_forward_metrics`를 이미 호출하는 참고 사례
4. `src/utils/llm.py` — `DATA_GAP_HANDLING_REQUIREMENT`, `RATIO_SCALE_REQUIREMENT` 같은 시스템 프롬프트 상수가 사는 곳
5. `src/tools/dart_api.py` — DART API 헬퍼 (corp_name 추출 시 활용 또는 신규 함수 추가)
6. `app/frontend/src/components/tabs/stock-search-tab.tsx` — 보고서 렌더러 (`renderMarkdownBlocks`, `renderInlineMarkdown`, line 644~741)
7. `app/frontend/src/lib/language-preferences.ts` — i18n 사전
8. `docs/forward_per/v3_agent_integration/DESIGN.md` (참고용) — 동일한 14개 에이전트 일괄 수정 패턴

### 진단 (왜 하는가)

- **회사명 환각**: 에이전트들의 LLM `human` 메시지는 `Ticker: {ticker}\nAnalysis data: {...}` 만 포함. 회사 정식명이 없어서 LLM이 ticker만 보고 추측 → "GLW = 글래스웍스" 같은 환각.
- **문단 구분**: LLM이 빈 줄 없이 문장을 이어 붙이면 [stock-search-tab.tsx:692](app/frontend/src/components/tabs/stock-search-tab.tsx:692) `markdown.split('\n')` 가 한 문단으로 처리.
- **톤 시각화**: 보고서는 plain markdown 텍스트. 사용자는 한 줄씩 톤(+/-/~/?) 을 빨리 잡고 싶지만 색·기호가 없어 스캔 곤란.

해결 핵심:
- (a) `resolve_company_name(ticker)` 신규 함수로 yfinance/FMP/DART에서 정식명 가져와 LLM에 주입
- (b) 시스템 프롬프트에 `[+] / [-] / [~] / [?]` 마커 부착 규칙 강제 + 빈 줄 분리 규칙 강제
- (c) 프론트 렌더러가 마커를 파싱해서 좌측 색 띠 + 아이콘으로 표시 + 휴리스틱 문단 분리

### 요구사항 (Acceptance Criteria — 전부 통과해야 완료)

1. `resolve_company_name("GLW")` → "Corning"이 들어간 문자열 반환.
2. `resolve_company_name("005930.KS")` → "삼성전자"가 들어간 문자열 반환.
3. 14개 personality 에이전트 모두의 LLM `human` 메시지에 `Company name:` 라인 포함.
4. 14개 모두의 LLM `system` 메시지에 `COMPANY IDENTITY REQUIREMENT` + `SENTIMENT_MARKER_REQUIREMENT` 두 단락 포함.
5. `stock-search-tab.tsx`에 `parseSentimentMarker`, `renderTonedLine`, `ensureParagraphBreaks`, `ToneLegend` 함수 구현 + 사용.
6. 보고서 헤더가 `회사명 (티커)` 형식으로 표시.
7. 마커 없는 기존 보고서 텍스트는 색 띠 없이 그대로 렌더 (하위호환).
8. `npm run build` 성공.
9. 신규 테스트 `pytest tests/test_company_name.py tests/test_report_sentiment_markers_static.py` 통과.
10. 회귀 0: `pytest tests/ --ignore=tests/backtesting -q`.

### 구현 단계 (순서대로)

#### Phase 1 — 회사명 해상도

**신규 파일: `src/tools/company_name.py`**

DESIGN.md §3.1 에 명시된 코드 그대로 작성. 핵심:
- `@lru_cache(maxsize=512)` 데코레이터로 in-memory 캐시
- 한국 티커 → DART corp_name → yfinance → FMP → fallback ticker
- 모든 외부 호출은 try/except로 감싸 logger.debug로 실패 처리

**DART corp_name 헬퍼**:
- `src/tools/dart_api.py`에 `get_corp_info(ticker)` 함수가 이미 있는지 `git grep "def get_corp_info"`로 확인.
- 없으면 신규로 추가. DART의 `corpCode.xml`에서 stock_code 매칭 → `corp_name` 반환.
- 또는 기존 DART 호출 헬퍼에서 corp_name을 이미 부수적으로 가져온다면 그걸 쓰는 메모이즈드 wrapper 작성.

**신규 파일: `tests/test_company_name.py`**

```python
from unittest.mock import patch
import pytest
from src.tools.company_name import resolve_company_name

def test_us_ticker_resolves_via_yfinance(monkeypatch):
    fake_ticker = type("T", (), {"info": {"longName": "Corning Incorporated"}})()
    monkeypatch.setattr("yfinance.Ticker", lambda t: fake_ticker)
    assert "Corning" in resolve_company_name("GLW")

def test_unknown_ticker_falls_back_to_ticker():
    # 외부 호출 모두 실패하도록 monkeypatch
    monkeypatch_failures(...)
    assert resolve_company_name("ZZZNONE") == "ZZZNONE"

def test_korean_ticker_uses_dart(monkeypatch):
    monkeypatch.setattr("src.tools.dart_api.get_corp_info",
                        lambda t: {"corp_name": "삼성전자"})
    assert resolve_company_name("005930.KS") == "삼성전자"

def test_lru_cache_avoids_double_lookup():
    # 같은 티커 두 번 호출 시 외부 fetch 1회만
    pass
```

#### Phase 2 — LLM 프롬프트 통합

**`src/utils/llm.py`에 신규 상수 두 개 추가**:

```python
COMPANY_IDENTITY_REQUIREMENT = (
    "COMPANY IDENTITY REQUIREMENT: Refer to the company by the company_name "
    "provided in the human message. Do NOT invent, translate, or paraphrase "
    "the company name under any circumstance. If you don't know the Korean "
    "translation of an English company name, use the English name as-is. "
    "Never call a company by a translated brand name unless company_name "
    "explicitly contains it."
)

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

**14개 personality 에이전트 일괄 수정** — 동일 패턴:

```python
# 1) import 추가
from src.tools.company_name import resolve_company_name
from src.utils.llm import COMPANY_IDENTITY_REQUIREMENT, SENTIMENT_MARKER_REQUIREMENT

# 2) 분석 루프 안에서 (티커별로):
company_name = resolve_company_name(ticker)
analysis_data[ticker]["company_name"] = company_name

# 3) generate_*_output() 함수 내부 ChatPromptTemplate 수정:
template = ChatPromptTemplate.from_messages([
    ("system", f"""{existing_persona_instructions}

{COMPANY_IDENTITY_REQUIREMENT}

{SENTIMENT_MARKER_REQUIREMENT}"""),
    ("human", """Ticker: {ticker}
Company name: {company_name}

Analysis data:
{analysis_data}

Respond EXACTLY in this JSON schema: ..."""),
])

# 4) prompt.invoke()에 company_name 키 추가:
prompt = template.invoke({
    "analysis_data": json.dumps(analysis_data, indent=2),
    "ticker": ticker,
    "company_name": analysis_data[ticker].get("company_name", ticker),
})
```

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

각 파일의 함수명·변수명이 다르므로(`generate_buffett_output`, `generate_munger_output`, …) 메인 에이전트 함수 안에서 ChatPromptTemplate 정의된 위치를 찾아 수정.

#### Phase 3 — 프론트엔드 렌더러

**파일: `app/frontend/src/components/tabs/stock-search-tab.tsx`**

##### 3.1 마커 파서 + 톤 스타일 (renderMarkdownBlocks 위에 추가)

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

function renderTonedContent(text: string): ReactNode {
  const { tone, rest } = parseSentimentMarker(text);
  if (!tone) return renderInlineMarkdown(text);
  const s = TONE_STYLES[tone];
  return (
    <span className={`flex items-start gap-2 border-l-2 pl-2 py-0.5 rounded-sm ${s.border} ${s.bg}`}>
      <span className={`mt-0.5 flex-shrink-0 font-mono text-xs ${s.iconClass}`} aria-label={tone}>{s.icon}</span>
      <span className="flex-1">{renderInlineMarkdown(rest)}</span>
    </span>
  );
}
```

##### 3.2 휴리스틱 문단 분리

```tsx
function ensureParagraphBreaks(markdown: string): string {
  return markdown
    .replace(/([.다])\s+(\[[+\-~?]\])/g, '$1\n\n$2')
    .replace(/([^\n])\n(#{2,3}\s)/g, '$1\n\n$2')
    .replace(/([^\n])\n(\d+[.)]\s|-\s|\*\s)/g, '$1\n\n$2');
}
```

##### 3.3 `renderMarkdownBlocks` 수정

기존 `renderInlineMarkdown(item)` / `renderInlineMarkdown(trimmed)` 호출을 `renderTonedContent(item)` / `renderTonedContent(trimmed)` 로 교체. **단 헤딩(`### / ##`)은 그대로**.

호출부에서:
```tsx
{renderMarkdownBlocks(ensureParagraphBreaks(markdown))}
```

##### 3.4 ToneLegend 컴포넌트

```tsx
function ToneLegend({ language }: { language: 'ko' | 'en' }) {
  const items: Array<{ icon: string; cls: string; label: string }> = [
    { icon: '✓', cls: 'text-green-500', label: language === 'ko' ? '긍정' : 'Positive' },
    { icon: '✗', cls: 'text-red-500',   label: language === 'ko' ? '부정' : 'Negative' },
    { icon: '–', cls: 'text-amber-500', label: language === 'ko' ? '보합/중립' : 'Neutral' },
    { icon: '?', cls: 'text-zinc-400',  label: language === 'ko' ? '데이터 공백' : 'Unknown' },
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wider">
        {language === 'ko' ? '톤 표시' : 'Tone'}:
      </span>
      {items.map(({ icon, cls, label }) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className={`font-mono ${cls}`}>{icon}</span>
          {label}
        </span>
      ))}
    </div>
  );
}
```

각 에이전트 보고서 카드 본문 시작 직전에 `<ToneLegend language={language} />` 1회 렌더.

##### 3.5 회사명 헤더

`getReports`나 보고서 카드 렌더링 부분에서 ticker 옆에 회사명 표시:

```tsx
const companyName = report.company_name || report.companyName;
// ...
<h2 className="...">
  {companyName ? (
    <>{companyName} <span className="text-muted-foreground font-normal">({ticker})</span></>
  ) : (
    ticker
  )}
</h2>
```

`company_name`은 백엔드 응답의 `analyst_signals[agentId][ticker].company_name`에서 옴 (Phase 2에서 주입한 값). 코드 내 정확한 경로는 `getReports` 함수의 `signals[ticker]` 추출 부분에서 확인 후 마운트.

#### Phase 4 — 테스트 + 빌드 + 회귀

**신규: `tests/test_report_sentiment_markers_static.py`**

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
LLM = ROOT / "src/utils/llm.py"
TAB = ROOT / "app/frontend/src/components/tabs/stock-search-tab.tsx"
DAMODARAN = ROOT / "src/agents/aswath_damodaran.py"


class ReportSentimentMarkerStaticTests(unittest.TestCase):
    def test_llm_defines_sentiment_marker_requirement(self):
        source = LLM.read_text(encoding="utf-8")
        self.assertIn("SENTIMENT_MARKER_REQUIREMENT", source)
        self.assertIn("[+]", source)
        self.assertIn("[-]", source)
        self.assertIn("[~]", source)
        self.assertIn("[?]", source)

    def test_llm_defines_company_identity_requirement(self):
        source = LLM.read_text(encoding="utf-8")
        self.assertIn("COMPANY_IDENTITY_REQUIREMENT", source)

    def test_damodaran_uses_company_name(self):
        source = DAMODARAN.read_text(encoding="utf-8")
        self.assertIn("resolve_company_name", source)
        self.assertIn("COMPANY_IDENTITY_REQUIREMENT", source)
        self.assertIn("SENTIMENT_MARKER_REQUIREMENT", source)

    def test_frontend_renders_sentiment_markers(self):
        source = TAB.read_text(encoding="utf-8")
        self.assertIn("parseSentimentMarker", source)
        self.assertIn("renderTonedContent", source)
        self.assertIn("ensureParagraphBreaks", source)
        self.assertIn("ToneLegend", source)
        self.assertIn("TONE_STYLES", source)


if __name__ == "__main__":
    unittest.main()
```

**빌드 + 회귀**:

```bash
cd app/frontend && npm run build
cd ../..
pytest tests/test_company_name.py tests/test_report_sentiment_markers_static.py -v
pytest tests/ --ignore=tests/backtesting -q
```

모두 통과해야 함.

### 작업 가이드라인

- **personality 스코어링 로직(`analyze_*`, `calculate_*`)은 절대 수정 금지**. 분석 결과 dict와 LLM 프롬프트만 건드림.
- **`COMPANY_IDENTITY_REQUIREMENT`와 `SENTIMENT_MARKER_REQUIREMENT`는 시스템 프롬프트의 끝에 별도 단락으로 추가**. 기존 페르소나 톤(Buffett 신중함, Lynch 활기 등) 깨지 않게.
- **렌더러 변경은 후방호환**: 마커 없는 줄은 기존처럼 그대로 렌더. parseSentimentMarker가 `tone: null`을 반환하면 색 띠 없이 plain.
- **회사명 fetch 실패는 graceful**: `resolve_company_name`이 ticker를 그대로 반환하면 LLM이 ticker를 사용해도 무방.
- **`@lru_cache`는 프로세스 수명 동안 유효**. 테스트마다 캐시 비우기 필요하면 `resolve_company_name.cache_clear()` 호출.
- **TypeScript strict 통과 필수**.
- **i18n**: 톤 범례 라벨은 인라인 ternary 또는 `t()` 키 추가 둘 다 OK. 키 추가 시 ko/en 양쪽.

### 보고 형식

작업 완료 후 다음을 출력:

1. **변경 파일 리스트** (신규 / 수정 분리)
2. **`pytest tests/test_company_name.py tests/test_report_sentiment_markers_static.py -v` 결과**
3. **`npm run build` 결과** (성공/실패 + 마지막 5줄)
4. **`pytest tests/ --ignore=tests/backtesting -q` 결과 (회귀)**
5. **수동 검증 가이드**: 사용자가 GLW / 005930.KS / AAPL 보고서를 재생성했을 때 무엇이 어떻게 달라져야 하는지 한 단락으로 요약

## ▲ 복붙 끝

---

## 보조: 사용자 직접 수동 검증 체크리스트

배포 후 브라우저(http://54.116.99.19/hedge)에서 종목 분석 탭으로:

- [ ] **GLW** 분석 → 보고서 본문이 "코닝(Corning Incorporated)"로 시작 (글래스웍스 X)
- [ ] **005930.KS** 분석 → "삼성전자(Samsung Electronics)"로 시작
- [ ] 보고서 상단에 ✓ ✗ – ? 4색 톤 범례 1줄
- [ ] 각 bullet/번호 항목 좌측에 색 띠 + 아이콘 (긍정 초록, 부정 빨강, 중립 주황, 공백 회색)
- [ ] LLM이 한 줄로 뭉친 출력도 휴리스틱으로 문단 분리되어 보임
- [ ] 한 줄도 영향 없는 헤딩(### / ##)은 색 띠 없이 큰 제목 그대로
