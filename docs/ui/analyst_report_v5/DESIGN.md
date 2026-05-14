# Analyst Report v5 — 단계별 흐름 리뷰 레이아웃 (상세 설계안)

> Base commit: `e1ad050` (v4 6-panel grid 완료 시점)
> Reference: MU · 애스워스 다모다란 분석 화면 스크린샷
> 작성 목적: 소넷이 이 파일만 보고 코드를 구현할 수 있을 만큼 상세한 사양.

---

## §0. 한 줄 요약

기존 `analyst-report-dashboard.tsx` 의 **6-panel grid** 를 **document-style 3-컬럼
레포트 레이아웃** 으로 교체한다. 좌측 TOC + 본문 (번호별 섹션 + evidence item +
인라인 데이터 칩 + 인용 칩) + 우측 핵심 타겟 데이터 사이드바. 백엔드 무수정,
1 커밋, frontend 전용.

---

## §1. 목표 / 비목표

### 목표 (반드시 충족)

1. **Stepped review**: 좌측 TOC 6 개 항목이 본문 섹션과 1:1 매핑되고, 스크롤
   위치에 따라 active TOC 항목이 하이라이트된다.
2. **숫자 가독성**: 본문 안의 `$240`, `-90.16%`, `10.82배` 같은 토큰을 자동
   탐지해서 색조 칩으로 감싼다.
3. **출처 추적**: evidence item 마다 `[a]` `[c]` 같은 인용 글자가 보이고,
   좌측 출처 패널에서 풀이된다.
4. **사이드 컨텍스트**: 우측 사이드바가 active agent 의 핵심 숫자 7 개와
   다른 agent 4–5 명의 신호를 보여준다.
5. **active agent 전환**: 우측 사이드바의 다른 agent row 클릭 시 본문/사이드바
   가 그 agent 의 보고서로 재렌더된다.

### 비목표 (이번 라운드에서 안 함)

- Backend (src/, app/backend/) 수정 0 줄.
- valuation agent 의 WACC×g sensitivity matrix 계산 추가 → Phase 2.
- PDF export 실제 구현 → Phase 3. 버튼은 두고 `disabled`.
- 합의 매트릭스 모달 → Phase 3. 버튼만 두고 `disabled`.
- URL query (`?agent=xxx`) 동기화 → Phase 2. state-only.
- 모바일 반응형 → 데스크탑 우선. `lg` (1024px) 미만에서는 좌/우 사이드바 숨김.

---

## §2. 정보 구조 (IA) 와 폭

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Stock Analysis tab header (existing)                                   │
├──────┬────────────────────────────────────────────────┬─────────────────┤
│ TOC  │  Header verdict ribbon                         │ Target data     │
│      ├────────────────────────────────────────────────┤                 │
│ 200  │  Section 01 결론 요약                          │  280px          │
│ px   │  Section 02 밸류에이션 — DCF                   │                 │
│      │  Section 03 멀티플                              │                 │
│      │  Section 04 리스크와 반대 근거                  │  Other agents   │
│ ─    │  Section 05 크로스체크 가이드                   │                 │
│      │  Section 06 원문 추적 · 출처                    │  Consensus      │
│ 출처 │                                                │  matrix btn     │
│      │  (1fr, min-w 0)                                │                 │
└──────┴────────────────────────────────────────────────┴─────────────────┘
```

### 폭 / 간격 (Tailwind)

| 영역 | width | 비고 |
|---|---|---|
| 좌측 TOC | `w-[200px]` flex-shrink-0 | sticky top |
| 본문 | `flex-1 min-w-0` | 가운데 정렬 max-w 없음 |
| 우측 사이드바 | `w-[280px]` flex-shrink-0 | sticky top |
| 컬럼 사이 gap | `gap-6` (24px) | |
| `lg` 미만 | TOC + 사이드바 hidden, 본문만 | |

전체 컨테이너: `flex gap-6 w-full`. 본문은 `space-y-6` 으로 섹션 사이 24px.

---

## §3. 헤더 verdict ribbon

### §3.1 와이어프레임

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [가치투자·다모다란]  [3개월·2026.01.18→04.18·GPT-5.4 Nano]  [PDF] [원문대조]│
│                                                                          │
│  MU — 이익 급증 착시 위에 선 가격                                         │
│                                                                          │
│  FCFF DCF 기반 안전마진 -0.90, 포워드 P/E [10.82] ↔ 트레일링 [61.10]의    │
│  극단적 디스카운트. "이익 정상화/확장"이 가격에 선반영된 상태이며, ...     │
│  [매도(약세)] 로 평가합니다.                                              │
│                                                                          │
│  ┌────┐  판정      현재/모델           안전마진     모델: FCFF DCF        │
│  │ 74 │  ↓매도·약세 $455.07 ↔ $240.00 -90.16%   기간: 10년·WACC 13.6%   │
│  └────┘                                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### §3.2 데이터 매핑

| 필드 | 데이터 소스 | fallback |
|---|---|---|
| 카테고리 칩 | active agent 의 `category_ko` (`getAgentDisplayName` 동일 로직) | "분석 에이전트" |
| agent 이름 | active agent 의 `display_name_ko` | active agent key |
| 기간 칩 | `startDate → endDate` (workspace 에서 받음) | "기간 미지정" |
| 모델 칩 | `selectedModel.model_name` | "모델 자동" |
| 타이틀 oneliner | reasoning 첫 문장 (50자) | `{ticker} — {signal label}` |
| 서브타이틀 | reasoning 첫 문단 (300자 자르기) | "분석 결과를 불러오는 중입니다." |
| 스코어 (게이지) | 부모에서 `compositeScore` prop 으로 전달 | 50 |
| 판정 라벨 | `signal` → "↓매도·약세" / "↑매수·강세" / "→보유·중립" | "→보유·중립" |
| 현재가 | active agent report 의 `current_price` 또는 `price` | null → 표시 안 함 |
| 내재가치 | active agent report 의 `intrinsic_value` 또는 `fair_value` | null → 표시 안 함 |
| 안전마진 % | report 의 `margin_of_safety` 또는 계산 `(intrinsic-current)/current` | null → 표시 안 함 |
| 모델 라벨 | report 의 `model_name` (e.g., "FCFF DCF") | "모델 미지정" |
| 기간·WACC·g 메타 | report 의 `period_years`, `wacc`, `terminal_growth_rate` | 빈 칸 |

### §3.3 색상 / 톤

- 카드 배경: `bg-gradient-to-br from-emerald-500/5 via-background to-background`
  (signal=bullish), `from-red-500/5...` (bearish), `from-yellow-500/5...` (neutral)
- 게이지 색: `#059669` (≥60) / `#ca8a04` (40-59) / `#dc2626` (<40)
- 판정 칩 클래스 (signal 기반):
  - bullish: `border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300`
  - bearish: `border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300`
  - neutral: `border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-300`

### §3.4 컴포넌트 시그니처

