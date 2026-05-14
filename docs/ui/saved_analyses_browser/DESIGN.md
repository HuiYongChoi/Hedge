# 저장 분석 브라우저 (Saved Analyses Browser) — 상세 설계안

> Base: 현재 main. Stock Analysis / Data Sandbox 탭에 "결과 DB 저장" 버튼은
> 있는데, **저장된 데이터를 다시 볼 화면이 없다**. 이 문서는 그 화면 (탭 +
> 메뉴) 을 추가하는 작업의 단일 source of truth.
> 작성 목적: Sonnet 이 이 파일만 보고 코드를 구현할 수 있을 만큼 상세한 사양.

---

## §0. 한 줄 요약

탭바 / 상단 nav 에 **"저장 분석" (Saved Analyses) 메뉴**를 추가한다. 클릭하면
새 탭 `'saved-analyses'` 이 열리고, 좌측에 저장 항목 리스트 (필터/페이지네이션),
우측에 선택된 항목의 디테일 (분석 화면 그대로 재구성) 이 보인다. 백엔드는
DELETE 1 개 + 필터 query param 만 추가, 나머지는 기존 API 재활용.

---

## §1. 현재 상태 (요약)

### §1.1 백엔드 (이미 존재)

`app/backend/routes/saved_analyses.py`:
- `POST /saved-analyses/` — 저장
- `GET  /saved-analyses/?limit=&skip=` — 리스트 (created_at desc, limit 기본 50)
- `GET  /saved-analyses/{id}` — 단건

`SavedAnalysis` (`app/backend/database/models.py:135`):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int | PK |
| created_at | datetime | server_default `now()` |
| source_tab | str(50) | `'stock_analysis'` 또는 `'data_sandbox'` |
| ticker | str(50) | indexed |
| language | str(10) | `'ko'` / `'en'` |
| request_data | JSON | 어떤 요청이었는지 |
| result_data | JSON | 실제 결과 (stock_analysis: `{agent_results, complete_result}`; data_sandbox: 스냅샷 dict) |

### §1.2 프론트엔드 (이미 존재)

- `app/frontend/src/services/saved-analyses-service.ts` — `saveAnalysis`,
  `getAllAnalyses`, `getAnalysisById`. **삭제 / 필터 미지원**.
- `stock-search-tab.tsx` 의 `handleSaveAnalysis` → "결과 DB 저장" 버튼.
- `data-sandbox-tab.tsx` 의 동일 버튼.

### §1.3 미존재 (이번 작업으로 추가)

- 저장된 분석을 **목록으로 보고 다시 여는 화면**.
- DELETE 엔드포인트.
- 리스트 필터 (ticker, source_tab, date range).
- 탭 시스템 등록 (`TabType` 확장, `TabService`, `TopBar` 메뉴 항목, `TabBar`
  아이콘).

---

## §2. 기능 범위

### §2.1 목표 (반드시 포함)

1. **새 탭 `'saved-analyses'`** 가 생기고 TopBar 의 archive 아이콘으로 연다.
2. **2-column 레이아웃**:
   - 좌측 (`w-[360px]`): 저장 항목 리스트 + 필터바 + 페이지네이션.
   - 우측 (`flex-1`): 선택된 항목 디테일.
3. **리스트 필터**:
   - source_tab (전체 / stock_analysis / data_sandbox)
   - ticker 검색 (case-insensitive substring)
   - 기간 필터 (created_at 의 from / to)
4. **디테일 보기 - source_tab 별 분기**:
   - `stock_analysis`: 기존 `AnalystReportDashboard` (v5) 를 saved 데이터로 렌더.
   - `data_sandbox`: saved snapshot 을 read-only 카드 그리드로 표시 (기존
     `DataSandboxTab` 의 표시부 일부 재활용).
5. **항목 액션**:
   - **다시 열기 (Restore)** — request_data 를 workspace 에 주입한 뒤 해당 원본
     탭 (stock-search 또는 data-sandbox) 으로 이동.
   - **삭제 (Delete)** — confirm 후 백엔드 DELETE 호출, 리스트 자동 새로고침.
   - **JSON 내보내기 (Export)** — `{filename: ticker-source-id.json}` 로 다운로드.
6. **i18n** — ko / en 모두 지원.

### §2.2 비목표 (이번 라운드 제외)

- 저장 항목의 **편집** (re-save with edits) — 별도 PR.
- 다중 선택 / 일괄 삭제 — Phase 2. 이번엔 단건 삭제만.
- 무한 스크롤 — `limit/skip` 페이지네이션 버튼만 (Prev / Next).
- 폴더 / 태그 — 미지원.
- 공유 / 권한 — 미지원 (single-user app).

---

## §3. 백엔드 변경

### §3.1 DELETE 엔드포인트

`app/backend/routes/saved_analyses.py` 끝에 추가:

```python
@router.delete(
    "/{analysis_id}",
    status_code=204,
    responses={
        404: {"model": ErrorResponse, "description": "Saved analysis not found"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
)
async def delete_saved_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
):
    try:
        repo = SavedAnalysisRepository(db)
        item = repo.get_by_id(analysis_id)
        if not item:
            raise HTTPException(status_code=404, detail="Saved analysis not found")
        repo.delete(analysis_id)
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete saved analysis: {str(e)}")
```

### §3.2 Repository 에 delete 추가

`app/backend/repositories/saved_analysis_repository.py`:

```python
def delete(self, analysis_id: int) -> None:
    item = self.db.query(SavedAnalysis).filter(SavedAnalysis.id == analysis_id).first()
    if item is None:
        return
    self.db.delete(item)
    self.db.commit()
```

### §3.3 GET 리스트에 필터 query param 추가

`list_saved_analyses` 시그니처 확장:

```python
async def list_saved_analyses(
    limit: int = 50,
    skip: int = 0,
    source_tab: Optional[str] = None,
    ticker: Optional[str] = None,
    created_from: Optional[str] = None,  # ISO date "YYYY-MM-DD"
    created_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
```

Repository `get_all` 도 동일 시그니처로 확장. 필터:

