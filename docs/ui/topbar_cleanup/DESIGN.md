# Top Bar / Workspace Pill 정리

탑바 영역에서 두 가지 UX 정합성 문제를 함께 해결한다:

- **Part A**: Flow 편집기 전용 패널 토글이 모든 탭에서 노출됨
- **Part B**: WorkspacePill 5개 칩 중 2개(에이전트 / 모델)가 flow 실행과 연계되지 않음

---

## Part A — Flow 전용 패널 토글 스코핑

### A.1 문제

상단 우측 툴바의 3개 패널 토글(`PanelLeft` / `PanelBottom` / `PanelRight`)은 **Flow 편집기 가구**(왼쪽=컴포넌트 팔레트, 오른쪽=컴포넌트 설정/플로우 출력, 아래=실행 출력)를 제어한다. 그러나 현재는 모든 탭에서 항상 노출된다.

| 탭 타입 | 패널 토글 의미 |
|---|---|
| `flow` | ✅ 의미 있음 |
| `settings` | ❌ 무의미 |
| `stock-search` | ❌ 무의미 |
| `data-sandbox` | ❌ 무의미 |

부수 증상: 비-flow 탭에서도 사이드바가 펼쳐진 상태이면 탭 콘텐츠 영역이 좁아져 화면 낭비.

### A.2 목표

1. **3개 패널 토글 버튼은 Flow 탭이 활성일 때만 표시**.
2. **비-flow 탭으로 전환되면 패널 자동 collapse**, 콘텐츠가 풀 너비/풀 높이 사용.
3. **Flow 탭으로 복귀하면 사용자가 마지막으로 보던 패널 상태 복원**.
4. **Settings · Database · Search 아이콘 + ⌘ 키보드 단축키는 영향 없음** (탭 진입용 globally 유효).
5. **localStorage 영속 동작 보존** — 새 세션에서 마지막 flow 패널 상태로 복귀.

### A.3 설계

**활성 탭 타입 노출**

`useTabsContext()`는 `activeTabId`만 노출 중. 토글 가시성과 자동 collapse 둘 다 활성 탭 **타입**이 필요하므로 derive 추가:

```tsx
const activeTab = activeTabId ? tabs.find(t => t.id === activeTabId) ?? null : null;
const activeTabType = activeTab?.type ?? null;
```

`TabsContextType`에 `activeTab: Tab | null`, `activeTabType: TabType | null` 추가.

**TopBar 가시성**

```tsx
{isFlowTab && (
  <>
    <Button .../>{/* PanelLeft */}
    <Button .../>{/* PanelBottom */}
    <Button .../>{/* PanelRight */}
    <div className="w-px h-5 bg-ramp-grey-700 mx-1" />
  </>
)}
```

Settings / Database / Search 버튼은 항상 표시.

**자동 collapse + 복원** ([Layout.tsx](app/frontend/src/components/Layout.tsx))

```tsx
const [savedFlowPanelState, setSavedFlowPanelState] = useState<{
  left: boolean; right: boolean; bottom: boolean;
} | null>(null);

useEffect(() => {
  if (activeTabType === null) return;

  if (activeTabType === 'flow') {
    if (savedFlowPanelState) {
      setIsLeftCollapsed(savedFlowPanelState.left);
      setIsRightCollapsed(savedFlowPanelState.right);
      if (savedFlowPanelState.bottom) collapseBottomPanel();
      else expandBottomPanel();
    }
    return;
  }

  const allCollapsed = isLeftCollapsed && isRightCollapsed && isBottomCollapsed;
  if (!allCollapsed) {
    setSavedFlowPanelState({
      left: isLeftCollapsed,
      right: isRightCollapsed,
      bottom: isBottomCollapsed,
    });
  }
  setIsLeftCollapsed(true);
  setIsRightCollapsed(true);
  if (!isBottomCollapsed) collapseBottomPanel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTabType]);
```

의존성 배열에 `activeTabType`만 둠 — `isLeft/Right/BottomCollapsed`는 effect 안에서 set되므로 의존성에 넣으면 무한 루프.

**키보드 단축키**

```tsx
useLayoutKeyboardShortcuts(
  () => { if (isFlowTab) setIsRightCollapsed(!isRightCollapsed); },
  () => { if (isFlowTab) setIsLeftCollapsed(!isLeftCollapsed); },
  () => reactFlowInstance.fitView({ padding: 0.1, duration: 500 }),
  undefined,
  undefined,
  () => { if (isFlowTab) toggleBottomPanel(); },
  handleSettingsClick,
);
```

### A.4 동작 시나리오