```tsx
interface ReportHeaderRibbonProps {
  ticker: string;
  activeAgent: { key: string; categoryKo?: string; displayNameKo: string };
  startDate: string;
  endDate: string;
  modelName?: string;
  agentReport: AgentReport | null;
  compositeScore: number;
  language: 'ko' | 'en';
  onPdfClick?: () => void;            // null → disabled
  onCompareSourceClick: () => void;
}
```

---

## §4. 본문 (섹션 + evidence item + 인라인 칩 + 핵심 숫자)

### §4.1 섹션 6 개 — 콘텐츠 추출 규칙

| # | id | ko title | en title | 콘텐츠 추출 |
|---|---|---|---|---|
| 01 | section-01 | 결론 요약 | Conclusion | `agentReport.reasoning` 첫 200자 + signal + confidence. 또는 별도 `summary` 필드 있으면 그것을 사용. |
| 02 | section-02 | 밸류에이션 — DCF | Valuation — DCF | reasoning 안에서 키워드 `DCF`, `내재가치`, `intrinsic`, `discounted`, `WACC` 가 들어 있는 문단들 |
| 03 | section-03 | 멀티플 — 이익 정상화 가설 | Multiples — Earnings Normalisation | reasoning 안에서 `P/E`, `포워드`, `forward`, `multiple`, `배수`, `EPS` 키워드 문단 |
| 04 | section-04 | 리스크와 반대 근거 | Risks & Counterthesis | bearish 시그널 에이전트들의 reasoning + risk_management_agent 의 reasoning |
| 05 | section-05 | 크로스체크 가이드 | Cross-check Guide | 기존 `extractCrossCheckGuide(report)` 또는 `buildFallbackCrossCheckGuide` 출력 (기존 함수 재사용) |
| 06 | section-06 | 원문 추적 · 출처 | Source Tracking · Citations | `getResearchLinks(ticker)` 결과 + 인용 5 개 리스트 |

### §4.2 evidence item 구조

각 섹션 본문은 1 개 이상의 numbered evidence item 으로 분해된다.

```
1  [BEAR]  DCF 내재가치와 가격 사이의 괴리가 매우 큼
         <본문 텍스트 with inline data chips and citation chips>
         핵심 숫자: 1주당 내재가치 $240.00  현재가 $455.07  안전마진 -90.16%
         출처:      [a 10-K · 운전자본]  [d WACC 추정]
```

### §4.3 evidence item 분해 로직

```ts
parseEvidenceItems(sectionText: string): EvidenceItem[]
```

분해 기준 (우선순위):

1. **Numbered**: 줄이 `^\d+[.)]\s+` 로 시작 → 새 item
2. **Bold heading**: 줄이 `^\*\*[^*]+\*\*` → 새 item, heading 은 ** 사이 텍스트
3. **Sentiment marker**: 줄이 `^\[[+\-~?]\]` 로 시작 → 새 item (tone 자동 결정)
4. **Heading (`### `)**: 줄이 `^###\s` → 새 item
5. **Single paragraph**: 위 어느 것도 아니면 단일 item

빈 줄을 만나면 현재 item 종료. 최대 item 개수: 섹션당 5 개 (그 이상은 자르고 "더
보기" 없음 — Phase 2).

### §4.4 evidence item tone 결정

1. 첫 줄에 `[-]` 또는 `[~]` 또는 한국어 negative keyword (`약세`, `리스크`,
   `하락`, `손실`, `우려`, `의문`) 있음 → `BEAR`
2. 첫 줄에 `[+]` 또는 positive keyword (`강세`, `상승`, `성장`, `기회`, `우위`)
   있음 → `BULL`
3. 그 외 → `NEUTRAL`

tone 칩 클래스:
- BEAR: `border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400`
- BULL: `border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400`
- NEUTRAL: `border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400`

### §4.5 evidence item heading 추출

1. Bold heading (`**...**`) 이 첫 줄에 있으면 그것을 heading.
2. 없으면 첫 문장 (`/^[^.다]+[.다]/` 매치) 의 처음 50자.
3. 둘 다 없으면 heading 생략, 본문만 표시.

본문은 heading 추출 후 남은 텍스트.

### §4.6 InlineDataChip 자동 추출

`renderWithDataChips(text: string, itemTone: 'BEAR'|'BULL'|'NEUTRAL'): ReactNode`

#### 정규식 패턴 (우선순위 순, 가장 긴 매치)

| # | 패턴 | 예시 | 설명 |
|---|---|---|---|
| 1 | `/\$\d{1,3}(?:,\d{3})*(?:\.\d+)?[BMK]?/g` | `$240`, `$1,234.56`, `$10.28B` | 화폐 |
| 2 | `/-?\d+(?:\.\d+)?%/g` | `-90.16%`, `13.6%` | 퍼센트 |
| 3 | `/\d+(?:\.\d+)?\s*[배×x]/g` | `10.82배`, `61.10x` | 배수 |
| 4 | `/\d+(?:\.\d+)?[BMK]\b/g` | `10.28B`, `500M` | 큰 숫자 |

매치된 토큰은 `<InlineDataChip tone={...}>` 으로 감싼다. 매치 위치를 알기 위해
`text.split` 대신 indexes 추적 방식으로 구현 (HTML escape 안 깨지게).

#### 칩 tone 결정 (개별 토큰별)

1. 토큰 직전 5 단어에 negative keyword (`-`, `손실`, `하락`, `위험`, `약세`, `악화`,
   negative)) → `bearish`
2. positive keyword (`상승`, `성장`, `강세`, `개선`, `기회`) → `bullish`
3. 토큰 자체가 음수 (`-` 시작) → `bearish`
4. 그 외 → `neutral`

특수 규칙:
- **"안전마진" + `-X%`** → bearish (음수일 때) / bullish (양수일 때)
- **"성장률" / "growth"** + 숫자 → bullish
- **"리스크" / "risk"** + 숫자 → bearish
- **"WACC" / "discount"** + 숫자 → neutral

#### 한 줄 최대 칩 개수

한 줄 (period 또는 newline 기준) 에 칩이 **4 개 이상**이면 5 번째부터는 칩 처리
하지 않고 일반 텍스트로 출력. (가독성 보호)

#### 칩 클래스 (tone 별)

- `neutral`: `inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] border border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300`
- `bullish`: 같은 베이스에 `border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`
- `bearish`: 같은 베이스에 `border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400`

### §4.7 citation chip (인용 칩)

`inferCitationLetters(itemText: string, sectionId: SectionId): string[]`

#### 휴리스틱 룰 테이블

| Keywords in itemText | 추가 letter | 출처 라벨 |
|---|---|---|
| `DCF`, `내재가치`, `intrinsic`, `discounted` | `a` | 10-K MD&A |
| `WACC`, `discount rate`, `beta`, `β`, `자본비용` | `d` | WACC 추정 · Damodaran |
| `EPS`, `컨센`, `consensus`, `예측`, `analyst estimate` | `c` | 컨센서스 EPS |
| `어닝콜`, `transcript`, `경영진`, `guidance`, `가이던스` | `b` | 어닝콜 트랜스크립트 |
| `시장 규모`, `TAM`, `섹터`, `점유율`, `share` | `e` | 섹터 리포트 |

