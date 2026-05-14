# Analyst Report v5 — Phase 2 상세 설계안

> Base: Phase 1 구현 완료 시점 (`IMPLEMENTATION_REPORT.md`).
> 전제: `app/frontend/src/components/reports/analyst-report-v5/` 13 개 파일이
> 이미 존재하고, `pytest --ignore=tests/backtesting -q` 242 pass, `tsc + vite
> build` clean 상태.
> 작성 목적: Codex Pro 5.5 가 이 파일만 보고 Phase 2 코드를 짤 수 있을 만큼
> 상세한 사양.

---

## §0. Phase 1 종료 시 미해결 / 본 문서가 해결할 7 개 결정

| # | 주제 | 현재 한계 (Phase 1) | 본 문서 §  |
|---|---|---|---|
| 1 | Multi-ticker | `decisions` 가 여러 ticker 를 가져도 첫 ticker 만 v5 에 들어감 | §1 |
| 2 | Reasoning 섹션 분해 | `KEYWORDS` 정규식 단일 매치, 같은 문단이 한 섹션에만 떨어짐 | §2 |
| 3 | Citation 정확도 | item 단위 휴리스틱, 신뢰도 표시 없음, href null 시 silent | §3 |
| 4 | Detail modal markdown | `<pre>` 로 단순 렌더 — heading / bold / list 사라짐 | §4 |
| 5 | `renderTextWithDataChips` API | 디자인은 ReactNode 반환, 구현은 component 사용 → 시그니처 충돌 | §5 |
| 6 | SensitivityHeatmap 활성 | 컴포넌트만 존재, backend emit 없음 | §6 |
| 7 | Target tile 데이터 출처 | active agent 만 의존 → 다른 agent 전환 시 타일 sparse | §7 |
| 8 | Mobile UX | `< lg` 에서 사이드바 모두 숨김, TOC 접근 불가 | §8 |

각 섹션은 **결정 (Decision) → 구현 사양 (Spec) → 코드 위치 (Where) → 테스트
(Tests)** 순서.

---

## §1. Multi-ticker 처리

### §1.1 결정

Phase 2 는 **multi-ticker view-model 만 도입**한다. Stock Analysis 탭의 입력
자체는 여전히 single-ticker 이지만:

- 저장된 분석 (`saved_analyses` 테이블) 이나 backtest 결과를 v5 가 불러올 때
  `decisions` 에 여러 ticker 가 들어 있을 수 있다.
- v5 는 그 모든 ticker 를 표시할 수 있어야 한다 (현재는 첫 ticker 만).
- 한 번에 한 ticker 만 화면에 보이고, 헤더 위 **TickerSwitcher** pill 로 전환.

### §1.2 Spec

#### §1.2.1 `<TickerSwitcher />` 신규 컴포넌트

위치: `report-layout.tsx` 안에 inline (별도 파일 아님).

```tsx
interface TickerSwitcherProps {
  tickers: string[];
  activeTicker: string;
  onSwitch: (ticker: string) => void;
  language: ReportLanguage;
}
```

렌더:

```tsx
<nav className="flex flex-wrap items-center gap-1.5" aria-label={t('tickerSwitcherLabel', language)}>
  {tickers.map(ticker => (
    <button
      key={ticker}
      type="button"
      onClick={() => onSwitch(ticker)}
      aria-current={ticker === activeTicker ? 'page' : undefined}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 font-mono text-sm transition-colors',
        ticker === activeTicker
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50',
      )}
    >
      {ticker}
    </button>
  ))}
</nav>
```

- `tickers.length === 1` 이면 컴포넌트 자체 hide (DOM 미렌더).
- 클릭 시 부모의 `setActiveTicker(ticker)` 호출.
- pill 폭은 contents fit. `flex-wrap` 으로 다중 줄 허용.

#### §1.2.2 `ReportLayout` state 확장

```tsx
const tickers = useMemo(
  () => Object.keys(completeResult.decisions ?? {}),
  [completeResult.decisions],
);
const [activeTicker, setActiveTicker] = useState<string>(tickers[0] ?? props.ticker);

// 부모에서 ticker prop 이 변하면 (e.g. saved run 복원) state 동기화
useEffect(() => {
  if (tickers.length === 0) return;
  if (!tickers.includes(activeTicker)) {
    setActiveTicker(tickers[0]);
  }
}, [tickers, activeTicker]);
```

기존 `ticker` prop 은 첫 값으로 fallback 만 사용. 내부 로직은 모두 `activeTicker`
사용.

#### §1.2.3 ticker 전환 시 reset 되는 state

| state | reset 정책 |
|---|---|
| `activeSectionId` | `'section-01'` 로 reset |
| `activeAgentKey` | `pickDefaultAgent(agentResults, activeTicker)` 재계산 |
| `selectedDetailReport` | `null` |
| TOC active 하이라이트 | IntersectionObserver 재구독 |

#### §1.2.4 ticker-scoped localStorage

기존 cross-check 체크박스 (`crosscheck:{ticker}`) 는 이미 ticker 별 namespacing
되어 있음 → 변경 불필요.

신규 Phase 2 에서 `activeAgent` 도 ticker 별로 기억할 수 있게:

- localStorage key: `analyst-report-v5:active-agent:{ticker}` (선택사항, 없으면
  default).
- Phase 2 에서는 **session 내에서만** 기억 (즉 `useState` 만, localStorage 미저장)
  으로 시작. 필요 시 Phase 3 에서 추가.

#### §1.2.5 helpers.ts 변경

- `pickDefaultAgent(agentResults: Map, activeTicker: string)`: 시그니처에
  `activeTicker` 추가. 사용:
  1. agentResults 중 status==='complete' 이면서 `agentResults.get(key).ticker
     === activeTicker` 인 agent 우선.
  2. 그 중에서 valuation_analyst 가 있으면 선택.
  3. 없으면 첫 complete.
  4. 없으면 첫 agent.
- `listOtherAgents(completeResult, activeAgentKey, ticker, ...)`: 기존 시그니처
  유지. `ticker` 가 이미 인자로 들어가 있음.

### §1.3 Where

| 파일 | 변경 |
|---|---|
| `report-layout.tsx` | TickerSwitcher inline component + activeTicker state + 전환 effect |
| `helpers.ts` | `pickDefaultAgent` 시그니처 확장 |
| `language-preferences.ts` | `tickerSwitcherLabel` 키 추가 |

### §1.4 Tests

`tests/test_analyst_report_v5_static.py` 에 추가:

```py
def test_layout_supports_multiple_tickers(self):
    src = (V5_DIR / 'report-layout.tsx').read_text()
    self.assertIn('TickerSwitcher', src)
    self.assertIn('activeTicker', src)
    self.assertIn('Object.keys(completeResult.decisions', src)

def test_pick_default_agent_takes_ticker(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    self.assertRegex(src, r'pickDefaultAgent\s*\([^)]*activeTicker')
```

---

## §2. Reasoning 섹션 분해 모델 (Normalized View Model)

### §2.1 결정

키워드-매치 단일 분배에서 **2 단계 모델** 로 전환:

1. **백엔드 explicit view model 우선** — `agentReport.structured_view` (또는
   `report.sections`) 가 존재하면 그대로 사용. 백엔드가 아직 emit 안 하므로 항상
   miss 하지만, future-proof.
2. **Sentence-level classifier** (Phase 2 의 실제 작업) — reasoning 을 문단이
   아니라 **문장 단위** 로 잘라서 각 문장을 6 섹션 중 하나로 분류. 분류 불가능한
   문장은 직전 분류 결과를 상속.

이렇게 하면 같은 문단 내에서 DCF / Multiples 두 키워드가 섞여 있어도 문장별로
바른 섹션에 떨어진다.