- **A1 (Flow → Stock Search → Flow)**: 패널 상태 백업 → 모두 collapse → 복귀 시 복원
- **A2 (첫 로드 시 마지막 활성 탭이 Settings)**: localStorage의 패널 상태가 백업되고 collapse → flow 진입 시 복원
- **A3 (비-flow 탭에서 ⌘B)**: 무시, 사이드바 변동 없음

### A.5 Acceptance Criteria

A1. Flow 탭 활성 시 TopBar에 3개 패널 토글 + divider + 우측 액션 아이콘 모두 표시.
A2. 비-flow 탭 활성 시 TopBar에 우측 액션 아이콘만 표시.
A3. Flow → 비-flow 전환 시 Left/Right/Bottom 패널 자동 collapse.
A4. 비-flow → Flow 전환 시 직전 flow 세션의 패널 상태 복원.
A5. ⌘B / ⌘I / ⌘J 단축키는 Flow 탭에서만 동작.
A6. localStorage 영속 동작 보존.

---

## Part B — WorkspacePill 정리

### B.1 문제

탑바 우측 끝 [WorkspacePill](app/frontend/src/components/layout/workspace-pill.tsx)은 5개 칩(활성 종목 / 선택된 에이전트 / 워크스페이스 모델 / 기간 / Data Sandbox 수정값)을 노출. 그런데 실제 연계 상태는:

| Pill | flow 노드 | stock-search | data-sandbox | 평가 |
|---|---|---|---|---|
| **활성 종목** | ✅ `useWorkspaceSync`로 양방향 | ✅ | ✅ ticker 매칭 | OK |
| **선택된 에이전트** | ❌ flow는 그래프 노드로 관리 | ✅ | — | **반쪽** |
| **워크스페이스 모델** | ❌ flow는 노드별 모델 별도 관리 | ✅ | — | **반쪽** |
| **기간** | ✅ 양방향 | ✅ | — | OK |
| **Data Sandbox 수정값** | ✅ `workspace.useDataSandboxOverrides` | ✅ | ✅ event 동기화 | OK |

→ 사용자가 pill에서 모델/에이전트 바꿔도 flow 실행 시 무시됨. **거짓말 UI**.

### B.2 목표

- 진짜로 양방향 연계되는 3개 칩만 남기고, 거짓말하는 2개 칩(에이전트, 모델) 제거.
- 남은 칩들이 "종목 분석 컨텍스트"용임을 시각적으로 명시.
- workspace context의 `selectedAgents`, `selectedModel` 자체는 **유지** — stock-search 탭 내부에서 진짜로 쓰고 있음.

### B.3 설계

**제거 대상** ([workspace-pill.tsx](app/frontend/src/components/layout/workspace-pill.tsx))

- `Users` 아이콘 칩 (선택된 에이전트) Popover 블록 통째 삭제 (line 185~213)
- `Cpu` 아이콘 칩 (워크스페이스 모델) Popover 블록 통째 삭제 (line 215~237)
- 관련 import 정리:
  - lucide-react: `Cpu`, `Users` 제거
  - `import { ModelSelector }` 제거
  - `getModels`, `LanguageModel` 제거 (data/models)
  - `getAgents`, `Agent` 제거 (data/agents)
- `useState`로 보유한 `agents`, `models` state 제거
- 관련 `useEffect` 블록 (`Promise.all([getAgents(), getModels()])`) 제거
- `selectedAgentNames`, `agentCountLabel`, `modelLabel` useMemo/계산 제거
- destructure에서 `setSelectedModel` 제거 (workspace context 함수는 유지, 이 컴포넌트에서만 안 씀)

**라벨 명시** — 남은 3개 칩 앞에 작은 라벨 추가:

```tsx
<div className="flex items-center gap-2">
  <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/70 lg:inline">
    {language === 'ko' ? '종목 분석' : 'Stock analysis'}
  </span>
  {/* 활성 종목 / 기간 / Data Sandbox pill 3개 */}
</div>
```

라벨은 `lg:inline`(좁은 화면에서 숨김)으로 반응형 처리.

**툴팁 보강** — 각 남은 PillButton의 `title` 속성에 "이 설정은 종목 분석 탭/플로우 노드에 실시간 반영됩니다" 문구 추가하여 행동 범위 명확화.

```tsx
// PillButton에 title prop 받게 시그니처 확장
const PillButton = forwardRef<HTMLButtonElement, {
  icon: ReactNode; label: string; value: string; title?: string;
}>(function PillButton({ icon, label, value, title }, ref) {
  return <Button ref={ref} title={title} ...>...</Button>;
});
```

각 칩별 한국어 title:
- 활성 종목: "종목 분석 탭과 플로우 노드(워크스페이스 동기화 ON)에 적용됩니다"
- 기간: "종목 분석 탭과 플로우 노드(워크스페이스 동기화 ON)에 적용됩니다"
- Data Sandbox: "종목 분석 / 플로우 실행 시 Data Sandbox 수정값을 함께 보냅니다"