여러 키워드가 매치되면 모두 추가, 중복 제거, 알파벳 순 정렬.

#### 본문 안 [a] 칩 삽입 위치

evidence item 본문 텍스트의 **각 문장 끝** 에 그 문장에 매치되는 letter 를 삽입.
문장 분리: `/[.!?다]\s+/` 기준. 매치되는 letter 가 없는 문장은 미삽입.

칩 클래스: `inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-500/15 text-[9px] font-bold text-zinc-700 dark:text-zinc-300 ml-1 align-baseline cursor-pointer hover:bg-zinc-500/30`

hover 시 좌측 출처 패널의 해당 letter 항목에 `data-citation-active` attribute 가
붙어 강조 (CSS 로 처리).

### §4.8 핵심 숫자 strip (KeyNumbersStrip)

`extractKeyNumbers(itemText: string): Array<{ label: string; value: string }>`

#### 추출 알고리즘

1. §4.6 의 정규식으로 모든 숫자 토큰 위치를 찾는다.
2. 각 토큰에 대해 **직전 3 단어** 또는 **직후 3 단어** 안에서 라벨 후보 추출:
   - 한국어: `내재가치`, `현재가`, `안전마진`, `WACC`, `EPS`, `P/E`, `포워드`,
     `트레일링`, `성장률`, `이자보상`, `베타`, `시가총액`, `매출`, `영업이익` 등
   - 영어: `intrinsic`, `current price`, `margin of safety`, `WACC`, `EPS`,
     `P/E`, `forward`, `trailing`, `growth`, `interest coverage`, `beta`,
     `market cap`, `revenue`
3. 가장 가까운 라벨 후보로 매핑. 없으면 generic `값 N` (Korean) / `Value N` (en).
4. 중복 라벨 제거 (같은 라벨로 여러 숫자 매치되면 첫 번째만).
5. 최대 4 개. 4 개 미만이면 그대로, 0 개면 strip 자체 hide.

#### 라벨 매핑 테이블

| 키워드 (ko) | 매핑 라벨 |
|---|---|
| 내재가치, intrinsic value | "1주당 내재가치" |
| 현재가, current price | "현재가" |
| 안전마진, margin of safety | "안전마진" |
| WACC, discount rate | "WACC" |
| EPS (전망/forward) | "다음분기 EPS" / "Forward EPS" |
| EPS (TTM/trailing) | "TTM EPS" |
| P/E (포워드/forward) | "포워드 P/E" |
| P/E (트레일링/trailing) | "트레일링 P/E" |
| 성장률, growth rate | "성장률" |
| 이자보상, interest coverage | "이자보상배율" |
| 베타, beta | "베타" |
| 시가총액, market cap | "시가총액" |
| 매출, revenue | "매출" |
| 영업이익, operating income | "영업이익" |

#### 렌더링

```tsx
<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-xs">
  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('reportKeyNumbers', language)}</span>
  {keyNumbers.map(({label, value}) => (
    <div key={label} className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </div>
  ))}
</div>
```

### §4.9 출처 칩 줄 (item 끝)

evidence item 안에 등장한 인용 letter 들을 모아 한 줄 표시:

```tsx
{citationLetters.length > 0 && (
  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
    <span className="font-semibold uppercase tracking-wide">{t('reportSourcesLabel', language)}</span>
    {citationLetters.map(letter => (
      <CitationChip
        key={letter}
        letter={letter}
        label={citations.find(c => c.letter === letter)?.label}
        type={citations.find(c => c.letter === letter)?.type}
        size="md"
      />
    ))}
  </div>
)}
```

`CitationChip size="md"` 클래스: `inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 hover:bg-muted/50 cursor-pointer`. 좌측에 letter 동그라미 + 우측에 짧은 label + type 태그.

---

## §5. 좌측 TOC + 출처 패널

### §5.1 TOC

```
목차
01  결론 요약
02  밸류에이션 — DCF      ← active (border-l-2 border-primary, bg-muted/30)
03  멀티플 — 이익 정상화 가설
04  리스크와 반대 근거
05  크로스체크 가이드
06  원문 추적 · 출처
```

#### Active 결정 로직

- `IntersectionObserver` 로 각 section element 의 가시성 추적.
- `rootMargin: '-30% 0px -60% 0px'` (뷰포트 상단 30% 지점이 active 기준).
- `threshold: 0` (조금이라도 보이면 됨).
- 여러 섹션이 동시에 보이면 가장 위에 있는 것이 active.

#### 클릭 동작

```ts
const el = document.getElementById(sectionId);
el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
```

URL hash 는 업데이트하지 않는다 (스크롤 점프 방지).

### §5.2 출처 패널 (TOC 아래)

```
출처
[a] 10-K 2025 · MD&A          SEC
[b] 2026 Q1 어닝콜 트랜스크립트   IR
[c] 컨센서스 EPS — Refinitiv     데이터
[d] WACC 추정치 · Damodaran      학술
[e] HBM 시장 규모 — TrendForce    섹터
```

#### 항목별 데이터

`buildCitations(ticker, isKorean): Citation[]` 가 반환하는 5 개:

| letter | label (ko) | label (en) | type | href |
|---|---|---|---|---|
| a | "10-K · MD&A" | "10-K · MD&A" | "SEC" | 한국: `https://dart.fss.or.kr/dsab001/main.do?textCrpNm={code}`, 미국: `https://www.sec.gov/edgar/browse/?CIK={ticker}&owner=exclude` |
| b | "최근 어닝콜" | "Latest earnings call" | "IR" | 한국: `https://finance.naver.com/item/news.naver?code={code}`, 미국: `https://seekingalpha.com/symbol/{ticker}/earnings/transcripts` |
| c | "컨센서스 EPS" | "Consensus EPS" | "데이터" / "Data" | null (Phase 1) |
| d | "WACC 추정 · Damodaran" | "WACC · Damodaran" | "학술" / "Academic" | `https://pages.stern.nyu.edu/~adamodar/` |
| e | "섹터 리포트" | "Sector report" | "섹터" / "Sector" | null (Phase 1) |

#### 동작

- 클릭: `href` 가 있으면 `window.open(href, '_blank')`, 없으면 toast: "출처 링크 미연결".
- `data-citation-letter={letter}` attribute 를 가지고, 본문의 `[a]` 칩을 hover
  하면 이 항목이 `data-citation-active` 가 되어 강조.

### §5.3 컴포넌트 시그니처

```tsx
interface ReportTocSidebarProps {
  sections: Array<{ id: string; number: string; titleKo: string; titleEn: string }>;
  activeSectionId: string;
  citations: Citation[];
  language: 'ko' | 'en';
}

interface Citation {
  letter: string;  // 'a' | 'b' | 'c' | 'd' | 'e'
  label: string;
  type: string;
  href: string | null;
}
```

