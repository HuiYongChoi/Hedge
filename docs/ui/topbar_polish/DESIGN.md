# Top Bar 폴리시 — Flow 네비 아이콘 + WorkspacePill 텍스트 정리

이전 [`topbar_cleanup`](../topbar_cleanup/DESIGN.md) 작업으로 패널 토글 스코핑과 WorkspacePill 칩 정리를 마쳤다. 그 직후 사용자 피드백에서 두 가지 후속 정리 항목이 추가되었다.

---

## A. Flow 탭으로 돌아가는 아이콘 추가

### A.1 문제

현재 우측 상단 액션 영역에는 3개 아이콘만 노출된다:

| 위치 | 아이콘 | 동작 |
|---|---|---|
| 1 | `Database` | Data Sandbox 탭 열기 |
| 2 | `Search` | Stock Analysis 탭 열기 |
| 3 | `Settings` | Settings 탭 열기 |

비-flow 탭(Settings/Stock Search/Data Sandbox)에 있을 때 **Flow 탭으로 빠르게 돌아갈 방법이 탑바에 없다**. 사용자는 좌측 탭 바에서 Flow 탭을 찾아 클릭해야 한다 — 자주 발생하는 동선인데 마찰이 크다.

### A.2 목표

- 우측 액션 영역에 `Workflow`(또는 `GitBranch`) 아이콘 1개 추가.
- 클릭 시 가장 최근에 활성이었던 flow 탭을 focus. 없으면 첫 번째 flow 탭. 그것도 없으면 disabled 상태.
- 현재 활성 탭이 이미 flow면 disabled (선택 변화 없음 표시).
- 키보드 단축키 추가는 이번 스코프에서 제외 (요구되지 않음).

### A.3 설계

**탭 컨텍스트에 헬퍼 추가** ([tabs-context.tsx](app/frontend/src/contexts/tabs-context.tsx))

```tsx
// 기존 activeTab/activeTabType derived 옆에 추가
const flowTabs = tabs.filter(t => t.type === 'flow');

// 컨텍스트 value에 노출
flowTabs,
focusFirstFlowTab: () => {
  if (flowTabs.length === 0) return;
  // 활성 flow 탭이 있으면 그대로 두고, 없으면 첫 번째 flow 탭으로
  const target = flowTabs.find(t => t.id === activeTabId) ?? flowTabs[0];
  setActiveTab(target.id);
},
```

`TabsContextType`에 두 개 키 추가:
- `flowTabs: Tab[]`
- `focusFirstFlowTab: () => void`

**TopBar에 prop 추가** ([top-bar.tsx](app/frontend/src/components/layout/top-bar.tsx))

```tsx
interface TopBarProps {
  // ...
  hasFlowTab: boolean;
  isFlowTabActive: boolean;  // = isFlowTab — but 가독성 위해 alias
  onFlowClick: () => void;
}

// 우측 액션 영역, Database 버튼 앞에 추가:
<Button
  variant="ghost"
  size="sm"
  onClick={onFlowClick}
  disabled={!hasFlowTab || isFlowTabActive}
  className={cn(
    "h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-700 transition-colors",
    isFlowTabActive && "text-foreground"
  )}
  aria-label="Focus flow tab"
  title={hasFlowTab ? 'Flow 탭으로 이동' : '열린 Flow 탭이 없습니다'}
>
  <Workflow size={16} />
</Button>
```

`Workflow` 아이콘 import (lucide-react). `GitBranch`는 다른 곳에서 안 쓰므로 의미상 더 적합한 `Workflow` 선택.

**Layout에서 wiring** ([Layout.tsx](app/frontend/src/components/Layout.tsx))

```tsx
const { activeTabType, focusFirstFlowTab, flowTabs } = useTabsContext();
const isFlowTabActive = activeTabType === 'flow';
const hasFlowTab = flowTabs.length > 0;

// TopBar 호출에 추가
<TopBar
  // ...
  hasFlowTab={hasFlowTab}
  isFlowTabActive={isFlowTabActive}
  onFlowClick={focusFirstFlowTab}
/>
```

### A.4 Acceptance Criteria