### §2.2 Spec

#### §2.2.1 새 타입

`types.ts` 에 추가:

```ts
export interface NormalizedReport {
  conclusion: string;
  valuationDcf: string;
  multiples: string;
  risks: string;
  crossCheck: string;
  sources: string;
}

export interface SentenceClassification {
  sentence: string;
  section: SectionId;
  confidence: 'high' | 'medium' | 'low';
  matchedKeywords: string[];
}
```

#### §2.2.2 새 helper: `normalizeAgentReport`

```ts
export function normalizeAgentReport(
  report: AgentReport | null,
  ticker: string,
  language: ReportLanguage,
): NormalizedReport;
```

알고리즘:

1. **Step 0 — backend view model 시도**:
   - `report?.structured_view` 가 객체이면 즉시 mapping 후 반환.
   - shape: `{ conclusion?: string; valuation_dcf?: string; multiples?: string;
     risks?: string; cross_check?: string; sources?: string }`.
2. **Step 1 — explicit markdown headings 시도**:
   - `reasoning` 안에 `^###?\s*결론|conclusion` / `^###?\s*밸류에이션|valuation`
     / `^###?\s*멀티플|multiples` / `^###?\s*리스크|risk` /
     `^###?\s*크로스\s*체크|cross.?check` / `^###?\s*출처|source` heading 이
     있으면, heading 간격으로 분할.
3. **Step 2 — sentence-level classifier**:
   - `reasoning` 을 sentence 로 split: `/(?<=[.!?다요음됨])\s+/` 기준 (한국어
     종결어미 + 영문 마침표).
   - 각 sentence 에 대해 키워드 hit table:

     | section | high keywords | medium keywords |
     |---|---|---|
     | section-02 | `DCF`, `FCFF`, `내재가치`, `intrinsic`, `WACC`, `discount cash flow`, `terminal value` | `valuation`, `fair value`, `할인` |
     | section-03 | `P/E`, `forward EPS`, `trailing`, `포워드 멀티플`, `multiples` | `EPS`, `이익`, `consensus` |
     | section-04 | `risk`, `약세`, `bear`, `손실`, `취약`, `downside`, `tail risk`, `bear thesis` | `위험`, `반대 의견`, `우려` |
     | section-05 | `cross-check`, `크로스체크`, `원문 대조`, `MD&A`, `transcript` | `verify`, `검증` |
   - high 매치 ≥ 1 → 그 section 으로 분류 (confidence high).
   - medium 매치만 ≥ 1 → 그 section (confidence medium).
   - 0 매치 → 직전 sentence 의 section (confidence low). 직전 없으면
     `section-01`.
4. **Step 3 — section-01 (conclusion)** 채우기:
   - 분류 결과에 section-01 sentence 가 없으면, 전체 reasoning 의 첫 2 문장 또는
     `report.signal` + `report.confidence` 한 줄로 합성:
     `signalToVerdict(...) (신뢰도 X%)` + 첫 문장.
5. **Step 4 — section-05 (cross-check) override**:
   - `extractCrossCheckGuideText(report)` 가 truthy 면 그 값으로 강제 교체.
   - 없으면 분류 결과의 section-05 텍스트 사용.
6. **Step 5 — section-06 (sources) override**:
   - `buildSourceTrackingText(report)` 결과 (URL 목록) 로 항상 교체.

#### §2.2.3 기존 `splitReasoningIntoSections` 처리

- 그대로 두되 **deprecated** 주석 추가.
- `report-body.tsx` 와 `report-section.tsx` 는 `normalizeAgentReport` 결과를
  소비하도록 교체.
- `splitReasoningIntoSections` 는 backward compat 을 위해 내부에서
  `normalizeAgentReport` 를 호출하고 6 키 record 를 반환하는 thin wrapper 로
  바꾸기.

#### §2.2.4 빈 데이터 / fallback

| 시나리오 | 동작 |
|---|---|
| `report === null` | 모든 섹션 빈 문자열. `report-section.tsx` 가 기존 placeholder 사용 |
| reasoning 짧음 (< 60 자) | 통째로 section-01 |
| explicit heading 매치 했는데 한 섹션 비어 있음 | 그 섹션은 빈 문자열로 |
| sentence-level 모두 low confidence | 모두 section-01 로 정렬 (재해석 안 함) |

### §2.3 Where

| 파일 | 변경 |
|---|---|
| `types.ts` | `NormalizedReport`, `SentenceClassification` 추가 |
| `helpers.ts` | `normalizeAgentReport`, sentence splitter, 키워드 테이블 |
| `report-body.tsx` | `normalizeAgentReport` 호출 후 6 섹션 분배 |
| `report-section.tsx` | section 텍스트 prop 만 받음 (변경 최소) |

### §2.4 Tests

```py
def test_normalize_report_function_exists(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    self.assertRegex(src, r'export function normalizeAgentReport\s*\(')

def test_normalized_report_type_exists(self):
    src = (V5_DIR / 'types.ts').read_text()
    self.assertIn('export interface NormalizedReport', src)
    self.assertIn('conclusion:', src)
    self.assertIn('valuationDcf:', src)
    self.assertIn('multiples:', src)
    self.assertIn('risks:', src)
    self.assertIn('crossCheck:', src)
    self.assertIn('sources:', src)

def test_body_uses_normalized_report(self):
    src = (V5_DIR / 'report-body.tsx').read_text()
    self.assertIn('normalizeAgentReport', src)
```

---

## §3. Citation 정확도

### §3.1 결정

세 가지 개선:

1. **Confidence-aware citation chips** — 휴리스틱이 high / medium / low 신뢰도
   를 함께 emit, 칩 시각 표현이 달라진다.
2. **Sentence-level inference** — 현재는 item 전체 텍스트로 추론하지만, 본문
   삽입은 sentence 단위로 정확히.
3. **Unavailable href feedback** — `alert()` 대신 toast (기존 `useToastManager`
   재사용) + 좌측 출처 패널의 해당 letter 항목에 "출처 미연결" tooltip.

### §3.2 Spec

#### §3.2.1 타입 확장

`types.ts`:

```ts
export type CitationConfidence = 'high' | 'medium' | 'low';

export interface CitationInference {
  letter: string;
  confidence: CitationConfidence;
  matchedKeyword: string;
}

// Citation 타입에 hrefAvailable 추가
export interface Citation {
  letter: string;
  labelKo: string;
  labelEn: string;
  typeKo: string;
  typeEn: string;
  href: string | null;
  hrefAvailable: boolean;   // !!href
}
```

#### §3.2.2 키워드 → confidence 테이블

`helpers.ts` 의 인용 룰 테이블 (현재 `inferCitationLetters` 안의 정규식) 을
**confidence 단계** 로 확장:

```ts
const CITATION_RULES: Array<{
  letter: string;
  highRegex: RegExp;        // 명시적 마커 또는 강한 키워드
  mediumRegex: RegExp;      // 일반 키워드
}> = [
  {
    letter: 'a',
    highRegex: /\b10-K\b|MD&A|사업보고서|annual report|연간보고서/i,
    mediumRegex: /DCF|FCFF|내재가치|intrinsic|discounted|운전자본|capex/i,
  },
  {
    letter: 'b',
    highRegex: /earnings call|어닝콜|transcript|conference call/i,
    mediumRegex: /경영진|guidance|가이던스|management commentary/i,
  },
  {
    letter: 'c',
    highRegex: /consensus EPS|컨센서스 EPS|analyst estimate/i,
    mediumRegex: /EPS|컨센|예측|forecast|estimate/i,
  },
  {
    letter: 'd',
    highRegex: /Damodaran|stern\.nyu/i,
    mediumRegex: /WACC|discount rate|beta|β|자본비용|cost of capital/i,
  },
  {
    letter: 'e',
    highRegex: /TrendForce|Gartner|IDC|Statista/i,
    mediumRegex: /시장 규모|TAM|섹터|점유율|market share|industry/i,
  },
];
```