### §5.4 sticky 동작

```tsx
<aside className="sticky top-4 w-[200px] flex-shrink-0 self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
  ...
</aside>
```

---

## §6. 우측 핵심 타겟 데이터 사이드바

### §6.1 핵심 숫자 타일 (최대 7 개)

`extractTargetTiles(report: AgentReport, current_price: number | null): TargetTile[]`

#### 후보 키 (순서 = 표시 우선순위)

| 순위 | report key (alias 시도) | 라벨 (ko) | 서브 라벨 (ko) | tone 결정 |
|---|---|---|---|---|
| 1 | `forward_eps_fy0` → `forward_eps_ttm` | "다음 분기 컨센 EPS" | "전망이익의 크기" | neutral |
| 2 | `intrinsic_value` → `fair_value` → `dcf_value` | "1주당 내재가치" | "FCFF DCF" | bullish (값이 current_price 보다 크면) / bearish |
| 3 | `margin_of_safety` (없으면 계산) | "안전마진" | "가치평가의 결론" | bullish if >0, bearish if <0 |
| 4 | `interest_coverage` | "이자보상배율" | "단기 안정성" | bullish if >5, bearish if <1.5, neutral else |
| 5 | `beta` | "베타" | "리스크 프레임" | neutral (단순 수치) |
| 6 | `wacc` → `discount_rate` | "WACC" | "할인율" | neutral |
| 7 | `forward_pe_fy0` → `forward_pe` | "Forward P/E (FY0)" | "이익 멀티플" | neutral |

값이 null/undefined 인 키는 skip. 최종 7 개 미만 가능.

#### 값 포맷팅

- 화폐: `$X.XX` (소수점 2 자리), 큰 숫자는 `$X.XXB` (10억 이상)
- 비율: 소수 (e.g., `-0.9016`) **및** 퍼센트 (`-90.16%`) 둘 다 보임 — 스크린샷 형식
- 멀티플: `×80.2` 또는 `10.82x`
- 그 외: 소수 2 자리

#### 타일 클래스 (tone 별)

```
base: rounded-lg border bg-muted/10 p-3
label: text-[10px] font-medium uppercase tracking-wide text-muted-foreground
value: mt-1 font-mono text-lg font-semibold (tone 색)
sublabel: text-[10px] text-muted-foreground

tone=bullish:  value 색 text-emerald-500 dark:text-emerald-400
tone=bearish:  value 색 text-red-500 dark:text-red-400
tone=neutral:  value 색 text-foreground
```

### §6.2 "다른 에이전트는?"

`listOtherAgents(completeResult, activeAgentKey, ticker): OtherAgent[]`

- `completeResult.analyst_signals` 전체에서 active agent 와 risk_management_agent
  를 제외한 모든 agent.
- 각 agent: `{ key, displayNameKo, tone, score, confidence }`.
- `score = scoreSignal(signal, confidence)` (기존 함수 재사용).
- 정렬: confidence 내림차순. 최대 5 명.

#### 렌더링

```tsx
<button
  type="button"
  onClick={() => onSwitchAgent(agent.key)}
  className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-border/60 hover:bg-muted/30"
>
  <span className="flex items-center gap-1.5">
    <span className={`h-1.5 w-1.5 rounded-full ${toneColor(agent.tone)}`} />
    <span className="font-medium">{agent.displayNameKo}</span>
  </span>
  <span className="flex items-center gap-1.5 text-[10px]">
    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${toneBadge(agent.tone)}`}>
      {agent.tone === 'bullish' ? 'BUL' : agent.tone === 'bearish' ? 'BEA' : 'NEU'}
    </span>
    <span className="font-mono text-muted-foreground">{Math.round(agent.score)}</span>
  </span>
</button>
```

### §6.3 "합의 매트릭스 열기" 버튼

```tsx
<Button
  variant="outline"
  size="sm"
  className="mt-3 w-full"
  disabled
  title={t('comingSoonLabel', language)}
>
  {t('openConsensusMatrix', language)}
  <ChevronRight className="ml-auto h-3.5 w-3.5" />
</Button>
```

### §6.4 컴포넌트 시그니처

```tsx
interface TargetDataSidebarProps {
  tiles: TargetTile[];
  otherAgents: OtherAgent[];
  language: 'ko' | 'en';
  onSwitchAgent: (agentKey: string) => void;
}

interface TargetTile {
  labelKey: string;       // i18n key
  sublabelKey: string;    // i18n key
  value: string;          // formatted
  tone: 'bullish' | 'bearish' | 'neutral';
}

interface OtherAgent {
  key: string;
  displayNameKo: string;
  displayNameEn: string;
  tone: 'bullish' | 'bearish' | 'neutral';
  score: number;          // 0-100
  confidence: number | null;
}
```

---

## §7. WACC × g 민감도 매트릭스 (Phase 2 — placeholder)

### §7.1 컴포넌트

`sensitivity-heatmap.tsx` 를 만든다. props:

```tsx
interface SensitivityHeatmapProps {
  matrix: Array<Array<{ wacc: number; g: number; safetyMargin: number }>>;
  currentWacc: number;
  currentG: number;
}
```

- `matrix` 가 비어 있거나 null 이면 **`null` 반환** (DOM 에 안 나타남).
- Phase 1 에서는 `agentReport.sensitivity_matrix` 가 없으므로 항상 null.
- Phase 2 에서 valuation agent 가 emit 하면 자동 활성화.

### §7.2 렌더링 (Phase 2 활성 시)

5×5 그리드 (WACC 11%/12%/13.6%/14.5%/15.5% × g 1.5%/2.0%/2.5%/3.0%/3.5%). 각 셀:
- 배경: safetyMargin 에 따라 빨강 그라데이션 (`-70%` → `#7f1d1d`, `-40%` → `#dc2626`, `-20%` → `#f59e0b`, `+10%` → `#10b981`)
- 텍스트: safetyMargin %
- 현재 가정 셀: `border-2 border-yellow-400`

이번 라운드에서는 **컴포넌트만 만들고 렌더 호출 안 함**.

---

## §8. PDF / 원문 대조 버튼

### §8.1 PDF (disabled)

```tsx
<Button variant="outline" size="sm" disabled title={t('comingSoonLabel', language)}>
  <FileText className="mr-1.5 h-3.5 w-3.5" />
  {t('pdfExportButton', language)}
</Button>
```

### §8.2 원문 대조 (active)

기존 `selectedDetailReport` state 를 트리거. 클릭 핸들러는 `stock-search-tab.tsx`
에서 prop 으로 내려준다:

```tsx
onCompareSourceClick={() => {
  const activeReport = agentResults.get(activeAgentKey);
  if (activeReport) {
    setSelectedDetailReport({
      agentName: activeReport.agentName,
      markdown: getDetailReportMarkdown(activeReport),
    });
  }
}}
```

