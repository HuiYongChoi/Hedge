# Codex 인계 프롬프트 — Top Bar / Workspace Pill 정리

아래 블록을 그대로 Codex에 복붙하세요.

---

## ▼ 복붙 시작

당신은 `ai-hedge-fund` 프론트엔드(React + TypeScript + Vite + ReactFlow) 시니어 엔지니어입니다. **상단 탑바 영역의 두 가지 UX 정합성 문제**를 한 번에 해결하는 작업을 수행합니다.

- **Part A** — Flow 편집기 전용 패널 토글이 모든 탭에서 노출되는 문제
- **Part B** — WorkspacePill의 5개 칩 중 2개(에이전트 / 모델)가 flow 실행과 연계되지 않아 거짓말 UI가 되는 문제

### 사전 컨텍스트 (반드시 먼저 읽기)

1. `docs/ui/topbar_cleanup/DESIGN.md` — 전체 설계 (이게 진리)
2. `app/frontend/src/components/Layout.tsx` — 패널 상태(`isLeftCollapsed` / `isRightCollapsed` / `isBottomCollapsed`) 보유, TopBar / WorkspacePill 렌더
3. `app/frontend/src/components/layout/top-bar.tsx` — 6개 버튼 정의 (3개 패널 토글 + divider + Database/Search/Settings)
4. `app/frontend/src/components/layout/workspace-pill.tsx` — 5개 칩 (수정 대상)
5. `app/frontend/src/contexts/tabs-context.tsx` — `TabType = 'flow' | 'settings' | 'stock-search' | 'data-sandbox'`, 현재 `activeTabId`만 노출
6. `app/frontend/src/contexts/layout-context.tsx` — bottom panel 상태/액션
7. `app/frontend/src/contexts/workspace-context.tsx` — workspace 상태 + setter들. **변경 금지** — Part B에서 일부 setter는 stock-search 탭이 계속 사용해야 함
8. `app/frontend/src/components/tabs/stock-search-tab.tsx` — `setSelectedAgents` / `toggleAgent` / `setSelectedModel` 사용처 (라인 745 근처)
9. `app/frontend/src/hooks/use-keyboard-shortcuts.ts` — ⌘B / ⌘I / ⌘J 매핑
10. `app/frontend/src/hooks/use-workspace-sync.ts` — flow 노드 ↔ workspace 양방향 동기화 (참고만, 변경 없음)
11. `app/frontend/src/lib/language-preferences.ts` — i18n 사전 (Part B에서 일부 키 정리)

### 진단 (왜 하는가)

**Part A**: 좌/우/하단 패널은 Flow 편집기 가구. settings · stock-search · data-sandbox 탭에선 무의미한데 항상 노출되어 (a) 시각적 노이즈 (b) 비-flow 탭에서도 사이드바가 펼쳐져 콘텐츠 좁아짐.

**Part B**: WorkspacePill의 5개 칩 중:
- ✅ 활성 종목 / 기간 / Data Sandbox 수정값 → 진짜로 flow + stock-search 양방향 연계
- ❌ 선택된 에이전트 / 워크스페이스 모델 → flow 실행 시 무시됨 (flow는 그래프 노드와 노드별 모델로 따로 관리). 사용자가 pill에서 모델 바꿔도 flow는 무시 → 거짓말 UI

→ Part B에서는 거짓말하는 2개 칩을 제거하고, 남은 3개 칩이 "종목 분석 컨텍스트"용임을 라벨/툴팁으로 명시.

### 요구사항 (Acceptance Criteria — 전부 통과해야 완료)

**Part A**
A1. Flow 탭 활성 시 TopBar에 3개 패널 토글 + divider + 우측 액션 아이콘(Database/Search/Settings) 모두 표시.
A2. 비-flow 탭 활성 시 TopBar에 우측 액션 아이콘만 표시.
A3. Flow → 비-flow 전환 시 Left/Right/Bottom 패널 자동 collapse.
A4. 비-flow → Flow 전환 시 직전 flow 세션의 패널 상태 복원.
A5. ⌘B / ⌘I / ⌘J 단축키는 Flow 탭에서만 동작.
A6. localStorage 영속 동작 보존 — 새 세션 첫 flow 진입 시 마지막으로 저장된 패널 상태 복원.