#### §3.2.3 새 helper: `inferCitationInferences`

```ts
export function inferCitationInferences(
  sentence: string,
  sectionId: SectionId,
): CitationInference[];
```

- 각 rule 에 대해 high 매치하면 `{letter, confidence: 'high', matchedKeyword}`
  추가, 안 되면 medium 매치하면 medium 추가.
- 한 sentence 에 같은 letter 가 high 와 medium 동시 매치 시 high 만 유지.
- low confidence 분류는 직전 sentence 의 inferences 를 상속하지 않는다 (citation
  은 section 분류와 다름 — silent 가 낫다).

`inferCitationLetters` (기존) 는 backward compat:

```ts
export function inferCitationLetters(itemText: string, sectionId: SectionId): string[] {
  const sentences = splitSentences(itemText);
  const all = sentences.flatMap(s => inferCitationInferences(s, sectionId));
  return Array.from(new Set(all.map(i => i.letter))).sort();
}
```

#### §3.2.4 sentence-level citation 삽입

새 helper:

```ts
export function annotateTextWithCitations(
  text: string,
  sectionId: SectionId,
): Array<{ sentence: string; inferences: CitationInference[] }>;
```

- text 를 sentence 로 split.
- 각 sentence 에 대해 `inferCitationInferences` 실행.
- 본문 렌더 시 `<TextWithDataChips />` 가 이 결과를 받아 각 sentence 끝에
  CitationChip 들을 inline 렌더.

`<TextWithDataChips />` 시그니처 변경:

```tsx
interface TextWithDataChipsProps {
  text: string;
  tone: ReportTone;
  sectionId?: SectionId;     // 있으면 citation 도 inline 렌더
  citations?: Citation[];    // 매핑용
  language: ReportLanguage;
}
```

`sectionId` 가 있으면 sentence 분할 후 각 sentence 의 chips + 끝에 citation chip
들 emit. 없으면 기존 동작 (citation 미렌더).

#### §3.2.5 CitationChip 시각 표현 — confidence 별

`citation-chip.tsx` 에 prop 추가:

```tsx
interface CitationChipProps {
  letter: string;
  label?: string;
  type?: string;
  size?: 'sm' | 'md';
  confidence?: CitationConfidence;  // 신규
  hrefAvailable?: boolean;           // 신규
  onClick?: () => void;
}
```

confidence 별 스타일:

| confidence | 시각 |
|---|---|
| `high` | 채워진 동그라미: `bg-zinc-500 text-white` |
| `medium` | 테두리만: `border border-zinc-500 bg-transparent text-zinc-700` |
| `low` | dashed 테두리: `border border-dashed border-zinc-500/60 bg-transparent text-zinc-500` |

`hrefAvailable === false` 일 때 우상단에 작은 `?` 아이콘 추가:
`after:content-['?'] after:absolute after:-top-0.5 after:-right-0.5 after:text-[8px]`.

#### §3.2.6 클릭 동작 — href 없음 시

`report-toc-sidebar.tsx` 의 출처 항목 클릭 핸들러:

```tsx
const handleCitationClick = (citation: Citation) => {
  if (citation.href && citation.hrefAvailable) {
    window.open(citation.href, '_blank', 'noopener,noreferrer');
    return;
  }
  toast.info(
    t('sourceLinkUnavailable', language) + ': ' + (language === 'ko' ? citation.labelKo : citation.labelEn),
    `citation-${citation.letter}-unavailable`,
  );
};
```

- `toast` 는 `useToastManager` (`info` / `warn`) 사용. v5 에서는 부모인
  `report-layout.tsx` 에서 hook 호출하고 callback prop 으로 내려보내기:
  ```tsx
  const { info } = useToastManager();
  ...
  <ReportTocSidebar onCitationUnavailable={info} ... />
  ```
- `ReportTocSidebar` props 에 `onCitationUnavailable: (msg: string, id: string) => void` 추가.

본문의 CitationChip 클릭 시:
- href 있으면 새 탭.
- 없으면 좌측 출처 패널 해당 행으로 `scrollIntoView` 후 동일 toast.

#### §3.2.7 출처 패널 footer 안내

좌측 TOC 의 출처 리스트 아래에 small print:

```tsx
<p className="mt-2 px-3 text-[10px] leading-relaxed text-muted-foreground">
  {t('citationAutoNote', language)}
</p>
```

i18n 키 `citationAutoNote`:
- ko: `자동 분류 — 원문 대조로 정확성을 확인하세요.`
- en: `Auto-classified — verify with original source.`

### §3.3 Where

| 파일 | 변경 |
|---|---|
| `types.ts` | `CitationConfidence`, `CitationInference` 추가, `Citation` 확장 |
| `helpers.ts` | `CITATION_RULES`, `inferCitationInferences`, `annotateTextWithCitations`, `splitSentences`; `buildCitations` 가 `hrefAvailable` 채움 |
| `citation-chip.tsx` | confidence / hrefAvailable prop 처리 |
| `inline-data-chip.tsx` | `<TextWithDataChips />` 에 sectionId/citations/language prop 추가 |
| `evidence-item.tsx` | TextWithDataChips 호출 시 sectionId/citations 전달 |
| `report-toc-sidebar.tsx` | `onCitationUnavailable` prop, footer 안내 |
| `report-layout.tsx` | `useToastManager` 연결 |
| `language-preferences.ts` | `citationAutoNote` 추가 |

### §3.4 Tests

```py
def test_citation_confidence_levels_defined(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    self.assertIn('highRegex', src)
    self.assertIn('mediumRegex', src)
    self.assertIn('CITATION_RULES', src)

def test_citation_chip_handles_confidence_and_href(self):
    src = (V5_DIR / 'citation-chip.tsx').read_text()
    self.assertIn('confidence', src)
    self.assertIn('hrefAvailable', src)

def test_citation_auto_note_in_toc(self):
    src = (V5_DIR / 'report-toc-sidebar.tsx').read_text()
    self.assertIn('citationAutoNote', src)
```

---

## §4. Detail modal markdown 렌더링

### §4.1 결정

`stock-search-tab.tsx` 의 markdown 렌더 헬퍼들을 **공용 모듈**로 추출하고 v5
`DetailReportModal` 에서 import.

### §4.2 Spec

#### §4.2.1 새 파일: `app/frontend/src/lib/markdown-blocks.tsx`

다음 함수와 상수를 stock-search-tab.tsx 에서 옮겨 옴:

- `formatDecisionReasoning(value: unknown): string`
- `normalizeCrossCheckGuideHeading(markdown: string): string`
- `ensureParagraphBreaks(markdown: string): string`
- `renderInlineMarkdown(text: string): ReactNode`
- `renderTonedContent(text: string): ReactNode`
- `renderMarkdownBlocks(markdown: string): ReactNode`

토널 처리는 기존 `parseSentimentMarker` / `REPORT_TONE_STYLES` 를 그대로 사용
(`@/components/reports/report-sentiment-dashboard` 에서 import).

#### §4.2.2 stock-search-tab.tsx 변경

inline 정의된 위 6 함수를 모두 삭제하고 `from '@/lib/markdown-blocks'` import.

기존 test `test_final_decision_reasoning_is_split_into_markdown_blocks` 는
"stock-search-tab 안에 함수 정의" 를 검사함:

```py
self.assertIn("function formatDecisionReasoning", source)
self.assertIn("function normalizeCrossCheckGuideHeading", source)
```