기존 `getDetailReportMarkdown` 함수 그대로 재사용.

---

## §9. i18n 키 (ko + en 양쪽)

`app/frontend/src/lib/language-preferences.ts` 에 추가:

```ts
// Report v5 — TOC
reportTocTitle: '목차' / 'Table of Contents',
reportSourcesTitle: '출처' / 'Sources',

// Report v5 — Sections
reportSection01: '결론 요약' / 'Conclusion',
reportSection02: '밸류에이션 — DCF' / 'Valuation — DCF',
reportSection03: '멀티플 — 이익 정상화 가설' / 'Multiples — Earnings Normalisation',
reportSection04: '리스크와 반대 근거' / 'Risks & Counterthesis',
reportSection05: '크로스체크 가이드' / 'Cross-check Guide',
reportSection06: '원문 추적 · 출처' / 'Source Tracking · Citations',

// Report v5 — Evidence item
reportEvidenceBear: '약세' / 'BEAR',
reportEvidenceBull: '강세' / 'BULL',
reportEvidenceNeutral: '중립' / 'NEUTRAL',
reportKeyNumbers: '핵심 숫자' / 'Key Numbers',
reportSourcesLabel: '출처' / 'Sources',
reportEmptySection: '이 섹션에 적용할 데이터가 없습니다.' / 'No data available for this section.',

// Report v5 — Header
reportSubtitleMeta: '{period} · {dateRange} · {model}' / '{period} · {dateRange} · {model}',
pdfExportButton: 'PDF' / 'PDF',
compareSourceButton: '원문 대조' / 'Compare Source',
verdictBuy: '↑매수·강세' / '↑Buy · Bull',
verdictSell: '↓매도·약세' / '↓Sell · Bear',
verdictHold: '→보유·중립' / '→Hold · Neutral',
modelLabel: '모델' / 'Model',
periodLabelHeader: '기간' / 'Period',

// Report v5 — Target data sidebar
targetDataTitle: '핵심 타겟 데이터' / 'Target Data',
targetEpsLabel: '다음 분기 컨센 EPS' / 'Next-Q Consensus EPS',
targetEpsSubtitle: '전망이익의 크기' / 'Forward earnings size',
targetIntrinsicLabel: '1주당 내재가치' / 'Intrinsic Value / Share',
targetIntrinsicSubtitle: 'FCFF DCF' / 'FCFF DCF',
targetMarginLabel: '안전마진' / 'Margin of Safety',
targetMarginSubtitle: '가치평가의 결론' / 'Valuation conclusion',
targetCoverageLabel: '이자보상배율' / 'Interest Coverage',
targetCoverageSubtitle: '단기 안정성' / 'Short-term stability',
targetBetaLabel: '베타' / 'Beta',
targetBetaSubtitle: '리스크 프레임' / 'Risk frame',
targetWaccLabel: 'WACC' / 'WACC',
targetWaccSubtitle: '할인율' / 'Discount rate',
targetForwardPeLabel: 'Forward P/E (FY0)' / 'Forward P/E (FY0)',
targetForwardPeSubtitle: '이익 멀티플' / 'Earnings multiple',
otherAgentsTitle: '다른 에이전트는?' / 'Other Agents',
openConsensusMatrix: '합의 매트릭스 열기' / 'Open Consensus Matrix',
comingSoonLabel: 'Coming soon' / 'Coming soon',
sourceLinkUnavailable: '출처 링크 미연결' / 'Source link unavailable',
```

i18n 키는 alphabetical 로 정렬하지 말고 위 그룹 단위 코멘트로 묶어 추가.

---

## §10. 컴포넌트 트리 & 파일 구조

```
app/frontend/src/components/reports/
├── analyst-report-dashboard.tsx          [기존 — wrapper 로 단순화]
└── analyst-report-v5/                    [신규 폴더]
    ├── types.ts                          [shared TypeScript types]
    ├── helpers.ts                        [순수 함수 헬퍼 모음]
    ├── report-layout.tsx                 [3-col shell + state 관리]
    ├── report-header-ribbon.tsx          [상단 verdict ribbon]
    ├── report-toc-sidebar.tsx            [좌측 TOC + 출처]
    ├── report-body.tsx                   [본문 (섹션들의 컨테이너)]
    ├── report-section.tsx                [단일 섹션]
    ├── evidence-item.tsx                 [번호별 evidence item]
    ├── inline-data-chip.tsx              [숫자 칩 단일]
    ├── citation-chip.tsx                 [인용 letter 칩]
    ├── key-numbers-strip.tsx             [핵심 숫자 strip]
    ├── target-data-sidebar.tsx           [우측 사이드바]
    └── sensitivity-heatmap.tsx           [WACC×g — Phase 2 placeholder]
```

### §10.1 `analyst-report-dashboard.tsx` 변경

기존 파일을 **단순화** (6-panel grid 삭제, v5 컴포넌트 호출만):

```tsx
import { ReportLayout } from './analyst-report-v5/report-layout';

export function AnalystReportDashboard(props: AnalystReportDashboardProps) {
  return <ReportLayout {...props} />;
}
```

기존 props 인터페이스 그대로 유지 → stock-search-tab.tsx 변경 불필요.

### §10.2 `report-layout.tsx` 핵심 구조

```tsx
export function ReportLayout({
  ticker,
  completeResult,
  agentResults,
  language,
  compositeScore,
  onSave,
  isSaving,
}: AnalystReportDashboardProps) {
  const [activeAgentKey, setActiveAgentKey] = useState(() => pickDefaultAgent(agentResults));
  const [activeSectionId, setActiveSectionId] = useState('section-01');
  const [selectedDetailReport, setSelectedDetailReport] = useState(null);

  const activeAgent = useMemo(() => getAgentMeta(activeAgentKey, agentResults), [...]);
  const activeReport = useMemo(() => getAgentReport(completeResult.analyst_signals, activeAgentKey, ticker), [...]);
  const citations = useMemo(() => buildCitations(ticker, isKoreanStock(ticker), language), [...]);
  const tiles = useMemo(() => extractTargetTiles(activeReport, language), [...]);
  const otherAgents = useMemo(() => listOtherAgents(completeResult, activeAgentKey, ticker, language), [...]);
  const sections = useMemo(() => SECTION_DEFS, []);

  // IntersectionObserver
  useEffect(() => { ... }, [sections]);

  return (
    <div className="space-y-4">
      <ReportHeaderRibbon ... />
      <div className="flex gap-6">
        <ReportTocSidebar
          sections={sections}
          activeSectionId={activeSectionId}
          citations={citations}
          language={language}
          className="hidden lg:flex"
        />
        <ReportBody
          sections={sections}
          activeReport={activeReport}
          ticker={ticker}
          citations={citations}
          language={language}
        />
        <TargetDataSidebar
          tiles={tiles}
          otherAgents={otherAgents}
          language={language}
          onSwitchAgent={setActiveAgentKey}
          className="hidden lg:flex"
        />
      </div>
      {selectedDetailReport && <DetailReportModal ... />}
    </div>
  );
}
```