### B.4 language-preferences.ts 정리

**사전 검증 필수** — `git grep`으로 다른 파일 사용 여부 확인 후에만 제거:

후보 키:
- `agentsSelected` — 다른 파일 안 쓰면 제거
- `workspaceModel` — 다른 파일 안 쓰면 제거
- `noAgentsSelected` — stock-search 탭에서도 쓰면 유지
- `selectAgentsInStockSearch` — stock-search 탭에서도 쓰면 유지

```bash
# Codex가 직접 실행해서 결정
git grep -n "t('agentsSelected'" app/frontend/src/
git grep -n "t('workspaceModel'" app/frontend/src/
git grep -n "t('noAgentsSelected'" app/frontend/src/
git grep -n "t('selectAgentsInStockSearch'" app/frontend/src/
```

**원칙: workspace-pill.tsx 외에 사용처가 있으면 i18n 키는 그대로 둔다**.

### B.5 잔존 보장 (절대 건드리지 말 것)

- `useWorkspace().setSelectedAgents`, `toggleAgent`, `setSelectedModel`은 [stock-search-tab.tsx:745](app/frontend/src/components/tabs/stock-search-tab.tsx:745)에서 사용 중 → workspace-context.tsx 그대로.
- `workspace.selectedAgents`, `workspace.selectedModel` localStorage 저장도 그대로 (다른 세션에서 stock-search 진입 시 복원).

### B.6 Acceptance Criteria

B1. WorkspacePill에 3개 칩만 표시 (활성 종목 / 기간 / Data Sandbox).
B2. 종목 분석 컨텍스트임을 알리는 라벨이 lg 화면에서 표시.
B3. 남은 3개 칩 모두 hover 시 적용 범위를 설명하는 title 표시.
B4. 에이전트/모델 pill 제거에도 stock-search 탭의 에이전트 선택, 모델 선택 기능은 정상 동작 (workspace context는 유지).
B5. 미사용된 i18n 키 제거 (단, 다른 파일 사용 여부 사전 검증).
B6. 새 콘솔 워닝/타입 에러 없음.

---

## 통합 변경 파일 리스트

### 수정

```
app/frontend/src/contexts/tabs-context.tsx              # Part A: activeTab, activeTabType derived 추가
app/frontend/src/components/Layout.tsx                  # Part A: isFlowTab + 자동 collapse + 복원 effect
app/frontend/src/components/layout/top-bar.tsx          # Part A: isFlowTab prop, 패널 토글 조건부 렌더
app/frontend/src/components/layout/workspace-pill.tsx   # Part B: 2개 칩 제거 + 라벨/툴팁 추가
app/frontend/src/lib/language-preferences.ts            # Part B: 미사용 i18n 키 정리 (사전 검증 후)
```

### 신규

```
tests/test_topbar_cleanup_static.py    # Part A + B 정적 검증
```

---

## 통합 작업 분해

```
Phase 1 — Part A: tabs-context 보강 (~20m)
Phase 2 — Part A: TopBar 조건부 렌더 (~15m)
Phase 3 — Part A: Layout 자동 collapse + 복원 (~30m)
Phase 4 — Part B: WorkspacePill 칩 2개 제거 + 라벨/툴팁 (~30m)
Phase 5 — Part B: i18n 키 정리 + 미사용 import 정리 (~15m)
Phase 6 — 정적 테스트 + 빌드 + 회귀 검증 (~25m)
```

---

## 통합 시나리오 — Part A + Part B 함께

1. 사용자가 Flow 탭에서 컴포넌트 팔레트 펼쳐 작업 중.
2. 우측 상단 WorkspacePill에서 **종목**을 'AAPL'에서 'AEP'로 바꿈 → useWorkspaceSync 통해 flow의 stock-analyzer 노드에도 즉시 'AEP' 반영.
3. **기간**을 3개월로 바꿈 → 동일하게 flow 노드에 반영.
4. Stock Search 탭 클릭:
   - Part A: 패널 모두 자동 collapse, 3개 패널 토글 사라짐
   - Part B: 종목/기간 pill은 그대로 보임, 에이전트/모델 pill은 없음 (stock-search 탭 내부에서 직접 선택하면 됨)
5. Stock Search 탭에서 에이전트 5명 선택 + 모델 GPT-5.4 Nano 선택 → workspace context 저장.
6. Flow 탭으로 복귀 → 패널 상태 복원, 토글 재등장.
7. Flow 실행 → stock-analyzer 노드는 'AEP' / 3개월 / Sandbox 토글 ON 적용. 노드별 모델은 별도 관리(workspace 모델과 분리)이므로 혼동 없음.