**Part B**
B1. WorkspacePill에 3개 칩만 표시 (활성 종목 / 기간 / Data Sandbox).
B2. lg 화면에서 "종목 분석" 라벨이 칩 앞에 표시.
B3. 남은 3개 칩 모두 hover 시 적용 범위를 설명하는 title 표시.
B4. 에이전트/모델 pill 제거에도 stock-search 탭의 에이전트 선택, 모델 선택 기능은 정상 동작 (workspace context는 절대 건드리지 말 것).
B5. WorkspacePill 외에 사용처가 없는 i18n 키만 제거 (사전 검증 필수).
B6. 새 콘솔 워닝/타입 에러 없음.

**공통**
C1. `npm run build` 성공.
C2. `pytest tests/ --ignore=tests/backtesting -q` 회귀 0.
C3. 신규 정적 테스트 `tests/test_topbar_cleanup_static.py` 작성 + 통과.

---

### 구현 단계 (순서대로)

#### Phase 1 — Part A: `tabs-context.tsx` 보강

`TabsContextType`에 derived 값 두 개 추가:

```tsx
interface TabsContextType {
  // ...기존 필드 그대로
  activeTab: Tab | null;
  activeTabType: TabType | null;
}
```

`TabsProvider` 안에서 derive (callback 안 써도 됨, render마다 가벼움):

```tsx
const activeTab = activeTabId ? tabs.find(t => t.id === activeTabId) ?? null : null;
const activeTabType = activeTab?.type ?? null;
```

`value` 객체에 두 키 추가. **기존 필드는 절대 변경 금지**.

#### Phase 2 — Part A: `top-bar.tsx` 조건부 렌더

`TopBarProps`에 `isFlowTab: boolean` prop 추가. 컴포넌트 내부에서:

```tsx
{isFlowTab && (
  <>
    <Button ...>{/* PanelLeft 토글 */}</Button>
    <Button ...>{/* PanelBottom 토글 */}</Button>
    <Button ...>{/* PanelRight 토글 */}</Button>
    <div className="w-px h-5 bg-ramp-grey-700 mx-1" />
  </>
)}
```

`isFlowTab=false`일 때는 Database/Search/Settings 3개만 보임. 컨테이너 div의 `gap-0 py-1 px-2 bg-panel/80` 등 기존 클래스는 유지.

#### Phase 3 — Part A: `Layout.tsx` 자동 collapse + 복원

`useTabsContext()`에서 `activeTabType` destructure. `isFlowTab` 계산:

```tsx
const { openTab, activeTabType } = useTabsContext();
const isFlowTab = activeTabType === 'flow';
```

`<TopBar isFlowTab={isFlowTab} ... />`로 prop 전달.

새 state 추가 (`isLeftCollapsed` 선언 근처):

```tsx
const [savedFlowPanelState, setSavedFlowPanelState] = useState<{
  left: boolean;
  right: boolean;
  bottom: boolean;
} | null>(null);
```

`useLayoutKeyboardShortcuts` 호출 후에 effect 추가:

```tsx
useEffect(() => {
  if (activeTabType === null) return;

  if (activeTabType === 'flow') {
    if (savedFlowPanelState) {
      setIsLeftCollapsed(savedFlowPanelState.left);
      setIsRightCollapsed(savedFlowPanelState.right);
      if (savedFlowPanelState.bottom) {
        collapseBottomPanel();
      } else {
        expandBottomPanel();
      }
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
  if (!isBottomCollapsed) {
    collapseBottomPanel();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTabType]);
```

**중요**: 의존성 배열에 `activeTabType`만 둘 것. `isLeft/Right/BottomCollapsed`는 effect 안에서 set되므로 의존성에 넣으면 무한 루프. ESLint 경고는 위 주석으로 disable.

`useLayoutKeyboardShortcuts` 핸들러에 `isFlowTab` 가드:

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

#### Phase 4 — Part B: `workspace-pill.tsx` 정리

**삭제할 블록 두 개** (현재 코드 기준 라인 번호):

1. `Users` 아이콘 칩 (선택된 에이전트) Popover (line 185~213)
2. `Cpu` 아이콘 칩 (워크스페이스 모델) Popover (line 215~237)

**관련 정리** (위 블록 제거 후 자연히 dead code 되는 것들):