---

## §11. helpers.ts — 모든 순수 함수 시그니처

```ts
// ── Section definitions ─────────────────────────────────────────────────────
export const SECTION_DEFS: SectionDef[] = [
  { id: 'section-01', number: '01', titleKo: '결론 요약', titleEn: 'Conclusion' },
  { id: 'section-02', number: '02', titleKo: '밸류에이션 — DCF', titleEn: 'Valuation — DCF' },
  { id: 'section-03', number: '03', titleKo: '멀티플 — 이익 정상화 가설', titleEn: 'Multiples — Earnings Normalisation' },
  { id: 'section-04', number: '04', titleKo: '리스크와 반대 근거', titleEn: 'Risks & Counterthesis' },
  { id: 'section-05', number: '05', titleKo: '크로스체크 가이드', titleEn: 'Cross-check Guide' },
  { id: 'section-06', number: '06', titleKo: '원문 추적 · 출처', titleEn: 'Source Tracking · Citations' },
];

// ── Reasoning → sections ────────────────────────────────────────────────────
export function splitReasoningIntoSections(
  reasoning: string,
  options: { agentReport?: any; crossCheckGuide?: string | null }
): Record<SectionId, string>;
// 키워드 기반으로 문단을 6 개 섹션에 분배. 자세한 규칙은 §4.1.

// ── Section text → evidence items ───────────────────────────────────────────
export function parseEvidenceItems(sectionText: string): EvidenceItem[];

// ── Item tone 결정 ──────────────────────────────────────────────────────────
export function classifyItemTone(itemText: string): 'BEAR' | 'BULL' | 'NEUTRAL';

// ── Item heading 추출 ──────────────────────────────────────────────────────
export function extractItemHeading(itemText: string): { heading: string | null; body: string };

// ── 본문 텍스트 → ReactNode (with chips) ──────────────────────────────────
export function renderTextWithDataChips(
  text: string,
  itemTone: 'BEAR' | 'BULL' | 'NEUTRAL',
  language: 'ko' | 'en'
): ReactNode;

// ── Citation letter 추론 ────────────────────────────────────────────────────
export function inferCitationLetters(
  itemText: string,
  sectionId: SectionId
): string[];  // sorted unique letters

// ── 본문에 citation 칩 삽입 ─────────────────────────────────────────────────
export function insertCitationChipsIntoText(
  text: string,
  letters: string[]
): string;  // returns text with [a], [c] tokens at sentence ends

// ── Ticker → citation 리스트 ───────────────────────────────────────────────
export function buildCitations(
  ticker: string,
  isKoreanStock: boolean,
  language: 'ko' | 'en'
): Citation[];

// ── Item text → key numbers (최대 4) ──────────────────────────────────────
export function extractKeyNumbers(
  itemText: string,
  language: 'ko' | 'en'
): Array<{ label: string; value: string }>;

// ── Agent report → target tiles (최대 7) ───────────────────────────────────
export function extractTargetTiles(
  report: AgentReport | null,
  currentPrice: number | null,
  language: 'ko' | 'en'
): TargetTile[];

// ── 다른 agent 리스트 ───────────────────────────────────────────────────────
export function listOtherAgents(
  completeResult: CompleteResult,
  activeAgentKey: string,
  ticker: string,
  agentMetaMap: Map<string, AgentMeta>,
  language: 'ko' | 'en'
): OtherAgent[];

// ── Default agent 선택 (valuation_analyst > 첫 번째 complete) ─────────────
export function pickDefaultAgent(agentResults: Map<string, AgentResult>): string;

// ── Tone → Tailwind 클래스 토큰 ─────────────────────────────────────────────
export function toneToClasses(tone: 'bullish' | 'bearish' | 'neutral'): {
  border: string; bg: string; text: string;
};

// ── 안전마진 계산 ──────────────────────────────────────────────────────────
export function calcMarginOfSafety(intrinsic: number | null, current: number | null): number | null;

// ── Signal → verdict label ──────────────────────────────────────────────────
export function signalToVerdict(signal: string, language: 'ko' | 'en'): string;
```

각 함수는 단일 책임, 부수효과 없음. 모두 export 해서 테스트 가능.

---

## §12. 색상 토큰 (디자인 토큰)

| 의미 | tone | border | bg | text |
|---|---|---|---|---|
| Bullish 강조 | bullish | `border-emerald-500/30` | `bg-emerald-500/10` | `text-emerald-600 dark:text-emerald-400` |
| Bearish 강조 | bearish | `border-red-500/30` | `bg-red-500/10` | `text-red-600 dark:text-red-400` |
| Neutral 강조 | neutral | `border-yellow-500/30` | `bg-yellow-500/10` | `text-yellow-600 dark:text-yellow-400` |
| Muted 데이터 칩 | data-neutral | `border-zinc-500/20` | `bg-zinc-500/10` | `text-zinc-700 dark:text-zinc-300` |
| 게이지 ≥60 | bullish | — | — | `#059669` |
| 게이지 40-59 | neutral | — | — | `#ca8a04` |
| 게이지 <40 | bearish | — | — | `#dc2626` |
| 카드 base | — | `border-border/60` | `bg-background` | `text-foreground` |
| 섹션 호버 | — | — | `hover:bg-muted/30` | — |
| Active TOC | — | `border-l-2 border-primary` | `bg-muted/30` | `text-primary font-medium` |

---

## §13. 사이즈 토큰

| 항목 | 클래스 |
|---|---|
| 카드 padding | `p-4` |
| 카드 사이 gap | `gap-4` |
| Section 사이 gap | `space-y-6` |
| Evidence item 사이 gap | `space-y-4` |
| Chip padding | `px-1.5 py-0.5` |
| Chip 글자 | `text-[11px]` |
| Citation 칩 | `h-4 w-4 text-[9px]` |
| TOC 항목 | `py-2 px-3 text-sm` |
| Section heading | `text-lg font-semibold` |
| Section 번호 | `text-2xl font-mono font-bold text-muted-foreground` |
| Item heading | `text-sm font-semibold` |
| Item body | `text-sm leading-relaxed text-foreground/90` |
| Key numbers | `text-xs` |
| Sidebar tile value | `text-lg font-mono font-semibold` |
| Sidebar tile label | `text-[10px] uppercase tracking-wide text-muted-foreground` |

---

## §14. 상태 관리

### §14.1 ReportLayout 내부 상태

- `activeAgentKey: string` — 우측 사이드바 클릭으로 변경
- `activeSectionId: string` — IntersectionObserver 로 자동 갱신
- `selectedDetailReport: DetailReportState | null` — 원문 대조 버튼 클릭 시

### §14.2 활성 agent 기본값

`pickDefaultAgent`:
1. `agentResults` 에 `valuation_analyst` 가 complete 면 그것
2. 아니면 confidence 가장 높은 complete agent
3. 아니면 첫 번째 complete agent
4. 아무도 complete 가 아니면 첫 번째 agent