- A1. 우측 액션 영역의 가장 왼쪽(또는 Database 직전)에 `Workflow` 아이콘 1개 추가.
- A2. flow 탭이 1개 이상 있고 현재 활성 탭이 비-flow일 때 클릭하면 가장 최근(또는 첫 번째) flow 탭으로 전환.
- A3. flow 탭이 0개일 때 disabled 상태 + tooltip "열린 Flow 탭이 없습니다".
- A4. 현재 활성 탭이 이미 flow면 disabled + 강조된 색(`text-foreground`).
- A5. 키보드 포커스/스크린리더 라벨 정상.

---

## B. WorkspacePill 텍스트 정리

### B.1 문제 — 화면에서 본 두 가지

스크린샷:
```
종목 분석   🔍 활성 종목 MU   📅 기간 3개월   💾 Data Sandbox 수정값 사용 미...
```

**B-1: 좌측 "종목 분석" 라벨이 모호하다**

- 현재 `<span>종목 분석</span>` 단독으로 떠 있어 "이게 탭 이름인가? 모드 토글인가?" 헷갈린다.
- 의도는 "이 행은 종목 분석 컨텍스트에 적용되는 설정입니다"였지만 라벨만으로는 전달 안 됨.

**B-2: "Data Sandbox 수정값 사용 미..." 잘림**

- 현재 라벨 `Data Sandbox 수정값 사용` + 값 `미사용` 합쳐서 `max-w-[220px]` 안에 들어가지 못해 truncate.
- 사용자가 값(미사용/사용 중 N)을 못 봐서 칩의 정보 가치가 0.

### B.2 목표

- 좌측 라벨이 "이 칩들은 어디에 영향을 미치는가"를 명확히 전달하거나, 명확히 못 하면 제거하고 칩 자체의 tooltip에 위임.
- 모든 칩에서 값(value)이 절대 truncate되지 않게. 라벨이 길면 라벨을 줄이거나 숨기거나 한다.

### B.3 설계

**B-1 결정: 좌측 라벨 제거 + 첫 칩 앞에 작은 배지로 대체**

라벨 제거. 대신 첫 번째 칩(활성 종목) 안의 아이콘 옆에 "분석 컨텍스트" 의미를 주는 작은 배지 또는 좌측 컨테이너에 미세한 좌측 보더로 시각 그루핑.

```tsx
// workspace-pill.tsx
return (
  <div
    className="flex items-center gap-2 rounded-full border border-border/40 bg-background/40 px-2 py-1"
    role="group"
    aria-label={language === 'ko' ? '종목 분석 컨텍스트' : 'Stock analysis context'}
  >
    {/* 3개 PillButton 그대로 */}
  </div>
);
```

`<span>종목 분석</span>` 제거. 대신 컨테이너 자체에 옅은 보더+배경을 줘서 "이 칩들은 한 묶음의 컨텍스트"임을 시각적으로 표현. `aria-label`은 스크린리더용으로 보존.

**B-2 결정: 라벨 단축 + 반응형 가시성 강화**

`PillButton`의 `label`을 더 짧게 + `xl:inline` 대신 `2xl:inline`으로 더 좁힘:

```tsx
// PillButton 시그니처는 그대로, 호출부만 수정
<PillButton
  icon={<Database className="h-3.5 w-3.5" />}
  label={t('sandboxLabel', language)}  // 새 키: ko='샌드박스', en='Sandbox'
  value={sandboxLabel}
  title={sandboxScopeTitle}
/>
```

라벨 단축안:
| 칩 | 기존 라벨 (ko) | 새 라벨 (ko) | 기존 (en) | 새 (en) |
|---|---|---|---|---|
| 활성 종목 | `t('activeTicker')` = "활성 종목" | (유지) | "Active Ticker" | (유지) |
| 기간 | `t('period')` = "기간" | (유지) | "Period" | (유지) |
| Data Sandbox | `t('useDataSandboxOverrides')` = "Data Sandbox 수정값 사용" | "샌드박스" | "Use Data Sandbox Overrides" | "Sandbox" |

`useDataSandboxOverrides` 키는 다른 곳에서도 쓰이므로 그대로 두고, **새 i18n 키 `sandboxLabel`만 추가**.

또한 `PillButton`의 컨테이너 스타일 조정:
- `max-w-[220px]` → `max-w-none`으로 풀고 칩 자체가 자연 너비를 갖게
- `<span className="truncate ...">` → `truncate` 제거하고 `whitespace-nowrap` 유지
- 반응형: 라벨은 `hidden xl:inline` 유지, 값은 항상 표시