- `import { CalendarDays, Cpu, Database, Search, Users } from 'lucide-react';` → `Cpu`, `Users` 제거 (`CalendarDays`, `Database`, `Search`는 유지)
- `import { ModelSelector } from '@/components/ui/llm-selector';` → 제거
- `import { Agent, getAgents } from '@/data/agents';` → 제거
- `import { getModels, LanguageModel } from '@/data/models';` → 제거
- `useState`로 보유한 `agents`, `models` state 제거
- `useEffect` 블록 (`Promise.all([getAgents(), getModels()])`) 제거 (현재 line 75~91)
- `selectedAgentNames`, `agentCountLabel`, `modelLabel` useMemo/계산 제거
- `useWorkspace` destructure에서 `setSelectedModel` 제거 (`setTickers`, `setDateRange`, `setUseDataSandboxOverrides`만 남김)

**추가** — 라벨 + 툴팁:

```tsx
return (
  <div className="flex items-center gap-2">
    <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/70 lg:inline">
      {language === 'ko' ? '종목 분석' : 'Stock analysis'}
    </span>

    {/* 활성 종목 Popover (기존, 단 PillButton에 title 전달) */}
    <Popover>
      <PopoverTrigger asChild>
        <PillButton
          icon={<Search className="h-3.5 w-3.5" />}
          label={t('activeTicker', language)}
          value={tickerLabel}
          title={language === 'ko'
            ? '종목 분석 탭과 플로우 노드(워크스페이스 동기화 ON)에 적용됩니다'
            : 'Applies to Stock Analysis tab and flow nodes with workspace sync ON'}
        />
      </PopoverTrigger>
      ...
    </Popover>

    {/* 기간 Popover (동일하게 title 전달) */}
    {/* Data Sandbox Popover (동일하게 title 전달, 단 다음 카피 사용) */}
  </div>
);
```

각 칩별 title 한국어 카피:
- **활성 종목**: "종목 분석 탭과 플로우 노드(워크스페이스 동기화 ON)에 적용됩니다"
- **기간**: "종목 분석 탭과 플로우 노드(워크스페이스 동기화 ON)에 적용됩니다"
- **Data Sandbox**: "종목 분석 / 플로우 실행 시 Data Sandbox 수정값을 함께 보냅니다"

영문 카피도 적절히. `t(...)` 키를 새로 만들거나 인라인 ternary 둘 다 OK (간단하게 인라인 권장).

**PillButton 시그니처 확장**:

```tsx
const PillButton = forwardRef<HTMLButtonElement, {
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
}>(function PillButton({ icon, label, value, title }, ref) {
  return (
    <Button
      ref={ref}
      title={title}
      variant="outline"
      className="h-8 max-w-[220px] gap-1.5 rounded-full border-border/80 bg-background/70 px-3 text-xs font-medium shadow-sm"
    >
      ...
    </Button>
  );
});
```

#### Phase 5 — Part B: i18n 키 정리

**먼저 사용처 검증** (전부 실행):

```bash
git grep -n "t('agentsSelected'" app/frontend/src/
git grep -n "t('workspaceModel'" app/frontend/src/
git grep -n "t('noAgentsSelected'" app/frontend/src/
git grep -n "t('selectAgentsInStockSearch'" app/frontend/src/
```

**규칙**:
- workspace-pill.tsx 외에 매치 0건이면 → `language-preferences.ts`에서 해당 키 제거 (ko/en 양쪽).
- workspace-pill.tsx 외에 1건이라도 있으면 → 해당 키는 유지.

**워크스페이스 컨텍스트는 절대 건드리지 말 것**:
- `setSelectedAgents`, `toggleAgent`, `setSelectedModel`, `selectedAgents`, `selectedModel` — workspace-context.tsx에 모두 그대로 유지.
- localStorage 저장도 그대로 (다른 세션에서 stock-search 진입 시 복원되어야 함).

#### Phase 6 — 정적 검증 테스트 + 빌드 + 회귀

**신규 파일: `tests/test_topbar_cleanup_static.py`**

기존 `tests/test_workspace_pill_and_node_sync_static.py` 패턴 참고:

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOP_BAR = ROOT / "app/frontend/src/components/layout/top-bar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
TABS_CONTEXT = ROOT / "app/frontend/src/contexts/tabs-context.tsx"
WORKSPACE_PILL = ROOT / "app/frontend/src/components/layout/workspace-pill.tsx"