이 두 줄을 **수정**:

```py
self.assertIn("formatDecisionReasoning", source)        # import 또는 사용
self.assertIn("from '@/lib/markdown-blocks'", source)
```

#### §4.2.3 v5 DetailReportModal 변경

`report-layout.tsx` 의 `DetailReportModal` body:

```tsx
import {
  formatDecisionReasoning,
  ensureParagraphBreaks,
  renderMarkdownBlocks,
} from '@/lib/markdown-blocks';

// 모달 body 안에서:
<div className="prose prose-sm dark:prose-invert max-w-none [&_h2]:text-base [&_h3]:text-sm">
  {renderMarkdownBlocks(ensureParagraphBreaks(formatDecisionReasoning(detail.markdown)))}
</div>
```

기존 `<pre>` 블록 제거.

#### §4.2.4 modal shell — bottom sheet on mobile

`< lg` 에서 modal 을 화면 하단 sheet 로 표시:

```tsx
<div
  className={cn(
    'fixed inset-0 z-50 flex bg-background/80 backdrop-blur-sm',
    'items-end lg:items-center',
    'justify-center',
  )}
>
  <div
    className={cn(
      'flex w-full flex-col bg-background shadow-xl',
      'max-h-[85vh] lg:max-h-[85vh] lg:max-w-4xl',
      'rounded-t-lg lg:rounded-lg',
    )}
  >
    ...
  </div>
</div>
```

mobile: 화면 아래에서 위로 올라옴, 상단 둥근 모서리만.
desktop: 가운데 정렬, 사방 둥근 모서리.

### §4.3 Where

| 파일 | 변경 |
|---|---|
| `app/frontend/src/lib/markdown-blocks.tsx` | **신규** (6 함수 이동) |
| `app/frontend/src/components/tabs/stock-search-tab.tsx` | inline 정의 삭제, import 추가 |
| `app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx` | DetailReportModal body 교체, sheet shell |

### §4.4 Tests

```py
def test_markdown_blocks_module_exists(self):
    p = ROOT / 'app/frontend/src/lib/markdown-blocks.tsx'
    self.assertTrue(p.exists())
    src = p.read_text()
    for fn in ['formatDecisionReasoning', 'normalizeCrossCheckGuideHeading',
              'ensureParagraphBreaks', 'renderMarkdownBlocks',
              'renderInlineMarkdown', 'renderTonedContent']:
        self.assertRegex(src, rf'export (function|const) {fn}\b')

def test_stock_search_imports_from_markdown_module(self):
    src = STOCK_TAB.read_text()
    self.assertIn("from '@/lib/markdown-blocks'", src)
    # 인라인 정의는 사라졌어야 함
    self.assertNotIn('function renderMarkdownBlocks(', src)
    self.assertNotIn('function ensureParagraphBreaks(', src)

def test_v5_modal_uses_shared_markdown_helpers(self):
    src = (V5_DIR / 'report-layout.tsx').read_text()
    self.assertIn("from '@/lib/markdown-blocks'", src)
    self.assertIn('renderMarkdownBlocks(', src)
    self.assertNotIn('<pre className="whitespace-pre-wrap break-words text-sm', src)
```

`test_final_decision_reasoning_is_split_into_markdown_blocks` 도 그에 맞춰
수정.

---

## §5. `renderTextWithDataChips` API 정리

### §5.1 결정

**컴포넌트 방식을 canonical 로 확정**. helpers.ts 는 데이터 함수만, JSX 는
컴포넌트.

### §5.2 Spec

- `helpers.ts` 의 `renderTextWithDataChips` 함수를 **삭제**.
- 대신 데이터 추출 helper 만 export:
  ```ts
  export function splitTextIntoDataTokenParts(text: string): Array<
    | { kind: 'text'; value: string }
    | { kind: 'token'; value: string; tone: ReportTone }
  >;
  export function findDataTokenReferences(text: string): Array<{
    index: number; length: number; raw: string; tone: ReportTone;
  }>;
  export function classifyDataTokenTone(
    token: string,
    surroundingText: string,
    itemTone: ReportTone,
  ): ReportTone;
  ```
- 렌더는 `<TextWithDataChips />` 컴포넌트 (`inline-data-chip.tsx`) 가 단일
  진입점. §3.2.4 에 따라 prop 확장.
- 모든 호출처는 컴포넌트 사용:
  ```tsx
  <TextWithDataChips
    text={body}
    tone={tone}
    sectionId={sectionId}
    citations={citations}
    language={language}
  />
  ```

### §5.3 Where

| 파일 | 변경 |
|---|---|
| `helpers.ts` | `renderTextWithDataChips` 제거, 데이터 helper 명시적 export |
| `inline-data-chip.tsx` | `<TextWithDataChips />` 가 sentence-level citation 처리도 담당 |
| `evidence-item.tsx` | 컴포넌트 호출만 (변경 최소) |

### §5.4 Tests

```py
def test_helpers_no_longer_exports_render_text_with_data_chips(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    self.assertNotIn('export function renderTextWithDataChips', src)
    self.assertNotIn('export const renderTextWithDataChips', src)

def test_helpers_exports_data_token_helpers(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    for fn in ['splitTextIntoDataTokenParts', 'findDataTokenReferences',
              'classifyDataTokenTone']:
        self.assertRegex(src, rf'export function {fn}\b')

def test_inline_data_chip_component_is_canonical(self):
    src = (V5_DIR / 'inline-data-chip.tsx').read_text()
    self.assertIn('export function TextWithDataChips', src)
    self.assertIn('sectionId', src)
    self.assertIn('citations', src)
```

---

## §6. SensitivityHeatmap Phase 2 활성 조건

### §6.1 결정

Phase 2 에서 **백엔드 emit + 프론트엔드 활성**을 동시에 진행. 백엔드 PR 이
선행되어야 프론트엔드가 렌더 가능하지만, 두 작업을 **단일 커밋**으로 묶는다 (UI
가 즉시 살아나야 사용자가 알 수 있음).

### §6.2 Spec — 백엔드

#### §6.2.1 `src/agents/valuation.py`

- 새 helper: `_build_sensitivity_matrix(intrinsic_value_fn, base_wacc,
  base_growth) -> list[list[dict]]`.
- WACC grid: `[base_wacc - 0.025, base_wacc - 0.015, base_wacc, base_wacc +
  0.01, base_wacc + 0.02]` (절댓값으로 % 단위, 즉 base_wacc=0.136 이면 grid =
  [0.111, 0.121, 0.136, 0.146, 0.156]).
- g grid: `[base_growth - 0.01, base_growth - 0.005, base_growth, base_growth +
  0.005, base_growth + 0.01]`.
- 각 (w, g) 셀에서 `intrinsic_value_fn(wacc=w, growth=g)` 호출 후
  `safety_margin = (intrinsic - current_price) / current_price`.
- 셀 dict: `{"wacc": float, "growth": float, "intrinsic_value": float, "safety_margin": float}`.
- 결과는 `reasoning_dict["forward_per_analysis"]["sensitivity_matrix"]` 또는
  최상위 `reasoning_dict["sensitivity_matrix"]` 키에 저장 (후자 권장 — 위치 평탄).
- 메모리 / 비용 고려: 5×5 = 25 회 DCF 계산. valuation agent 가 이미 1 번 하는
  시간의 ~25 배. 허용 가능 (전체 분석 사이클의 작은 부분).
- 비활성 조건: `base_wacc` 또는 `base_growth` 가 None 이거나
  `intrinsic_value_fn` 이 실패하면 matrix 미생성 (key 자체 미포함).

#### §6.2.2 LLM payload 영향