```tsx
const PillButton = forwardRef<HTMLButtonElement, { icon: ReactNode; label: string; value: string; title?: string }>(
  function PillButton({ icon, label, value, title }, ref) {
    return (
      <Button
        ref={ref}
        variant="outline"
        title={title}
        className="h-8 gap-1.5 rounded-full border-border/80 bg-background/70 px-3 text-xs font-medium shadow-sm whitespace-nowrap"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="hidden text-muted-foreground xl:inline">{label}</span>
        <span className="text-primary">{value}</span>
      </Button>
    );
  },
);
```

`max-w-[220px]` 제거 + `truncate` 제거. 값은 끝까지 보임.

**i18n 추가** ([language-preferences.ts](app/frontend/src/lib/language-preferences.ts))

```ts
sandboxLabel: { ko: '샌드박스', en: 'Sandbox' },
```

**기존 `useDataSandboxOverrides` 키는 유지** — Popover 내부 헤더 등 다른 곳에서 쓰임.

### B.4 Acceptance Criteria

- B1. 탑바 좌측에 "종목 분석" 텍스트 라벨이 더 이상 보이지 않는다.
- B2. 3개 칩이 옅은 보더 + 배경의 컨테이너 안에 시각적으로 그루핑되어 표시된다.
- B3. 컨테이너의 `aria-label`은 "종목 분석 컨텍스트" / "Stock analysis context"로 설정.
- B4. Data Sandbox 칩이 "샌드박스 미사용" / "샌드박스 사용 중 3" 등 **값까지 절대 truncate되지 않는다** (lg/xl 모두에서).
- B5. 칩 hover 시 기존 title (적용 범위 설명) 그대로 노출.
- B6. 새 i18n 키 `sandboxLabel` ko/en 모두 정의.
- B7. 기존 `useDataSandboxOverrides` 키는 그대로 유지 (다른 사용처 보존).

---

## 통합 변경 파일 리스트

### 수정

```
app/frontend/src/contexts/tabs-context.tsx              # Part A: flowTabs + focusFirstFlowTab 노출
app/frontend/src/components/Layout.tsx                  # Part A: hasFlowTab/onFlowClick 전달
app/frontend/src/components/layout/top-bar.tsx          # Part A: Workflow 버튼 추가
app/frontend/src/components/layout/workspace-pill.tsx   # Part B: 좌측 라벨 제거, 컨테이너 그루핑, PillButton truncate 제거, sandboxLabel 키로 변경
app/frontend/src/lib/language-preferences.ts            # Part B: sandboxLabel 키 추가
```

### 신규

```
tests/test_topbar_polish_static.py    # 정적 검증
```

---

## 통합 작업 분해

```
Phase 1 — Part A: tabs-context flowTabs/focusFirstFlowTab 추가 (~15m)
Phase 2 — Part A: TopBar Workflow 버튼 + Layout wiring (~15m)
Phase 3 — Part B: WorkspacePill 좌측 라벨 제거 + 컨테이너 그루핑 (~10m)
Phase 4 — Part B: PillButton 너비/truncate 정리 + sandboxLabel i18n (~15m)
Phase 5 — 정적 테스트 + tsc + vite build + 회귀 (~20m)
```

---

## 통합 시나리오

1. 사용자가 Flow 탭에서 작업 중. 우측 액션에 4개 아이콘 (Workflow disabled / Database / Search / Settings).
2. Stock Search 탭 클릭 → Workflow 아이콘이 enabled로 바뀜 (현재 비-flow 탭).
3. 우측 상단 WorkspacePill 영역:
   - "종목 분석" 텍스트 라벨 사라짐
   - 3개 칩이 둥근 보더 컨테이너 안에 그루핑되어 보임
   - "샌드박스 미사용" 칩이 truncate 없이 전체 텍스트 표시
4. Workflow 아이콘 클릭 → 가장 최근(또는 첫) flow 탭으로 즉시 전환 → 패널 자동 복원.
5. flow 탭이 0개인 상태에서 Workflow 아이콘은 disabled + tooltip "열린 Flow 탭이 없습니다".