class TopBarCleanupStaticTests(unittest.TestCase):
    # Part A
    def test_top_bar_gates_panel_toggles_on_isFlowTab(self):
        source = TOP_BAR.read_text(encoding="utf-8")
        self.assertIn("isFlowTab", source)
        self.assertIn("isFlowTab &&", source)

    def test_layout_tracks_saved_flow_panel_state(self):
        source = LAYOUT.read_text(encoding="utf-8")
        self.assertIn("savedFlowPanelState", source)
        self.assertIn("activeTabType", source)

    def test_tabs_context_exposes_active_tab_type(self):
        source = TABS_CONTEXT.read_text(encoding="utf-8")
        self.assertIn("activeTabType", source)
        self.assertIn("activeTab:", source)

    # Part B
    def test_workspace_pill_drops_agent_and_model_chips(self):
        source = WORKSPACE_PILL.read_text(encoding="utf-8")
        # 더 이상 import하지 않음
        self.assertNotIn("from '@/data/agents'", source)
        self.assertNotIn("from '@/data/models'", source)
        self.assertNotIn("ModelSelector", source)
        # lucide 아이콘 두 개 사라짐
        self.assertNotIn("Users", source.split("from 'lucide-react'")[0] if "from 'lucide-react'" in source else source)
        self.assertNotIn(", Cpu", source)

    def test_workspace_pill_has_stock_analysis_label(self):
        source = WORKSPACE_PILL.read_text(encoding="utf-8")
        self.assertIn("종목 분석", source)


if __name__ == "__main__":
    unittest.main()
```

**빌드 + 회귀**:

```bash
cd app/frontend && npm run build
cd ../.. && pytest tests/ --ignore=tests/backtesting -q
pytest tests/test_topbar_cleanup_static.py -v
```

모두 통과해야 함.

---

### 작업 가이드라인

- **workspace-context.tsx 수정 절대 금지**. setter/state 그대로 둬야 stock-search 탭이 계속 동작.
- **기존 키보드 단축키 매핑은 변경 금지**. ⌘B/⌘I/⌘J/⌘O/⌘,/Shift+⌘J 모두 그대로 (단 Flow 탭 가드만 추가).
- **Settings/Database/Search 버튼은 항상 표시**. 탭 전환용이라 globally 유효.
- **패널 자동 collapse는 effect 안에서만**. 사용자 액션(클릭/단축키)에서는 직접 set하지 말 것.
- **localStorage 새 키 추가 금지**. `savedFlowPanelState`는 in-memory only.
- **TypeScript strict 통과 필수**. `Tab | null`, `TabType | null` 명시.
- **eslint-disable 주석은 effect 의존성 한 줄에만** (Phase 3 effect에서). 다른 곳에 사용 금지.
- **i18n 키 제거 시 ko/en 양쪽 동시에**. 한쪽만 제거하면 안 됨.
- **PillButton의 기존 ref 전달 동작 보존**. forwardRef + displayName 유지.

### 보고 형식

작업 완료 후 다음을 출력:

1. **변경 파일 리스트** (신규 / 수정 분리)
2. **`git grep` 결과 요약** (Phase 5에서 i18n 키 제거 결정 근거)
3. **`npm run build` 결과** (성공/실패 + 마지막 5줄)
4. **`pytest tests/test_topbar_cleanup_static.py -v` 결과**
5. **`pytest tests/ --ignore=tests/backtesting -q` 결과 (회귀)**
6. **수동 검증**: 통합 시나리오 (DESIGN.md 마지막 절) 단계별 OK/NG. 브라우저 검증 안 되면 코드 트레이스로 설명.

## ▲ 복붙 끝

---

## 보조: 사용자 직접 수동 검증 체크리스트

배포 후 브라우저(http://54.116.99.19/hedge)에서:

**Part A**
- [ ] Flow 탭에서 좌측 / 하단 / 우측 패널 토글 보임
- [ ] Settings 탭 열기 → 3개 토글 사라짐 + 사이드바 자동 닫힘
- [ ] Flow 탭으로 돌아가기 → 직전 패널 상태 복원
- [ ] Stock Search 탭에서 ⌘B 눌러도 사이드바 변동 없음

**Part B**
- [ ] WorkspacePill에 칩 3개만 보임 (종목 / 기간 / Sandbox)
- [ ] lg 너비 화면에서 "종목 분석" 라벨 보임
- [ ] 칩 hover 시 적용 범위 툴팁 표시
- [ ] Stock Search 탭에서 에이전트 선택, 모델 선택 정상 동작
- [ ] 새로고침 후에도 위 동작 유지