### §14.3 stock-search-tab.tsx 와의 관계

- `AnalystReportDashboard` 의 기존 prop interface 유지.
- v5 컴포넌트가 내부에서 모든 state 를 관리하므로 stock-search-tab 은 변경 불필요.
- 단, "원문 대조" 버튼이 detail-report-view 를 띄우려면 stock-search-tab 의
  `setSelectedDetailReport` 와 연결되어야 한다. → **v5 자체 modal 로 처리** (기존
  detail-report-view 와 별개, 같은 markdown 을 표시).

```tsx
// v5 자체 모달
{selectedDetailReport && (
  <DetailReportModal
    agentName={selectedDetailReport.agentName}
    markdown={selectedDetailReport.markdown}
    onClose={() => setSelectedDetailReport(null)}
    language={language}
  />
)}
```

`DetailReportModal` 은 `report-layout.tsx` 안에 inline 으로 둔다 (별도 파일 안
만듦). fixed inset-0 overlay + max-w-4xl 컨테이너 + markdown 렌더 (기존
`renderMarkdownBlocks` 같은 헬퍼는 stock-search-tab.tsx 에서 export 받아 재사용
…은 복잡하므로 v5 안에 간단한 markdown 렌더 헬퍼 새로 짜는 것도 가능. 시간
절약 위해 단순한 `<pre className="whitespace-pre-wrap">{markdown}</pre>` 로 OK).

---

## §15. 접근성 (a11y)

| 요소 | 속성 |
|---|---|
| TOC active 항목 | `aria-current="location"` |
| Citation chip | `aria-label="출처 a: 10-K MD&A"` |
| Sidebar agent button | `aria-label="다모다란 분석으로 전환"` |
| PDF disabled button | `aria-disabled="true"`, `title` 로 reason |
| 매트릭스 버튼 disabled | 동일 |
| Section element | `id={sectionId}`, `aria-labelledby={headingId}` |
| Section heading | `id={headingId}` |
| Item tone tag | `aria-label="약세 근거"` 등 |

---

## §16. 빈 데이터 / fallback

| 시나리오 | 동작 |
|---|---|
| `agentReport === null` | 본문 6 섹션 모두 placeholder ("이 에이전트가 실행되지 않았습니다") |
| Section 텍스트 비어 있음 | 섹션 element 는 렌더 (TOC 와 매핑 유지) + placeholder |
| Evidence item 0 개 | 섹션 placeholder |
| Inline chip 4 개 초과 | 5 번째부터 일반 텍스트 |
| Key numbers 0 개 | strip 자체 숨김 |
| Citation letter 0 개 | "출처" 줄 자체 숨김 |
| Target tile 0 개 | 사이드바 헤더 + "데이터 없음" 메시지 |
| Other agent 0 명 | 사이드바 섹션 자체 숨김 |
| Cross-check guide 없음 | `buildFallbackCrossCheckGuide` 호출 (기존 함수 재사용 — stock-search-tab 에서 export 필요) |

→ stock-search-tab.tsx 의 `buildFallbackCrossCheckGuide`, `extractCrossCheckGuide`,
`isKoreanStock`, `getKoreanStockCode`, `getResearchLinks` 를 **export** 해서
v5 에서 import. (기존 함수들은 내부 함수이므로 `export` 키워드 추가만 필요.)

---

## §17. 테스트 계획

### §17.1 신규 테스트

`tests/test_analyst_report_v5_static.py`:

```py
def test_v5_folder_has_all_components(self):
    # 13 개 파일 존재 확인
    for fname in ['types.ts', 'helpers.ts', 'report-layout.tsx', ...]:
        assert (V5_DIR / fname).exists()

def test_v5_helpers_exports_required_functions(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    for fn in ['splitReasoningIntoSections', 'parseEvidenceItems',
               'classifyItemTone', 'renderTextWithDataChips',
               'inferCitationLetters', 'buildCitations',
               'extractKeyNumbers', 'extractTargetTiles',
               'listOtherAgents', 'pickDefaultAgent']:
        assert f'export function {fn}' in src or f'export const {fn}' in src

def test_v5_layout_renders_3_columns(self):
    src = (V5_DIR / 'report-layout.tsx').read_text()
    assert 'ReportHeaderRibbon' in src
    assert 'ReportTocSidebar' in src
    assert 'ReportBody' in src
    assert 'TargetDataSidebar' in src

def test_dashboard_delegates_to_v5(self):
    src = DASHBOARD.read_text()
    assert "from './analyst-report-v5/report-layout'" in src
    assert "ReportLayout" in src

def test_i18n_keys_added(self):
    src = LANG_PREFS.read_text()
    # ko + en 양쪽
    for key in ['reportTocTitle', 'reportSection01', 'reportSection06',
                'targetDataTitle', 'otherAgentsTitle', 'openConsensusMatrix']:
        assert f'{key}:' in src, f'{key} not found in language-preferences.ts'

def test_data_chip_regex_patterns_present(self):
    src = (V5_DIR / 'helpers.ts').read_text()
    # 정규식 sanity check
    assert r'\\$\\d' in src or r'\\$\\d' in src  # currency pattern
    assert r'%/g' in src or r'%' in src
```

### §17.2 기존 테스트 회귀

`tests/test_stock_search_final_decision_ui_static.py`:

기존 6-panel 검사를 **삭제** 하고 v5 검사로 교체:

```py
def test_final_decision_adds_v5_layout_to_dashboard(self):
    dashboard_source = DASHBOARD.read_text(encoding="utf-8")
    self.assertIn("ReportLayout", dashboard_source)
    self.assertIn("./analyst-report-v5/", dashboard_source)
```

`test_final_decision_has_score_display_in_dashboard` 와
`test_final_decision_adds_6_panel_grid_to_dashboard` 는 **삭제**.
`test_final_decision_uses_composite_score_and_status_label` 은 dashboard 가 아니라
v5 의 `report-header-ribbon.tsx` 에서 score 표시되는지 확인하게 수정.

### §17.3 빌드 / 타입 체크

- `pytest tests/ --ignore=tests/backtesting -q` → all green (기존 topbar 2 개
  무시).
- `tsc --noEmit` → 0 errors.
- `vite build` → succeeds.

---

## §18. 구현 순서 (Phase 1)

1. **types.ts** — 모든 공유 타입 정의
2. **helpers.ts** — 추출 / 분류 / 매핑 함수 전부 (의존성 없음)
3. **inline-data-chip.tsx** — props: text, tone. text 안의 숫자만 칩으로.
4. **citation-chip.tsx** — props: letter, label, type, size. 작은 칩.
5. **key-numbers-strip.tsx** — props: keyNumbers, language.
6. **evidence-item.tsx** — 위 3 개를 조합. props: text, tone, citationLetters,
   citations, language.
7. **report-section.tsx** — evidence-item 들의 컨테이너. props: sectionDef,
   sectionText, citations, language.