- `source_tab` 정확 일치
- `ticker` LIKE `%{ticker}%`, case-insensitive (`func.lower(ticker).contains(...)`)
- `created_from` → `created_at >= parse(created_from)`
- `created_to` → `created_at <= parse(created_to + " 23:59:59")`
- None 인 필터는 적용 안 함.

총 개수 응답도 필요 (페이지네이션) → response header `X-Total-Count` 로
return:

```python
total = repo.count(source_tab=..., ticker=..., created_from=..., created_to=...)
response.headers["X-Total-Count"] = str(total)
```

`repo.count(...)` 신규 메서드, 동일 필터 적용 후 `.count()`.

`from starlette.responses import Response` 사용. 또는 fastapi `Response`
객체를 의존성으로 주입 후 헤더 set.

### §3.4 신규 schema (필수 아님)

기존 `SavedAnalysisResponse` 그대로 사용. count 는 헤더만으로 처리 → 별도
schema 불필요.

### §3.5 마이그레이션

스키마 변경 없음 → alembic 마이그레이션 불필요.

---

## §4. 프론트엔드 변경 — 서비스 레이어

`app/frontend/src/services/saved-analyses-service.ts` 확장:

```ts
export interface SavedAnalysisFilter {
  source_tab?: 'stock_analysis' | 'data_sandbox';
  ticker?: string;
  created_from?: string;  // YYYY-MM-DD
  created_to?: string;
  limit?: number;
  skip?: number;
}

export interface SavedAnalysesListResponse {
  items: SavedAnalysis[];
  total: number;
}

export const savedAnalysisService = {
  // (기존)
  saveAnalysis: ...,
  getAnalysisById: ...,

  // 기존 getAllAnalyses 를 확장 — 시그니처 호환 위해 filter 객체 받는 새 메서드 추가
  getAllAnalyses: async (limit = 50, skip = 0) => {
    // backward-compat: 기존 시그니처 그대로
    const res = await listAnalyses({ limit, skip });
    return res.items;
  },

  listAnalyses: async (filter: SavedAnalysisFilter = {}): Promise<SavedAnalysesListResponse> => {
    const params = new URLSearchParams();
    params.set('limit', String(filter.limit ?? 50));
    params.set('skip', String(filter.skip ?? 0));
    if (filter.source_tab)   params.set('source_tab', filter.source_tab);
    if (filter.ticker)       params.set('ticker', filter.ticker);
    if (filter.created_from) params.set('created_from', filter.created_from);
    if (filter.created_to)   params.set('created_to', filter.created_to);
    const res = await fetch(`${API_BASE_URL}/saved-analyses/?${params}`);
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    const items: SavedAnalysis[] = await res.json();
    const total = Number(res.headers.get('X-Total-Count') ?? items.length);
    return { items, total };
  },

  deleteAnalysis: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/saved-analyses/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to delete: ${res.status}`);
    }
  },
};
```

기존 `getAllAnalyses` 호출 사이트가 깨지면 안 되므로 호환 유지.

---

## §5. 프론트엔드 변경 — 탭 시스템 등록

### §5.1 `tabs-context.tsx`

```ts
export type TabType = 'flow' | 'settings' | 'stock-search' | 'data-sandbox' | 'saved-analyses';
```

`generateTabId` 분기:

```ts
if (type === 'saved-analyses') {
  return 'saved-analyses';
}
```

### §5.2 `services/tab-service.ts`

```ts
import { SavedAnalysesTab } from '@/components/tabs/saved-analyses-tab';

// TabData.type
type: 'flow' | 'settings' | 'stock-search' | 'data-sandbox' | 'saved-analyses';

// createTabContent 의 switch
case 'saved-analyses':
  return createElement(SavedAnalysesTab);

// 새 static method
static createSavedAnalysesTab(): TabData & { content: ReactNode } {
  return {
    type: 'saved-analyses',
    title: 'Saved Analyses',
    content: TabService.createTabContent({ type: 'saved-analyses', title: 'Saved Analyses' }),
  };
}

// restoreTab 의 switch 에도 'saved-analyses' 분기 추가
```

### §5.3 `components/layout/top-bar.tsx`

`onSavedAnalysesClick: () => void` prop 추가. Stock Analysis 버튼 옆에 새 버튼:

```tsx
import { Archive } from 'lucide-react';

<Button
  variant="ghost"
  size="sm"
  onClick={onSavedAnalysesClick}
  className={navButtonClass}
  aria-label="Open Saved Analyses"
  title="Saved Analyses (저장 분석)"
>
  <Archive size={16} />
  <span className="hidden 2xl:inline">{t('savedAnalyses', language)}</span>
</Button>
```

순서: `Workflow → Data Sandbox → Stock Analysis → **Saved Analyses** → Settings`.

### §5.4 `components/Layout.tsx`

```ts
const handleSavedAnalysesClick = () => {
  const tabData = TabService.createSavedAnalysesTab();
  openTab(tabData);
};

// TopBar 에 prop 전달
<TopBar ... onSavedAnalysesClick={handleSavedAnalysesClick} />
```

### §5.5 `components/tabs/tab-bar.tsx`

```ts
// getTabIcon switch
case 'saved-analyses':
  return <Archive size={13} />;

// getTabTitle
if (tab.type === 'saved-analyses') return t('savedAnalyses', language);
```

---

## §6. SavedAnalysesTab 컴포넌트

### §6.1 파일 위치 / 트리

```
app/frontend/src/components/tabs/saved-analyses-tab.tsx     [신규, 메인 진입점]