`forward_outlook.py` 의 build block 은 **변경하지 않는다** — sensitivity 는
시각화 전용 데이터, LLM 에는 보내지 않음. token 비용 절약.

### §6.3 Spec — 프론트엔드

#### §6.3.1 새 helper

```ts
export function extractSensitivityMatrix(
  report: AgentReport | null,
): Array<Array<{ wacc: number; growth: number; safetyMargin: number; intrinsicValue: number }>> | null;
```

- `report?.sensitivity_matrix` 또는
  `report?.reasoning?.forward_per_analysis?.sensitivity_matrix` 찾기 (양쪽 위치
  지원, 우선순위는 top-level 이 위).
- shape 검증: outer length ≥ 3, inner length ≥ 3, 모든 셀이 4 키 다 있음.
- 실패 시 null.

#### §6.3.2 활성 기준 (모든 조건 만족 시 렌더)

```ts
function shouldShowSensitivity(
  activeAgentKey: string,
  matrix: ReturnType<typeof extractSensitivityMatrix>,
): boolean {
  if (!matrix) return false;
  if (matrix.length < 3 || matrix[0].length < 3) return false;
  // valuation persona 또는 valuation_analyst 일 때만
  if (activeAgentKey !== 'valuation_analyst' && activeAgentKey !== 'aswath_damodaran') return false;
  return true;
}
```

#### §6.3.3 렌더 위치

`report-section.tsx` 의 `section-02` (밸류에이션) 끝부분, evidence items 다음에:

```tsx
{sectionId === 'section-02' && (
  <SensitivityHeatmap
    matrix={matrix}
    currentWacc={baseWacc}
    currentGrowth={baseGrowth}
    language={language}
  />
)}
```

`SensitivityHeatmap` 이 내부에서 `shouldShowSensitivity` 검사 후 null 반환 가능
하게 짜는 게 깔끔.

#### §6.3.4 SensitivityHeatmap 시각

5×5 grid:

| 항목 | 클래스 |
|---|---|
| 컨테이너 | `mt-4 rounded-lg border border-border/60 bg-muted/15 p-3` |
| 타이틀 | `mb-3 text-xs font-semibold text-foreground` "WACC × 성장률 — 안전마진 민감도" |
| Grid | `grid grid-cols-6 gap-px text-[10px]` (5 데이터 컬럼 + 1 라벨) |
| 헤더 행 | g=1.5%, g=2.0%, ... 표시 |
| 라벨 컬럼 | WACC 값 표시 |
| 셀 base | `aspect-square flex items-center justify-center font-mono font-medium` |
| 셀 색 | safety_margin 에 따라 (§7.2 와 동일 그라데이션) |
| 현재 가정 셀 | `border-2 border-yellow-400` |

색 그라데이션 (inline style):
- `safety_margin <= -0.6` → `#7f1d1d` (text white)
- `-0.6 < x <= -0.3` → `#dc2626` (text white)
- `-0.3 < x <= -0.1` → `#f59e0b` (text foreground)
- `-0.1 < x <= 0.1` → `#fbbf24` (text foreground)
- `> 0.1` → `#10b981` (text white)

### §6.4 Where

| 파일 | 변경 |
|---|---|
| `src/agents/valuation.py` | `_build_sensitivity_matrix` 추가, reasoning_dict 에 key 추가 |
| `app/frontend/src/components/reports/analyst-report-v5/helpers.ts` | `extractSensitivityMatrix`, `shouldShowSensitivity` |
| `app/frontend/src/components/reports/analyst-report-v5/sensitivity-heatmap.tsx` | 실제 렌더 로직 작성, null 반환 가드 |
| `app/frontend/src/components/reports/analyst-report-v5/report-section.tsx` | section-02 에서 SensitivityHeatmap 호출 |
| `app/frontend/src/lib/language-preferences.ts` | `sensitivityTitle`, `sensitivityCurrentAssumption` |

### §6.5 Tests

```py
def test_valuation_emits_sensitivity_matrix(self):
    src = (ROOT / 'src/agents/valuation.py').read_text()
    self.assertIn('_build_sensitivity_matrix', src)
    self.assertIn('sensitivity_matrix', src)

def test_v5_extracts_sensitivity_matrix(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    self.assertIn('extractSensitivityMatrix', src)
    self.assertIn('shouldShowSensitivity', src)

def test_v5_section_02_renders_heatmap(self):
    src = (V5_DIR / 'report-section.tsx').read_text()
    self.assertIn('SensitivityHeatmap', src)
    self.assertIn("'section-02'", src)
```

신규 unit test (Python):

```py
# tests/test_valuation_sensitivity_matrix.py
def test_sensitivity_matrix_shape():
    from src.agents.valuation import _build_sensitivity_matrix
    fn = lambda wacc, growth: 100.0 * (growth / (wacc - growth))
    m = _build_sensitivity_matrix(fn, base_wacc=0.136, base_growth=0.025,
                                  current_price=100.0)
    assert len(m) == 5
    assert all(len(row) == 5 for row in m)
    for row in m:
        for cell in row:
            assert set(cell.keys()) == {'wacc', 'growth', 'intrinsic_value', 'safety_margin'}
```

---

## §7. Target tile 데이터 출처 — Canonical Metrics Pool

### §7.1 결정

Active agent 보고서만 보지 않고, **여러 agent 의 메트릭을 합쳐 canonical pool**
을 만든 다음 거기서 타일을 채운다. 각 타일은 어느 agent 가 출처인지 표시.

### §7.2 Spec

#### §7.2.1 새 타입

`types.ts`:

```ts
export interface CanonicalMetric {
  value: number;
  sourceAgentKey: string;
  sourceAgentNameKo: string;
  sourceAgentNameEn: string;
  isFromActiveAgent: boolean;
}

export interface CanonicalMetrics {
  forwardEpsFy0?: CanonicalMetric;
  forwardEpsTtm?: CanonicalMetric;
  intrinsicValue?: CanonicalMetric;
  marginOfSafety?: CanonicalMetric;
  interestCoverage?: CanonicalMetric;
  beta?: CanonicalMetric;
  wacc?: CanonicalMetric;
  forwardPeFy0?: CanonicalMetric;
  forwardPe?: CanonicalMetric;
  currentPrice?: CanonicalMetric;
}

// TargetTile 확장
export interface TargetTile {
  labelKey: string;
  sublabelKey: string;
  value: string;
  tone: ReportTone;
  sourceAgent?: { key: string; nameKo: string; nameEn: string }; // 신규
  isFromActiveAgent: boolean;                                     // 신규
}
```

#### §7.2.2 우선순위 매트릭스

| 메트릭 | 1순위 | 2순위 | 3순위 (fallback) |
|---|---|---|---|
| forwardEpsFy0 / forwardEpsTtm | active | valuation_analyst | 첫 has-value |
| intrinsicValue | active (있을 때만) | valuation_analyst | aswath_damodaran |
| marginOfSafety | active | valuation_analyst | 계산 (intrinsic / current_price) |
| interestCoverage | active | fundamentals_analyst | 첫 has-value |
| beta | active | fundamentals_analyst | charlie_munger / nassim_taleb |
| wacc | active | valuation_analyst | aswath_damodaran |
| forwardPeFy0 / forwardPe | active | valuation_analyst | 첫 has-value |
| currentPrice | 모든 agent 공통 — 첫 has-value |

#### §7.2.3 새 helper: `buildCanonicalMetrics`

```ts
export function buildCanonicalMetrics(
  activeAgentKey: string,
  completeResult: CompleteResult,
  ticker: string,
): CanonicalMetrics;
```

알고리즘:

1. `activeReport = getAgentReport(completeResult.analyst_signals, activeAgentKey,
   ticker)`.