8. **report-body.tsx** — section 들의 list. props: sections, activeReport,
   ticker, citations, language. IntersectionObserver 는 layout 에서 처리하므로
   여기는 단순 렌더.
9. **report-toc-sidebar.tsx** — TOC + 출처 패널. props per §5.3.
10. **target-data-sidebar.tsx** — props per §6.4.
11. **sensitivity-heatmap.tsx** — props per §7.1. (Phase 1 에서는 렌더 안 됨)
12. **report-header-ribbon.tsx** — props per §3.4.
13. **report-layout.tsx** — 3-col shell + state + IntersectionObserver +
    DetailReportModal inline.
14. **analyst-report-dashboard.tsx** 단순화 → `ReportLayout` 호출.
15. **stock-search-tab.tsx** — `buildFallbackCrossCheckGuide`,
    `extractCrossCheckGuide`, `isKoreanStock`, `getKoreanStockCode`,
    `getResearchLinks` 에 `export` 추가.
16. **language-preferences.ts** — i18n 키 추가 (ko + en 양쪽).
17. 기존 static 테스트 회귀 수정 + v5 신규 static 테스트 추가.
18. `tsc --noEmit` 실행, 에러 0 까지 수정.
19. `vite build` 실행, 성공 확인.
20. `pytest tests/ --ignore=tests/backtesting -q` 실행, 기존 topbar 2 개 외에
    모두 통과 확인.

---

## §19. 커밋 / 푸시 / 배포

### §19.1 단일 커밋

```
feat(report): document-style v5 report layout (TOC + inline citations + target sidebar)

Replace the v4 6-panel grid in AnalystReportDashboard with a 3-column
document-style layout: left TOC + body (numbered sections with auto data
chips and inferred citation chips) + right target-data sidebar. All v5
components live under app/frontend/src/components/reports/analyst-report-v5/.
Frontend-only; backend untouched. Phase 1 leaves PDF export, consensus
matrix, and WACC×g sensitivity heatmap as disabled placeholders.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

### §19.2 stage 할 파일

```
app/frontend/src/components/reports/analyst-report-dashboard.tsx
app/frontend/src/components/reports/analyst-report-v5/*.ts
app/frontend/src/components/reports/analyst-report-v5/*.tsx
app/frontend/src/components/tabs/stock-search-tab.tsx
app/frontend/src/lib/language-preferences.ts
tests/test_analyst_report_v5_static.py
tests/test_stock_search_final_decision_ui_static.py
```

`docs/`, `tmp/`, `agents.md`, `claude.md` 등 다른 dirty 파일은 **stage 하지 마라**.

### §19.3 푸시

```bash
git push origin main
git fetch origin
git rev-list --left-right --count origin/main...HEAD  # → 0  0
```

### §19.4 배포

```bash
./deploy_aws.sh
```

배포 후 smoke check:

```bash
curl -I --max-time 10 http://54.116.99.19/hedge/   # → 200 OK
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
```

---

## §20. 수용 기준 (Phase 1 종료 시 체크리스트)

- [ ] Stock Analysis 탭에서 분석 완료 후 결과 화면이 **3-컬럼 문서 레이아웃** 으로
      표시된다.
- [ ] 좌측 TOC 6 개 항목 클릭 시 본문이 해당 섹션으로 부드럽게 스크롤된다.
- [ ] 스크롤하면 좌측 TOC 의 active 항목이 자동으로 갱신된다.
- [ ] 본문에 `$240`, `-90.16%`, `10.82배` 같은 숫자가 자동으로 색조 칩으로
      감싸진다. 한 줄에 4 개를 초과하면 5 번째부터는 일반 텍스트.
- [ ] evidence item 마다 `[a]` / `[c]` / `[d]` 같은 인용 칩이 적절히 등장한다.
- [ ] 좌측 출처 패널의 5 개 항목이 본문 인용 칩과 매핑되고, 호버 시 강조된다.
- [ ] 우측 사이드바에 핵심 숫자 타일 (최대 7 개) + 다른 에이전트 (최대 5 개) 가
      표시된다.
- [ ] 다른 agent row 클릭 시 본문/사이드바가 그 agent 의 보고서로 재렌더된다.
- [ ] 헤더에 verdict ribbon (score 게이지 + 판정 칩 + 가격 + 안전마진 + 모델
      메타) 이 있다.
- [ ] PDF 버튼은 disabled, "원문 대조" 버튼은 클릭 시 detail modal 이 뜬다.
- [ ] 합의 매트릭스 버튼은 disabled, tooltip "Coming soon".
- [ ] WACC × g 매트릭스는 데이터 없으므로 화면에 안 보임 (정상 동작).
- [ ] `pytest tests/ --ignore=tests/backtesting -q` → 기존 topbar 2 개 외에 모두
      pass.
- [ ] `tsc --noEmit` → 0 errors.
- [ ] `vite build` → succeeds.
- [ ] `git rev-list --left-right --count origin/main...HEAD` → `0  0`.
- [ ] `curl -I http://54.116.99.19/hedge/` → `HTTP/1.1 200 OK`.
- [ ] 서버 git HEAD 가 새 커밋 sha 와 일치.

---

## §21. 위험 / 미해결 이슈

1. **콘텐츠 매핑 정확도**: reasoning 이 항상 6 섹션에 깔끔히 떨어지지 않음.
   keyword 휴리스틱 한계. → 일부 섹션이 비더라도 자리는 유지 (TOC 일관성).
2. **숫자 칩 오탐**: 정규식이 너무 공격적이면 모든 숫자가 칩으로 변함. 한 줄 4 개
   제한으로 완화. 추가로 1 자리 정수 (`1`, `2`, `5`) 는 칩화 안 함.
3. **인용 매핑 부정확**: 휴리스틱이므로 실제 출처와 다를 수 있음. 좌측 출처 패널
   하단에 small print "자동 추정 분류" 명시 (i18n 키 `citationAutoNote`: ko
   "자동 추정 분류 — 정확성은 원문 대조로 확인" / en "Auto-classified — verify
   with source").
4. **active agent 새로고침 시 reset**: state-only 라서 새로고침 시 default 로
   돌아감. Phase 2 에서 URL query 동기화.
5. **detail modal 의 markdown 렌더**: stock-search-tab.tsx 의
   `renderMarkdownBlocks` 가 export 안 되어 있음. v5 modal 은 간단히
   `whitespace-pre-wrap` 으로 처리 (Phase 1) 또는 그 함수를 export 후 import.
   추천: export 후 재사용 (renderMarkdownBlocks, ensureParagraphBreaks).
6. **stock-search-tab 의 기존 detail-report-view (별도 div)**: v5 자체 modal 과
   중복. 기존 div 는 그대로 두되 v5 가 트리거하지 않음. v5 modal 만 사용.
7. **6-panel 검사 테스트 삭제 영향**: 5 개 assertion 삭제. PR diff 가 크지만
   v4 → v5 본질적 교체이므로 정당.
