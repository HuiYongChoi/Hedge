import { ChevronLeft, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/language-preferences';
import type { SavedAnalysis, SavedAnalysisFilter } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import { SavedFiltersBar } from './saved-filters-bar';
import { SavedListRow } from './saved-list-row';

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
  onRetry: () => void;
  language: ReportLanguage;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SavedListPanel({
  items,
  total,
  filter,
  loading,
  errorMsg,
  selectedId,
  onFilterChange,
  onSelect,
  onAfterDelete,
  onRetry,
  language,
  isCollapsed = false,
  onToggleCollapse,
}: SavedListPanelProps) {
  const limit = filter.limit ?? 25;
  const skip = filter.skip ?? 0;
  const currentPage = Math.floor(skip / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <aside
      className="flex flex-shrink-0 flex-col border-r bg-muted/10 transition-all duration-300 ease-in-out overflow-hidden"
      style={{ width: isCollapsed ? 0 : 360, opacity: isCollapsed ? 0 : 1 }}
      aria-hidden={isCollapsed}
    >
      <header className="border-b p-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold whitespace-nowrap">{t('savedAnalyses', language)}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
            {t('savedAnalysesSummary', language).replace('{total}', String(total))}
          </p>
        </div>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
            onClick={onToggleCollapse}
            title="패널 접기"
            aria-label="Close list panel"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <SavedFiltersBar value={filter} onChange={onFilterChange} language={language} />

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs text-muted-foreground">{t('loading', language)}</div>
        )}
        {!loading && errorMsg && (
          <div className="p-4 text-xs">
            <p className="text-red-500 mb-2">{errorMsg}</p>
            <Button variant="outline" size="sm" onClick={onRetry} className="text-xs h-7">
              Retry
            </Button>
          </div>
        )}
        {!loading && !errorMsg && items.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {t('savedAnalysesEmpty', language)}
          </div>
        )}
        <ul className="divide-y divide-border/40" aria-label={t('savedAnalyses', language)}>
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

      <footer className="border-t p-2 flex items-center justify-between text-xs" aria-label="page navigation">
        <Button
          variant="ghost"
          size="sm"
          disabled={skip === 0}
          onClick={() => onFilterChange({ ...filter, skip: Math.max(0, skip - limit) })}
          className="text-xs h-7"
        >
          ← {t('prev', language)}
        </Button>
        <span className="text-muted-foreground">{currentPage}/{totalPages}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={skip + limit >= total}
          onClick={() => onFilterChange({ ...filter, skip: skip + limit })}
          className="text-xs h-7"
        >
          {t('next', language)} →
        </Button>
      </footer>
    </aside>
  );
}