2. 우선순위 매트릭스의 각 메트릭에 대해, 1순위 → 2순위 → 3순위 순으로 시도해서
   첫 not-null value 반환. value 가 나온 agent key 와 함께 `CanonicalMetric`
   객체 build.
3. 둘러볼 reports map: `{ active: activeReport, valuation_analyst:
   getAgentReport(..., 'valuation_analyst', ticker), fundamentals_analyst: ...
   }` 형식. 모든 agent 를 다 보지는 않고 매트릭스에 등장한 agent 만.
4. 계산 fallback (예: marginOfSafety = (intrinsic - current_price) / current_price)
   은 모든 직접 후보 miss 후 마지막에 시도.

#### §7.2.4 `extractTargetTiles` 변경

```ts
export function extractTargetTiles(
  metrics: CanonicalMetrics,
  activeAgentKey: string,
  language: ReportLanguage,
): TargetTile[];
```

- 기존 `report, currentPrice, language` 시그니처 → `metrics, activeAgentKey,
  language` 로 교체.
- 호출처 (`report-layout.tsx`) 변경: 먼저 `buildCanonicalMetrics` 호출 후 결과
  를 `extractTargetTiles` 에 전달.

#### §7.2.5 TargetDataSidebar 시각

타일이 active 가 아닌 agent 에서 왔으면 우측 상단에 작은 칩:

```tsx
{tile.sourceAgent && !tile.isFromActiveAgent && (
  <span
    className="absolute right-1 top-1 rounded-full bg-muted/60 px-1.5 py-px text-[8px] font-medium text-muted-foreground"
    title={tile.sourceAgent.nameKo}
  >
    {tile.sourceAgent.nameKo[0]}
  </span>
)}
```

타일 자체 `position: relative` 처리.

#### §7.2.6 빈 데이터

- 모든 메트릭이 null 인 경우 사이드바에 "데이터 부족" 메시지 (i18n
  `targetDataEmpty`).
- 1 개 이상 있으면 그것만 보여주고 빈 slot 은 무시.

### §7.3 Where

| 파일 | 변경 |
|---|---|
| `types.ts` | `CanonicalMetric`, `CanonicalMetrics`, `TargetTile` 확장 |
| `helpers.ts` | `buildCanonicalMetrics`, `extractTargetTiles` 시그니처 변경 |
| `report-layout.tsx` | `buildCanonicalMetrics` 먼저 호출 |
| `target-data-sidebar.tsx` | 소스 agent 칩 표시 |
| `language-preferences.ts` | `targetDataEmpty`, `targetTileFromAgent` 키 |

### §7.4 Tests

```py
def test_canonical_metrics_helper(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    self.assertIn('buildCanonicalMetrics', src)
    self.assertIn('CanonicalMetrics', src)

def test_target_tile_has_source_agent(self):
    src = (V5_DIR / 'types.ts').read_text()
    self.assertIn('sourceAgent', src)
    self.assertIn('isFromActiveAgent', src)

def test_sidebar_shows_source_agent_chip(self):
    src = (V5_DIR / 'target-data-sidebar.tsx').read_text()
    self.assertIn('sourceAgent', src)
```

---

## §8. 모바일 / 반응형 UX

### §8.1 결정

3 단계 breakpoint:

| 폭 | 구조 |
|---|---|
| ≥ 1024 (`lg`) | 3-col: TOC + body + sidebar (Phase 1 그대로) |
| 768–1023 (`md`) | 2-col: body + sidebar (TOC → horizontal pill scroll 위로) |
| < 768 (`sm` 이하) | 1-col: stacked. body 위에 horizontal TOC, body 아래에 sidebar 콘텐츠 |

### §8.2 Spec

#### §8.2.1 ReportLayout 컨테이너

```tsx
<div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
  <ReportTocSidebar
    {...props}
    variant="desktop"
    className="hidden lg:flex"
  />
  <ReportTocSidebarMobile
    {...props}
    className="lg:hidden"
  />
  <ReportBody {...props} className="min-w-0 flex-1" />
  <TargetDataSidebar
    {...props}
    className="lg:flex"   // mobile 에서도 보이게 (full width)
  />
</div>
```

#### §8.2.2 `ReportTocSidebarMobile` 신규 인라인 컴포넌트

`report-toc-sidebar.tsx` 안에 `MobileToc` 를 추가 export. 가로 pill scroll:

```tsx
<div className="sticky top-2 z-10 -mx-4 overflow-x-auto bg-background/95 backdrop-blur px-4 py-2 lg:hidden">
  <div className="flex gap-1.5">
    {sections.map(sec => (
      <button
        key={sec.id}
        onClick={() => scrollToSection(sec.id)}
        aria-current={activeSectionId === sec.id ? 'location' : undefined}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs',
          'min-h-[44px]',  // touch target
          activeSectionId === sec.id
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-muted/30 text-muted-foreground',
        )}
      >
        <span className="font-mono text-[10px]">{sec.number}</span>
        <span>{language === 'ko' ? sec.titleKo : sec.titleEn}</span>
      </button>
    ))}
  </div>
</div>
```

출처 패널은 mobile 에서 `<details>` collapsible 로 body 아래에 노출 (또는 우측
sidebar 가 mobile 에서 full-width 로 stack 되니, sidebar 안에 출처 카드도 통합
가능 — Phase 2 에서는 sidebar 와 별도 details 블럭으로 처리).

#### §8.2.3 TargetDataSidebar 반응형

```tsx
<aside
  className={cn(
    'flex flex-col gap-4 w-full lg:w-[280px] lg:flex-shrink-0',
    'lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto',
  )}
>
  {/* tiles: grid */}
  <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
    {tiles.map(...)}
  </div>
  {/* other agents */}
  <div>{...}</div>
</aside>
```

- `lg+`: sticky 1 컬럼, 280px.
- `md` 이하: sticky 해제, full width, 타일 2 컬럼.

#### §8.2.4 헤더 verdict ribbon 반응형

```tsx
<header className="rounded-lg border bg-...">
  <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-6">
    <ScoreGaugeCompact ... className="self-center lg:self-auto" />
    <div className="min-w-0 flex-1">{/* badges + meta */}</div>
    <div className="flex gap-2 lg:flex-col">{/* PDF + 원문대조 */}</div>
  </div>
  <div className="grid grid-cols-2 gap-2 border-t p-4 lg:grid-cols-4 lg:gap-4">
    {/* verdict pills row */}
  </div>
</header>
```

- mobile: 게이지 위, 배지 + 메타 가운데, 버튼 아래 / 옆 stack.
- desktop: 가로 정렬.

#### §8.2.5 Touch target 최소 크기

모든 click target (TOC pill, agent row, citation chip, PDF/원문대조 버튼) 의
mobile breakpoint 에서 `min-h-[44px] min-w-[44px]` 적용.

#### §8.2.6 텍스트 크기

| 항목 | mobile | desktop |
|---|---|---|
| body 본문 | `text-sm` | `text-sm` |
| section number | `text-xl` | `text-2xl` |
| section heading | `text-base` | `text-lg` |
| tile value | `text-base` | `text-lg` |
| tile label | `text-[10px]` | `text-[10px]` |
| inline data chip | `text-[10px]` | `text-[11px]` |

#### §8.2.7 DetailReportModal mobile

§4.2.4 의 sheet 스타일 그대로.

### §8.3 시각 QA 기준

각 breakpoint 에서:

| QA 항목 | 검사 방법 |
|---|---|
| TOC 6 개 모두 접근 가능 | mobile pill scroll 좌→우 확인 |
| 본문 가로 스크롤 X | 본문 `min-w-0` 적용, overflow hidden 확인 |
| 우측 사이드바 콘텐츠 표시 | mobile 에서 body 아래 stack 확인 |
| 게이지 크기 ≥ 56px | `h-14 w-14` 클래스 확인 |
| 모달 닫기 버튼 ≥ 44px | `h-11 w-11` |
| 인용 chip 클릭 가능 (mobile) | 칩 padding `px-1.5 py-1` 로 늘림 |
| dark mode 색 대비 | tone-classes 확인 (이미 dark: variant 적용됨) |

### §8.4 Where

| 파일 | 변경 |
|---|---|
| `report-layout.tsx` | 컨테이너 flex 방향 반응형 |
| `report-toc-sidebar.tsx` | desktop + mobile (`MobileToc`) 모두 export |
| `target-data-sidebar.tsx` | grid 컬럼 반응형 |
| `report-header-ribbon.tsx` | flex direction 반응형 |
| `citation-chip.tsx` | mobile padding 확장 |
| `evidence-item.tsx` | 텍스트 크기 반응형 |

### §8.5 Tests

```py
def test_layout_has_mobile_toc(self):
    src = (V5_DIR / 'report-toc-sidebar.tsx').read_text()
    self.assertRegex(src, r'export (function|const) MobileToc\b')

def test_layout_responsive_classes(self):
    src = (V5_DIR / 'report-layout.tsx').read_text()
    self.assertIn('lg:flex-row', src)
    self.assertIn('lg:hidden', src)

def test_target_sidebar_responsive_grid(self):
    src = (V5_DIR / 'target-data-sidebar.tsx').read_text()
    self.assertIn('grid-cols-2', src)
    self.assertIn('lg:grid-cols-1', src)

def test_header_ribbon_responsive(self):
    src = (V5_DIR / 'report-header-ribbon.tsx').read_text()
    self.assertIn('lg:flex-row', src)
    self.assertIn('flex-col', src)
```

---

## §9. 파일 / API 변경 정리표

### §9.1 신규 파일

```
app/frontend/src/lib/markdown-blocks.tsx                     [§4]
tests/test_analyst_report_v5_phase2_static.py                 [모든 § 의 통합 static]
tests/test_valuation_sensitivity_matrix.py                    [§6 unit]
```

### §9.2 수정 파일 (frontend)

```
app/frontend/src/components/reports/analyst-report-v5/types.ts            [§1, §2, §3, §7]
app/frontend/src/components/reports/analyst-report-v5/helpers.ts          [§1, §2, §3, §5, §6, §7]
app/frontend/src/components/reports/analyst-report-v5/report-layout.tsx   [§1, §3, §4, §7, §8]
app/frontend/src/components/reports/analyst-report-v5/report-header-ribbon.tsx [§8]
app/frontend/src/components/reports/analyst-report-v5/report-toc-sidebar.tsx   [§3, §8]
app/frontend/src/components/reports/analyst-report-v5/report-body.tsx     [§2]
app/frontend/src/components/reports/analyst-report-v5/report-section.tsx  [§6]
app/frontend/src/components/reports/analyst-report-v5/evidence-item.tsx   [§3, §5, §8]
app/frontend/src/components/reports/analyst-report-v5/inline-data-chip.tsx [§3, §5, §8]
app/frontend/src/components/reports/analyst-report-v5/citation-chip.tsx   [§3, §8]
app/frontend/src/components/reports/analyst-report-v5/target-data-sidebar.tsx [§7, §8]
app/frontend/src/components/reports/analyst-report-v5/sensitivity-heatmap.tsx [§6]
app/frontend/src/components/tabs/stock-search-tab.tsx                     [§4]
app/frontend/src/lib/language-preferences.ts                              [§1, §3, §6, §7]
```

### §9.3 수정 파일 (backend)

```
src/agents/valuation.py                                       [§6]
```

### §9.4 i18n 신규 키

```ts
// ko / en
tickerSwitcherLabel: '종목 전환' / 'Switch Ticker',
citationAutoNote: '자동 분류 — 원문 대조로 정확성을 확인하세요.' / 'Auto-classified — verify with original source.',
sensitivityTitle: 'WACC × 성장률 — 안전마진 민감도' / 'WACC × Growth — Margin-of-Safety Sensitivity',
sensitivityCurrentAssumption: '현재 가정' / 'Current assumption',
targetDataEmpty: '핵심 타겟 데이터가 부족합니다.' / 'Target data is incomplete.',
targetTileFromAgent: '{name} 출처' / 'From {name}',
mobileTocLabel: '섹션' / 'Sections',
```

---

## §10. 통합 테스트 계획

### §10.1 신규 통합 static 테스트 — `test_analyst_report_v5_phase2_static.py`

위 §1.4, §2.4, §3.4, §4.4, §5.4, §6.5, §7.4, §8.5 의 assertion 을 모두 한
파일에 정리. 클래스 이름: `AnalystReportV5Phase2StaticTests`.

### §10.2 백엔드 unit — `test_valuation_sensitivity_matrix.py`

§6.5 의 Python unit. mock intrinsic 함수로 5×5 매트릭스 형태 검증.

### §10.3 회귀 테스트 영향

| 기존 테스트 | 영향 | 조치 |
|---|---|---|
| `test_analyst_report_v5_static.py` | helpers 시그니처 일부 변경 | §1.4 / §5.4 에 따라 갱신 |
| `test_stock_search_final_decision_ui_static.py::test_final_decision_reasoning_is_split_into_markdown_blocks` | inline 함수 정의 검사 → import 검사로 교체 | §4.4 |
| 기존 v5 dashboard 검사 | 모두 통과해야 함 | 변경 없음 |
| backend valuation tests | sensitivity matrix 키 존재 검사 추가 가능 | optional |

### §10.4 빌드 / 타입 / 린트

- `pytest tests/ --ignore=tests/backtesting -q` → 모두 pass.
- `tsc --noEmit` → 0 errors.
- `vite build` → succeeds.

---

## §11. 구현 순서

1. **types.ts** — `NormalizedReport`, `SentenceClassification`,
   `CitationConfidence`, `CitationInference`, `Citation.hrefAvailable`,
   `CanonicalMetric/CanonicalMetrics`, `TargetTile` 확장.
2. **helpers.ts**:
   - `pickDefaultAgent` 시그니처 확장 (§1).
   - sentence splitter + `normalizeAgentReport` + `CITATION_RULES` +
     `inferCitationInferences` + `annotateTextWithCitations` (§2, §3).
   - `splitTextIntoDataTokenParts` / `findDataTokenReferences` /
     `classifyDataTokenTone` (§5).
   - `extractSensitivityMatrix` / `shouldShowSensitivity` (§6).
   - `buildCanonicalMetrics` + `extractTargetTiles` 시그니처 변경 (§7).
   - `renderTextWithDataChips` 제거 (§5).
   - `buildCitations` 가 `hrefAvailable` 채움 (§3).
3. **markdown-blocks.tsx** 신규 — 6 함수 이동 (§4).
4. **stock-search-tab.tsx** — markdown 함수 inline 제거, import 교체 (§4).
5. **inline-data-chip.tsx** — `<TextWithDataChips />` 가 sentence-level
   citations 처리 (§3, §5).
6. **citation-chip.tsx** — confidence / hrefAvailable prop, 시각 분기 (§3).
7. **evidence-item.tsx** — `<TextWithDataChips />` 호출 시 sectionId, citations,
   language 전달 (§3, §5, §8).
8. **report-body.tsx** — `normalizeAgentReport` 호출 (§2).
9. **report-section.tsx** — section-02 에서 SensitivityHeatmap 렌더 (§6, §8).
10. **report-toc-sidebar.tsx** — `MobileToc` export, `onCitationUnavailable` prop,
    footer auto-note (§3, §8).