app/frontend/src/components/saved-analyses/                  [신규 폴더]
├── saved-list-panel.tsx          [좌측 리스트 + 필터바 + 페이지네이션]
├── saved-list-row.tsx            [리스트 1 행 (티커, 소스, 일자, 액션 버튼)]
├── saved-filters-bar.tsx         [source_tab + ticker + 기간 필터]
├── saved-detail-panel.tsx        [우측 디테일 컨테이너 (source_tab 분기)]
├── saved-stock-detail.tsx        [source_tab='stock_analysis' 렌더]
├── saved-sandbox-detail.tsx      [source_tab='data_sandbox' 렌더]
├── saved-empty-state.tsx         [디테일 패널 비어 있을 때 안내]
└── helpers.ts                    [export 헬퍼들 (포맷팅, 파일 다운로드 등)]
```

### §6.2 `SavedAnalysesTab` 최상위

```tsx
export function SavedAnalysesTab() {
  const { language } = useLanguage();
  const [filter, setFilter] = useState<SavedAnalysisFilter>({ limit: 25, skip: 0 });
  const [items, setItems] = useState<SavedAnalysis[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SavedAnalysis | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { items, total } = await savedAnalysisService.listAnalyses(filter);
      setItems(items);
      setTotal(total);
      // 첫 행 자동 선택 (선택된 게 결과에 없으면)
      if (items.length > 0 && (selectedId === null || !items.some(i => i.id === selectedId))) {
        setSelectedId(items[0].id);
      } else if (items.length === 0) {
        setSelectedId(null);
        setSelectedDetail(null);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [filter, selectedId]);

  useEffect(() => { refresh(); }, [filter]);

  // selectedId 가 바뀌면 디테일 fetch
  useEffect(() => {
    if (selectedId === null) { setSelectedDetail(null); return; }
    let cancelled = false;
    savedAnalysisService.getAnalysisById(selectedId).then(d => {
      if (!cancelled) setSelectedDetail(d);
    }).catch(e => { if (!cancelled) setErrorMsg(e.message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <SavedListPanel
        items={items}
        total={total}
        filter={filter}
        loading={loading}
        errorMsg={errorMsg}
        selectedId={selectedId}
        onFilterChange={setFilter}
        onSelect={setSelectedId}
        onAfterDelete={refresh}
        language={language}
      />
      <SavedDetailPanel
        detail={selectedDetail}
        language={language}
        onRestoreSuccess={() => { /* 탭 전환은 helper 가 처리 */ }}
      />
    </div>
  );
}
```

### §6.3 SavedListPanel

좌측 360px 폭, vertical layout:

```
┌──────────────────────────────┐
│ 저장 분석                     │
│ {total}건 · {limit}/{skip}    │
├──────────────────────────────┤
│ [필터바]                      │
│  소스: 전체 ▾                  │
│  티커: [____]                 │
│  기간: [from] - [to]          │
├──────────────────────────────┤
│ ▶ MU       stock 2026-05-13  │
│   AAPL     sandbox 2026-05-12│
│   ...                         │
├──────────────────────────────┤
│  ← Prev  Page 1/X  Next →     │
└──────────────────────────────┘
```

#### Props

```tsx
interface SavedListPanelProps {
  items: SavedAnalysis[];
  total: number;
  filter: SavedAnalysisFilter;
  loading: boolean;
  errorMsg: string | null;
  selectedId: number | null;
  onFilterChange: (f: SavedAnalysisFilter) => void;
  onSelect: (id: number) => void;
  onAfterDelete: () => void;
  language: ReportLanguage;
}
```

#### 컨테이너

```tsx
<aside className="flex w-[360px] flex-shrink-0 flex-col border-r bg-muted/10">
  <header className="border-b p-3">
    <h2 className="text-sm font-semibold">{t('savedAnalyses', language)}</h2>
    <p className="mt-0.5 text-[11px] text-muted-foreground">
      {t('savedAnalysesSummary', language).replace('{total}', String(total))}
    </p>
  </header>
  <SavedFiltersBar value={filter} onChange={onFilterChange} language={language} />
  <div className="flex-1 overflow-y-auto">
    {loading && <div className="p-4 text-xs text-muted-foreground">{t('loading', language)}</div>}
    {errorMsg && <div className="p-4 text-xs text-red-500">{errorMsg}</div>}
    {!loading && items.length === 0 && (
      <div className="p-6 text-center text-xs text-muted-foreground">
        {t('savedAnalysesEmpty', language)}
      </div>
    )}
    <ul className="divide-y divide-border/40">
      {items.map(item => (
        <SavedListRow
          key={item.id}
          item={item}
          isSelected={item.id === selectedId}
          onClick={() => onSelect(item.id)}
          onAfterDelete={onAfterDelete}
          language={language}
        />
      ))}
    </ul>
  </div>
  <footer className="border-t p-2 flex items-center justify-between text-xs">
    <Button variant="ghost" size="sm" disabled={(filter.skip ?? 0) === 0}
      onClick={() => onFilterChange({ ...filter, skip: Math.max(0, (filter.skip ?? 0) - (filter.limit ?? 25)) })}>
      ← {t('prev', language)}
    </Button>
    <span className="text-muted-foreground">{currentPage}/{totalPages}</span>
    <Button variant="ghost" size="sm"
      disabled={(filter.skip ?? 0) + (filter.limit ?? 25) >= total}
      onClick={() => onFilterChange({ ...filter, skip: (filter.skip ?? 0) + (filter.limit ?? 25) })}>
      {t('next', language)} →
    </Button>
  </footer>
</aside>
```

### §6.4 SavedListRow

```tsx
interface SavedListRowProps {
  item: SavedAnalysis;
  isSelected: boolean;
  onClick: () => void;
  onAfterDelete: () => void;
  language: ReportLanguage;
}
```

렌더:

```tsx
<li
  className={cn(
    'group flex cursor-pointer flex-col gap-1 px-3 py-2.5 hover:bg-muted/30',
    isSelected && 'bg-primary/10 border-l-2 border-primary',
  )}
  onClick={onClick}
>
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="font-mono text-sm font-semibold text-primary truncate">{item.ticker}</span>
      <Badge variant="outline" className={sourceTabBadgeClass(item.source_tab)}>
        {sourceTabLabel(item.source_tab, language)}
      </Badge>
    </div>
    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
      {formatDateShort(item.created_at, language)}
    </span>
  </div>
  <div className="flex items-center justify-between">
    <span className="text-[10px] text-muted-foreground">
      {agentCountSummary(item, language)}  {/* e.g., "에이전트 5명" */}
    </span>
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <IconButton
        title={t('restoreToTab', language)}
        onClick={(e) => { e.stopPropagation(); handleRestore(item); }}
      >
        <ExternalLink size={12} />
      </IconButton>
      <IconButton
        title={t('exportJson', language)}
        onClick={(e) => { e.stopPropagation(); downloadJson(item); }}
      >
        <Download size={12} />
      </IconButton>
      <IconButton
        title={t('delete', language)}
        onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
        className="text-red-500"
      >
        <Trash2 size={12} />
      </IconButton>
    </div>
  </div>
</li>
```

`IconButton` 은 row 안에서만 쓰는 inline component, h-6 w-6 ghost button.

#### `handleRestore(item)` — 다시 열기

```ts
const { workspace, patchWorkspace } = useWorkspace();
const { openTab } = useTabsContext();

function handleRestore(item: SavedAnalysis) {
  const req = item.request_data || {};
  if (item.source_tab === 'stock_analysis') {
    patchWorkspace({
      tickers: req.ticker ?? req.input_ticker ?? item.ticker,
      startDate: req.start_date ?? workspace.startDate,
      endDate: req.end_date ?? workspace.endDate,
      selectedAgents: new Set(req.selected_agent_keys ?? []),
      selectedModel: req.selected_model ?? workspace.selectedModel,
      useDataSandboxOverrides: Boolean(req.use_data_sandbox_overrides),
    });
    openTab(TabService.createStockSearchTab());
    // 분석은 사용자가 직접 실행 (auto-run 안 함, 비용 보호)
  } else {
    // data_sandbox
    patchWorkspace({
      tickers: req.ticker ?? item.ticker,
      startDate: req.start_date ?? workspace.startDate,
      endDate: req.end_date ?? workspace.endDate,
    });
    openTab(TabService.createDataSandboxTab());
  }
}
```

**중요**: 자동 재실행 X. 사용자가 새 탭에서 "분석 실행" 을 다시 눌러야 한다.
저장된 데이터는 디테일 패널에서 그대로 볼 수 있으므로, 재실행은 명시적 사용자
의사로만.

#### `handleDelete(item)`

```ts
async function handleDelete(item: SavedAnalysis) {
  if (!confirm(t('confirmDelete', language).replace('{ticker}', item.ticker))) return;
  try {
    await savedAnalysisService.deleteAnalysis(item.id);
    onAfterDelete();  // 부모가 refresh
  } catch (e: any) {
    alert(e.message || 'delete failed');
  }
}
```

#### `downloadJson(item)` (helpers.ts)

```ts
export function downloadJson(item: SavedAnalysis) {
  const data = JSON.stringify(item, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.ticker}-${item.source_tab}-${item.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

### §6.5 SavedFiltersBar

3 필터 가로로:

```tsx
<div className="grid grid-cols-1 gap-2 border-b p-3 text-xs">
  {/* Source tab */}
  <div>
    <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
      {t('filterSource', language)}
    </label>
    <select
      value={value.source_tab ?? ''}
      onChange={e => onChange({ ...value, source_tab: e.target.value || undefined, skip: 0 })}
      className="w-full rounded border bg-background px-2 py-1"
    >
      <option value="">{t('filterSourceAll', language)}</option>
      <option value="stock_analysis">{t('filterSourceStock', language)}</option>
      <option value="data_sandbox">{t('filterSourceSandbox', language)}</option>
    </select>
  </div>
  {/* Ticker */}
  <div>
    <label className="mb-1 block text-[10px] uppercase text-muted-foreground">{t('filterTicker', language)}</label>
    <Input
      value={value.ticker ?? ''}
      onChange={e => onChange({ ...value, ticker: e.target.value || undefined, skip: 0 })}
      placeholder="AAPL"
      className="h-7 text-xs"
    />
  </div>
  {/* 기간 */}
  <div className="grid grid-cols-2 gap-2">
    <div>
      <label className="mb-1 block text-[10px] uppercase text-muted-foreground">{t('filterFrom', language)}</label>
      <Input type="date" value={value.created_from ?? ''}
        onChange={e => onChange({ ...value, created_from: e.target.value || undefined, skip: 0 })}
        className="h-7 text-xs" />
    </div>
    <div>
      <label className="mb-1 block text-[10px] uppercase text-muted-foreground">{t('filterTo', language)}</label>
      <Input type="date" value={value.created_to ?? ''}
        onChange={e => onChange({ ...value, created_to: e.target.value || undefined, skip: 0 })}
        className="h-7 text-xs" />
    </div>
  </div>
</div>
```

ticker 입력은 **debounce 300ms** — 매 키 입력마다 fetch 하지 않게.

```ts
const [tickerDraft, setTickerDraft] = useState(value.ticker ?? '');
useEffect(() => {
  const id = setTimeout(() => {
    if (tickerDraft !== (value.ticker ?? '')) {
      onChange({ ...value, ticker: tickerDraft || undefined, skip: 0 });
    }
  }, 300);
  return () => clearTimeout(id);
}, [tickerDraft]);
```

### §6.6 SavedDetailPanel — source_tab 분기

```tsx
export function SavedDetailPanel({ detail, language }: Props) {
  if (!detail) return <SavedEmptyState language={language} />;
  if (detail.source_tab === 'stock_analysis') {
    return <SavedStockDetail detail={detail} language={language} />;
  }
  if (detail.source_tab === 'data_sandbox') {
    return <SavedSandboxDetail detail={detail} language={language} />;
  }
  return <SavedEmptyState language={language} />;
}
```

컨테이너:

```tsx
<main className="flex flex-1 flex-col overflow-hidden">
  <header className="flex items-center justify-between border-b px-4 py-3">
    <div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-base font-semibold text-primary">{detail.ticker}</span>
        <Badge variant="outline" className={sourceTabBadgeClass(detail.source_tab)}>
          {sourceTabLabel(detail.source_tab, language)}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {detail.language.toUpperCase()}
        </Badge>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {t('savedAt', language)} · {formatDateLong(detail.created_at, language)}
      </p>
    </div>
    <div className="flex gap-1.5">
      <Button variant="outline" size="sm" onClick={() => downloadJson(detail)}>
        <Download className="mr-1 h-3.5 w-3.5" />{t('exportJson', language)}
      </Button>
      <Button variant="outline" size="sm" onClick={() => handleRestore(detail)}>
        <ExternalLink className="mr-1 h-3.5 w-3.5" />{t('restoreToTab', language)}
      </Button>
    </div>
  </header>
  <div className="flex-1 overflow-y-auto p-4">
    {/* source_tab 별 body */}
  </div>
</main>
```

### §6.7 SavedStockDetail — Stock Analysis 결과 렌더

`result_data` 의 형태 (stock-search-tab.tsx 의 saveAnalysis 호출 확인):

```js
{
  agent_results: AgentResult[],
  complete_result: { decisions, analyst_signals, reasoning }
}
```

이를 v5 `AnalystReportDashboard` 가 요구하는 형태로 어댑트:

```tsx
import { AnalystReportDashboard } from '@/components/reports/analyst-report-dashboard';

export function SavedStockDetail({ detail, language }: Props) {
  const result = detail.result_data ?? {};
  const completeResult = result.complete_result ?? null;
  const agentResultsArr: AgentResult[] = result.agent_results ?? [];
  const agentResultsMap = useMemo(
    () => new Map(agentResultsArr.map(r => [r.agentKey, r])),
    [agentResultsArr],
  );
  const ticker = detail.ticker;

  if (!completeResult || !completeResult.decisions) {
    return <NoDecisionsNote language={language} />;
  }

  // composite score 계산은 stock-search-tab 의 함수와 동일 — 헬퍼로 import
  const compositeScore = calculateCompositeScoreForSaved(
    completeResult.analyst_signals,
    ticker,
    completeResult.decisions[ticker],
  );

  return (
    <AnalystReportDashboard
      ticker={ticker}
      completeResult={completeResult}
      agentResults={agentResultsMap}
      language={language}
      compositeScore={compositeScore}
      onSave={undefined}        // 이미 저장된 항목, 재저장 안 함
      isSaving={false}
    />
  );
}
```

`calculateCompositeScoreForSaved` 는 stock-search-tab 의 `calculateCompositeScore`
와 동일 로직. 두 군데에서 쓰이므로 helpers.ts 로 추출하거나
stock-search-tab.tsx 에서 `export` 추가.

→ **결정**: `stock-search-tab.tsx` 의 `calculateCompositeScore`,
`scoreSignal`, `scoreDecision`, `getTickerAnalystReports` 를 `export` 한다.
v5 helpers.ts 가 이미 비슷한 함수를 가지지만 컨벤션 일치를 위해 stock-search
의 것을 재사용.

### §6.8 SavedSandboxDetail — Data Sandbox 스냅샷 렌더

`data-sandbox-tab.tsx` 의 save 호출에서 보낸 `result_data` 가 무엇인지 먼저
확인 후 작성. 일반적으로 다음 구조 추정:

```js
result_data = {
  metrics: {...},
  forward_metrics: ForwardMetrics | null,
  overrides: {...},
  prices?: [...],
  line_items?: [...],
}
```

읽기 전용 카드 그리드로 표시:

```tsx
<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
  {/* Forward metrics card */}
  {result_data.forward_metrics && (
    <Card>
      <CardHeader><CardTitle>Forward Metrics</CardTitle></CardHeader>
      <CardContent>
        <KeyValueTable data={result_data.forward_metrics} />
      </CardContent>
    </Card>
  )}
  {/* Snapshot metrics */}
  {result_data.metrics && (
    <Card>
      <CardHeader><CardTitle>Metrics</CardTitle></CardHeader>
      <CardContent>
        <KeyValueTable data={result_data.metrics} />
      </CardContent>
    </Card>
  )}
  {/* Override list */}
  {result_data.overrides && Object.keys(result_data.overrides).length > 0 && (
    <Card>
      <CardHeader><CardTitle>Overrides</CardTitle></CardHeader>
      <CardContent>
        <KeyValueTable data={result_data.overrides} />
      </CardContent>
    </Card>
  )}
  {/* Request snapshot */}
  <Card className="lg:col-span-2">
    <CardHeader><CardTitle>Request</CardTitle></CardHeader>
    <CardContent>
      <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] font-mono">
        {JSON.stringify(detail.request_data, null, 2)}
      </pre>
    </CardContent>
  </Card>
</div>
```

`<KeyValueTable data={obj}>` 는 helpers 에 정의:

```tsx
function KeyValueTable({ data }: { data: Record<string, any> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {Object.entries(data).filter(([_, v]) => v !== null && v !== undefined).map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-foreground">{formatValue(v)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
```

`formatValue(v)`: number → `toLocaleString()`, boolean → `'yes'/'no'`, object →
`JSON.stringify(v).slice(0, 80)`, string → 그대로.

### §6.9 SavedEmptyState

```tsx
<div className="flex flex-1 items-center justify-center text-center">
  <div className="space-y-2">
    <Archive className="mx-auto h-10 w-10 text-muted-foreground/40" />
    <p className="text-sm text-muted-foreground">
      {t('savedDetailEmpty', language)}
    </p>
  </div>
</div>
```

---

## §7. helpers.ts (saved-analyses 폴더)

```ts
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';

// 날짜
export function formatDateShort(iso: string, language: ReportLanguage): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return language === 'ko'
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateLong(iso: string, language: ReportLanguage): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return language === 'ko'
    ? `${formatDateShort(iso, 'ko')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    : d.toLocaleString('en-US');
}

// Source tab 라벨 / 색
export function sourceTabLabel(source: string, language: ReportLanguage): string {
  if (source === 'stock_analysis') return language === 'ko' ? '종목 분석' : 'Stock Analysis';
  if (source === 'data_sandbox')   return language === 'ko' ? '데이터 샌드박스' : 'Data Sandbox';
  return source;
}

export function sourceTabBadgeClass(source: string): string {
  if (source === 'stock_analysis') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
  if (source === 'data_sandbox')   return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300';
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-500';
}

// agent 개수 요약
export function agentCountSummary(item: SavedAnalysis, language: ReportLanguage): string {
  if (item.source_tab === 'stock_analysis') {
    const n = item.result_data?.agent_results?.length ?? item.request_data?.selected_agent_keys?.length ?? 0;
    return language === 'ko' ? `에이전트 ${n}명` : `${n} agents`;
  }
  // data_sandbox
  const fields = Object.keys(item.result_data?.metrics ?? {}).length;
  return language === 'ko' ? `필드 ${fields}개` : `${fields} fields`;
}

// JSON 다운로드
export function downloadJson(item: SavedAnalysis): void { /* §6.4 의 코드 */ }
```

---

## §8. i18n 키 (ko + en)

`app/frontend/src/lib/language-preferences.ts` 에 추가:

```ts
// Saved Analyses Browser
savedAnalyses: '저장 분석' / 'Saved Analyses',
savedAnalysesSummary: '{total}건 저장됨' / '{total} saved',
savedAnalysesEmpty: '저장된 분석이 없습니다.' / 'No saved analyses.',
savedDetailEmpty: '왼쪽에서 항목을 선택하세요.' / 'Select an item from the list.',
savedAt: '저장 시각' / 'Saved at',
restoreToTab: '다시 열기' / 'Restore',
exportJson: 'JSON 내보내기' / 'Export JSON',
delete: '삭제' / 'Delete',
confirmDelete: '{ticker} 저장을 삭제하시겠습니까?' / 'Delete saved analysis for {ticker}?',
prev: '이전' / 'Prev',
next: '다음' / 'Next',
loading: '불러오는 중...' / 'Loading...',
filterSource: '소스' / 'Source',
filterSourceAll: '전체' / 'All',
filterSourceStock: '종목 분석' / 'Stock Analysis',
filterSourceSandbox: '데이터 샌드박스' / 'Data Sandbox',
filterTicker: '티커' / 'Ticker',
filterFrom: '시작일' / 'From',
filterTo: '종료일' / 'To',
savedRequestSnapshot: '요청 스냅샷' / 'Request snapshot',
savedNoDecisions: '저장된 결과에 결정 데이터가 없습니다.' / 'Saved result has no decisions data.',
```

---

## §9. stock-search-tab.tsx 변경 (소폭)

`calculateCompositeScore`, `scoreSignal`, `scoreDecision`,
`getTickerAnalystReports` 함수에 `export` 키워드 추가. 다른 변경 없음.

테스트 회귀 영향: 기존 `test_stock_search_final_decision_ui_static.py` 의
`function calculateCompositeScore` 검사는 그대로 통과 (`export function
calculateCompositeScore` 도 substring 매치).

---

## §10. 색상 / 사이즈 토큰

| 항목 | 클래스 |
|---|---|
| 좌측 패널 | `w-[360px] flex-shrink-0 border-r bg-muted/10` |
| 우측 패널 | `flex-1 overflow-y-auto` |
| 리스트 row 선택 | `bg-primary/10 border-l-2 border-primary` |
| 리스트 row hover | `hover:bg-muted/30` |
| Action icon button | `h-6 w-6 p-0 text-muted-foreground hover:text-primary` |
| Source badge stock | `emerald` 톤 (§7) |
| Source badge sandbox | `blue` 톤 (§7) |
| Filter bar | `border-b p-3` |
| Pagination footer | `border-t p-2` |
| Detail header | `border-b px-4 py-3` |

---

## §11. 접근성

| 요소 | 속성 |
|---|---|
| 리스트 row | `role="button"`, `tabIndex={0}`, keyboard Enter / Space 선택 |
| 선택된 row | `aria-current="true"` |
| Delete 버튼 | `aria-label={t('delete', language) + ' ' + item.ticker}` |
| 필터 select | `<label htmlFor>` 연결 |
| 페이지네이션 | `aria-label="page navigation"` |
| Empty state | `role="status"` |

---

## §12. 빈 데이터 / fallback

| 시나리오 | 동작 |
|---|---|
| 리스트 0 건 (필터 결과 없음) | "저장된 분석이 없습니다" 메시지 |
| 리스트 fetch 실패 | 빨간 에러 박스, retry 버튼 (`onClick={refresh}`) |
| 디테일 fetch 실패 | 빈 상태로 fallback + toast |
| `result_data.complete_result` 없음 | "결정 데이터가 없습니다" 안내 + JSON dump |
| `request_data` 없음 | "다시 열기" 버튼 disabled |
| ticker 필터 결과 0 건 | filter bar 그대로 + 빈 리스트 메시지 |

---

## §13. 테스트 계획

### §13.1 신규 static — `tests/test_saved_analyses_browser_static.py`

```python
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
TAB = ROOT / "app/frontend/src/components/tabs/saved-analyses-tab.tsx"
DIR = ROOT / "app/frontend/src/components/saved-analyses"
SERVICE = ROOT / "app/frontend/src/services/saved-analyses-service.ts"
TABS_CTX = ROOT / "app/frontend/src/contexts/tabs-context.tsx"
TAB_SERVICE = ROOT / "app/frontend/src/services/tab-service.ts"
TOP_BAR = ROOT / "app/frontend/src/components/layout/top-bar.tsx"
LAYOUT = ROOT / "app/frontend/src/components/Layout.tsx"
TAB_BAR = ROOT / "app/frontend/src/components/tabs/tab-bar.tsx"
LANG = ROOT / "app/frontend/src/lib/language-preferences.ts"
BACKEND_ROUTE = ROOT / "app/backend/routes/saved_analyses.py"
BACKEND_REPO  = ROOT / "app/backend/repositories/saved_analysis_repository.py"


class SavedAnalysesBrowserStaticTests(unittest.TestCase):
    def test_new_tab_component_exists(self):
        self.assertTrue(TAB.exists())
        for fname in ['saved-list-panel.tsx', 'saved-list-row.tsx',
                      'saved-filters-bar.tsx', 'saved-detail-panel.tsx',
                      'saved-stock-detail.tsx', 'saved-sandbox-detail.tsx',
                      'saved-empty-state.tsx', 'helpers.ts']:
            self.assertTrue((DIR / fname).exists(), fname)

    def test_tab_type_extended(self):
        src = TABS_CTX.read_text(encoding='utf-8')
        self.assertIn("'saved-analyses'", src)

    def test_tab_service_has_saved_analyses(self):
        src = TAB_SERVICE.read_text(encoding='utf-8')
        self.assertIn("createSavedAnalysesTab", src)
        self.assertIn("SavedAnalysesTab", src)

    def test_top_bar_has_saved_analyses_button(self):
        src = TOP_BAR.read_text(encoding='utf-8')
        self.assertIn("onSavedAnalysesClick", src)
        self.assertIn("Archive", src)

    def test_layout_wires_saved_analyses_handler(self):
        src = LAYOUT.read_text(encoding='utf-8')
        self.assertIn("handleSavedAnalysesClick", src)
        self.assertIn("createSavedAnalysesTab", src)

    def test_tab_bar_icon_and_title(self):
        src = TAB_BAR.read_text(encoding='utf-8')
        self.assertIn("'saved-analyses'", src)
        self.assertIn("savedAnalyses", src)

    def test_service_has_filter_and_delete(self):
        src = SERVICE.read_text(encoding='utf-8')
        self.assertIn("listAnalyses", src)
        self.assertIn("deleteAnalysis", src)
        self.assertIn("source_tab", src)
        self.assertIn("created_from", src)

    def test_i18n_keys_added(self):
        src = LANG.read_text(encoding='utf-8')
        for key in ['savedAnalyses', 'savedAnalysesEmpty', 'restoreToTab',
                    'exportJson', 'filterSource', 'filterSourceStock',
                    'filterSourceSandbox', 'filterTicker', 'filterFrom',
                    'filterTo', 'confirmDelete', 'savedDetailEmpty']:
            self.assertIn(f"{key}:", src, key)

    def test_backend_delete_endpoint(self):
        src = BACKEND_ROUTE.read_text(encoding='utf-8')
        self.assertIn('@router.delete', src)
        self.assertIn('delete_saved_analysis', src)

    def test_backend_filter_query_params(self):
        src = BACKEND_ROUTE.read_text(encoding='utf-8')
        self.assertIn('source_tab: Optional[str]', src)
        self.assertIn('ticker: Optional[str]', src)
        self.assertIn('created_from', src)
        self.assertIn('created_to', src)
        self.assertIn('X-Total-Count', src)

    def test_repository_has_delete_and_count(self):
        src = BACKEND_REPO.read_text(encoding='utf-8')
        self.assertIn('def delete', src)
        self.assertIn('def count', src)
```

### §13.2 백엔드 unit — `tests/test_saved_analyses_repository.py`

```python
def test_delete_removes_row(db_session):
    repo = SavedAnalysisRepository(db_session)
    item = repo.create(source_tab='stock_analysis', ticker='MU', language='ko')
    repo.delete(item.id)
    assert repo.get_by_id(item.id) is None

def test_filter_by_source_tab(db_session):
    repo = SavedAnalysisRepository(db_session)
    repo.create(source_tab='stock_analysis', ticker='AAPL', language='ko')
    repo.create(source_tab='data_sandbox',  ticker='AAPL', language='ko')
    items = repo.get_all(source_tab='stock_analysis')
    assert len(items) == 1
    assert items[0].source_tab == 'stock_analysis'

def test_filter_by_ticker_case_insensitive(db_session):
    repo = SavedAnalysisRepository(db_session)
    repo.create(source_tab='stock_analysis', ticker='AAPL', language='ko')
    items = repo.get_all(ticker='aap')
    assert len(items) == 1
```

`db_session` 픽스쳐: 기존 test conftest 확인 후 sqlite memory 로 작성.
이미 backend test 가 있으면 그 패턴 따라가기.

### §13.3 기존 테스트 회귀

- `test_stock_search_final_decision_ui_static.py::test_final_decision_uses_composite_score_and_status_label`
  : `function calculateCompositeScore` substring 검사 → `export function
  calculateCompositeScore` 도 매치 → **통과**.
- `test_topbar_polish_static.py` : Saved Analyses 버튼 추가하면서 TopBar 의 nav
  순서가 바뀐다. 기존 검사는 button 존재만 보므로 영향 없음. 단, 새 button 의
  검증이 §13.1 에 추가됨.
- 다른 v5 / dashboard 테스트는 영향 없음.

### §13.4 빌드 / 타입 / 린트

- `pytest tests/ --ignore=tests/backtesting -q` → all green.
- `tsc --noEmit` → 0 errors.
- `vite build` → succeeds.

---

## §14. 구현 순서

1. **백엔드**:
   - `app/backend/repositories/saved_analysis_repository.py` — `delete`,
     `count`, `get_all` 시그니처 확장.
   - `app/backend/routes/saved_analyses.py` — DELETE 엔드포인트 추가, GET 필터
     query param, `X-Total-Count` 헤더.
2. **프론트엔드 서비스**:
   - `app/frontend/src/services/saved-analyses-service.ts` — `listAnalyses`,
     `deleteAnalysis` 추가. `getAllAnalyses` 호환 유지.
3. **i18n**:
   - `app/frontend/src/lib/language-preferences.ts` — §8 키 ko/en 양쪽.
4. **stock-search-tab.tsx** — `calculateCompositeScore` 등 4 함수에 export 추가.
5. **saved-analyses 폴더 신규 컴포넌트들** (§6.1 트리 순서대로):
   - `helpers.ts`
   - `saved-empty-state.tsx`
   - `saved-filters-bar.tsx`
   - `saved-list-row.tsx`
   - `saved-list-panel.tsx`
   - `saved-stock-detail.tsx`
   - `saved-sandbox-detail.tsx`
   - `saved-detail-panel.tsx`
6. **`saved-analyses-tab.tsx`** — 최상위 컴포넌트.
7. **탭 시스템 등록**:
   - `tabs-context.tsx` — TabType 확장 + generateTabId.
   - `tab-service.ts` — import + createSavedAnalysesTab + switch 분기.
   - `tab-bar.tsx` — icon + title 매핑.
   - `top-bar.tsx` — `onSavedAnalysesClick` prop + Archive 버튼.
   - `Layout.tsx` — `handleSavedAnalysesClick` + TopBar 에 prop 전달.
8. **테스트 추가/회귀**.
9. `tsc --noEmit`, `vite build`, `pytest` 모두 clean.

---

## §15. 커밋 / 푸시 / 배포

### §15.1 단일 커밋

```
feat(saved-analyses): add saved analyses browser tab (list + detail + filter + delete)

Add a new "Saved Analyses" tab so users can browse, re-open, export, and
delete the records produced by the "Save to DB" button in Stock Analysis
and Data Sandbox tabs. Backend gains DELETE /saved-analyses/{id} plus
ticker/source_tab/date-range filters and X-Total-Count header on GET.
Frontend adds a 2-column saved-analyses tab (filter list on the left,
detail view on the right) reusing the v5 AnalystReportDashboard for
stock_analysis records and a read-only key-value grid for data_sandbox
snapshots. New tab type 'saved-analyses' is wired into TabService,
TabBar, TopBar (Archive icon), and Layout.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### §15.2 stage 대상

```
app/backend/repositories/saved_analysis_repository.py
app/backend/routes/saved_analyses.py
app/frontend/src/services/saved-analyses-service.ts
app/frontend/src/lib/language-preferences.ts
app/frontend/src/components/tabs/saved-analyses-tab.tsx
app/frontend/src/components/saved-analyses/*.tsx
app/frontend/src/components/saved-analyses/*.ts
app/frontend/src/contexts/tabs-context.tsx
app/frontend/src/services/tab-service.ts
app/frontend/src/components/layout/top-bar.tsx
app/frontend/src/components/Layout.tsx
app/frontend/src/components/tabs/tab-bar.tsx
app/frontend/src/components/tabs/stock-search-tab.tsx
tests/test_saved_analyses_browser_static.py
tests/test_saved_analyses_repository.py
```

`docs/`, `tmp/`, `claude.md`, `agents.md`, 다른 dirty 파일은 stage 하지 마라.

### §15.3 푸시

```bash
git push origin main
git fetch origin
git rev-list --left-right --count origin/main...HEAD   # → 0  0
```

### §15.4 배포

```bash
./deploy_aws.sh
```

```bash
curl -I --max-time 10 http://54.116.99.19/hedge/   # → 200
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  'cd /home/bitnami/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
```

---

## §16. 수용 기준 (체크리스트)

- [ ] 상단 nav 에 "저장 분석" (Archive 아이콘) 버튼이 있다.
- [ ] 버튼 클릭 시 `'saved-analyses'` 탭이 열린다.
- [ ] 좌측 패널에 저장 항목 리스트가 created_at desc 로 표시된다.
- [ ] 필터바: source_tab select / ticker input / created_from / created_to 4 개
      모두 동작한다.
- [ ] ticker 입력은 debounce 300ms 후 fetch 한다.
- [ ] 페이지네이션 Prev / Next 가 동작하고 limit/skip 이 query 에 반영된다.
- [ ] 각 row 의 hover 시 Restore / Export / Delete 아이콘 버튼이 나타난다.
- [ ] Delete 클릭 시 confirm → DELETE 호출 → 리스트 자동 새로고침.
- [ ] Export 클릭 시 `{ticker}-{source}-{id}.json` 파일이 다운로드된다.
- [ ] Restore 클릭 시 워크스페이스에 request_data 가 주입되고, 해당 원본 탭이
      열린다. **자동 재실행은 안 한다**.
- [ ] 우측 패널: row 선택 시 디테일이 표시된다.
- [ ] `stock_analysis` 디테일은 v5 AnalystReportDashboard 로 정상 렌더된다.
- [ ] `data_sandbox` 디테일은 key-value 그리드로 정상 렌더된다.
- [ ] ko/en 토글이 모두 정상 동작 (라벨, 날짜 포맷, badge 텍스트).
- [ ] 백엔드: DELETE 가 정상 동작, GET 가 source_tab/ticker/date 필터를 반영,
      `X-Total-Count` 헤더가 응답에 있음.
- [ ] `pytest tests/ --ignore=tests/backtesting -q` 통과.
- [ ] `tsc --noEmit` 0 errors.
- [ ] `vite build` 성공.
- [ ] `git rev-list --left-right --count origin/main...HEAD` → `0  0`.
- [ ] `curl -I http://54.116.99.19/hedge/` → 200.

---

## §17. 위험 / 미해결

1. **`X-Total-Count` 헤더 CORS** — 프로덕션 환경에서 헤더가 노출되도록
   FastAPI CORS 설정에 `expose_headers=["X-Total-Count"]` 가 들어 있어야 한다.
   `app/backend/main.py` 의 CORSMiddleware 설정을 확인. 없으면 추가.
2. **저장된 result_data 가 v5 가 가정하는 형식과 불일치할 가능성** — 옛 저장
   레코드일수록 위험. SavedStockDetail 안에서 try/catch + "결과 데이터 손상"
   메시지로 fallback.
3. **Restore 시 selectedAgents 가 비어 있을 수 있음** — request_data 가 옛
   포맷이면 빈 Set 으로 떨어짐. 사용자가 다시 선택해야 함 — 정상 동작으로
   수용.
4. **삭제 가역성** — confirm 만으로 hard delete. soft-delete 옵션은 Phase 2.
5. **대용량 result_data** — 한 row 가 수 MB 인 경우 디테일 fetch 가 느릴 수
   있음. 이번 라운드는 그대로 두고 추후 lazy-load.
6. **localStorage 누락** — 탭 복원 시 `saved-analyses` 탭이 localStorage 에서
   복원되려면 TabService.restoreTab 의 case 가 있어야 한다 (§5.2 에 포함).