11. **target-data-sidebar.tsx** — canonical metrics 기반 타일, source agent 칩,
    반응형 grid (§7, §8).
12. **sensitivity-heatmap.tsx** — 실제 렌더 + null 가드 (§6).
13. **report-header-ribbon.tsx** — 반응형 flex (§8).
14. **report-layout.tsx**:
    - `activeTicker` state, TickerSwitcher inline (§1).
    - `buildCanonicalMetrics` 호출 (§7).
    - `useToastManager` 연결 (§3).
    - DetailReportModal markdown 렌더 + sheet shell (§4).
    - 반응형 컨테이너 (§8).
15. **language-preferences.ts** — i18n 키 추가 (§1, §3, §6, §7, §8).
16. **`src/agents/valuation.py`** — `_build_sensitivity_matrix` (§6).
17. **테스트** — §10.1, §10.2 추가; §10.3 회귀 수정.
18. `tsc --noEmit`, `vite build`, `pytest` 모두 clean.

---

## §12. 커밋 / 푸시 / 배포

### §12.1 단일 커밋

권장:

```
feat(report): v5 phase 2 — multi-ticker, normalized sectioning, canonical metrics, mobile responsive

- TickerSwitcher above verdict ribbon for multi-ticker decisions.
- normalizeAgentReport: sentence-level classifier replaces single-pass
  regex sectioning.
- CitationInference with high/medium/low confidence; sentence-level
  citation chips with explicit "auto-classified" disclaimer and toast
  feedback when href is missing.
- Extracted markdown rendering helpers into app/frontend/src/lib/
  markdown-blocks.tsx; v5 DetailReportModal now renders rich markdown
  (bottom-sheet on mobile).
- TextWithDataChips component is canonical; helpers.ts no longer
  exports renderTextWithDataChips.
- SensitivityHeatmap goes live: valuation.py emits 5x5 WACC x g matrix;
  v5 renders it in section-02 when activeAgent is valuation persona.
- CanonicalMetrics pool merges valuation/fundamentals fallbacks; target
  tiles show source-agent chip when not from the active agent.
- Mobile layout: stacked sections, horizontal TOC pills, responsive
  ribbon, 44px touch targets.

Co-Authored-By: Codex Pro 5.5 <noreply@openai.com>
```

### §12.2 stage 대상

```
app/frontend/src/components/reports/analyst-report-v5/*.ts
app/frontend/src/components/reports/analyst-report-v5/*.tsx
app/frontend/src/components/tabs/stock-search-tab.tsx
app/frontend/src/lib/language-preferences.ts
app/frontend/src/lib/markdown-blocks.tsx
src/agents/valuation.py
tests/test_analyst_report_v5_phase2_static.py
tests/test_valuation_sensitivity_matrix.py
tests/test_analyst_report_v5_static.py
tests/test_stock_search_final_decision_ui_static.py
```

`docs/ui/analyst_report_v5/*.md`, `tmp/`, `claude.md`, `agents.md` 는 stage
하지 마라.

### §12.3 푸시

```bash
git push origin main
git fetch origin
git rev-list --left-right --count origin/main...HEAD   # → 0  0
```

### §12.4 배포

```bash
./deploy_aws.sh
```

배포 후:

```bash
curl -I --max-time 10 http://54.116.99.19/hedge/
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
```

---

## §13. 수용 기준 (Phase 2 종료 시)

- [ ] `decisions` 가 N 개 ticker 를 포함하면 v5 가 TickerSwitcher 를 표시하고,
      pill 클릭 시 본문/사이드바가 그 ticker 의 결과로 재렌더된다.
- [ ] reasoning 안에 `### 결론` / `### 밸류에이션` 등 명시 heading 이 있으면
      그 heading 으로 섹션이 정확히 분리된다.
- [ ] 명시 heading 이 없어도 문장 단위 분류로 reasoning 이 6 섹션에 적절히
      분배된다.
- [ ] citation chip 이 confidence 별 (filled / outline / dashed) 로 다르게
      렌더된다.
- [ ] 출처 패널 footer 에 "자동 분류" 안내 문구가 있다.
- [ ] 출처 항목 클릭 시 href 가 없으면 toast 가 뜬다 (silent 가 아님).
- [ ] 본문의 인용 chip 이 sentence 끝마다 정확히 삽입된다 (item 끝에 한꺼번에가
      아님).
- [ ] `app/frontend/src/lib/markdown-blocks.tsx` 가 존재하고 stock-search-tab,
      v5 modal 양쪽에서 import 된다.
- [ ] v5 DetailReportModal 이 markdown 을 풍부하게 렌더한다 (heading, list,
      bold 모두 보임).
- [ ] mobile 에서 modal 이 bottom sheet 로 올라온다.
- [ ] valuation_analyst 활성 시 section-02 에 5×5 SensitivityHeatmap 이
      표시된다.
- [ ] 다른 agent 활성 시 SensitivityHeatmap 은 표시되지 않는다.
- [ ] active agent 가 intrinsic_value 가 없는 페르소나여도 target tile
      "1주당 내재가치" 가 valuation_analyst 의 값으로 채워지고 우상단에 "V"
      칩이 보인다.
- [ ] `< lg` 에서 사이드바가 본문 아래에 stack 되고, TOC 가 horizontal pill
      scroll 로 본문 위에 보인다.
- [ ] 모든 touch target 이 mobile 에서 ≥ 44×44 px.
- [ ] `pytest tests/ --ignore=tests/backtesting -q` 통과.
- [ ] `tsc --noEmit` 0 errors.
- [ ] `vite build` 성공.
- [ ] `git rev-list --left-right --count origin/main...HEAD` → `0  0`.
- [ ] `curl -I http://54.116.99.19/hedge/` → 200.

---

## §14. 위험 / 미해결

1. **Sentence splitter 한국어 종결어미 누락 케이스**: `다`, `요`, `음`, `됨`,
   `함` 으로 끝나는 문장만 잡음. 명사형 종결 (`연구.`, `검토.`) 은 `.` 으로
   잡혀서 OK. 인터넷 통신체 (`임 ㅋㅋ`) 같은 변형은 보장 안 됨 — 받아들임.
2. **Canonical metrics 가 inactive agent 의 stale 데이터를 보여줄 가능성**:
   valuation_analyst 가 며칠 전 데이터, active 가 최신 데이터일 때.
   `agentResults.get(key).timestamp` 가 있으므로 후순위 agent 의 timestamp 가
   active 보다 오래되면 skip 하는 옵션은 Phase 3.
3. **SensitivityHeatmap 25 회 DCF 비용**: valuation agent 의 DCF 함수가
   순수하지 않으면 (e.g., 외부 API 호출 포함) 25 회 모두 호출 → 비싸짐. 이번
   PR 에서는 valuation.py 의 DCF 함수가 이미 in-memory data 만 사용하는지
   확인 후 emit 결정. 의심스러우면 grid 를 3×3 으로 축소.
4. **TickerSwitcher 가 5 개 초과 시 UI 답답함**: pill wrap 으로 다중 줄
   허용했으므로 OK 이지만, 10 개 초과면 dropdown 으로 fallback 하는 옵션
   가능 — Phase 3.
5. **markdown-blocks.tsx 이동으로 기존 import 깨질 위험**: stock-search-tab
   외부에서 그 함수들을 import 하는 곳이 없는지 grep 확인 필요.
6. **Backend 변경 영향**: `_build_sensitivity_matrix` 는 valuation agent 의
   기존 흐름 끝부분에 isolate. reasoning_dict 에 key 추가만 하므로 기존 LLM
   payload / 테스트 회귀 없음 (LLM payload 빌더에서 명시적으로 제외 — §6.2.2).
