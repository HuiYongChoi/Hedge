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
}: SavedListPanelProps) {
  const limit = filter.limit ?? 25;
  const skip = filter.skip ?? 0;
  const currentPage = Math.floor(skip / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <aside className="flex w-[360px] flex-shrink-0 flex-col border-r bg-muted/10">
      <header className="border-b p-3">
        <h2 className="text-sm font-semibold">{t('savedAnalyses', language)}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t('savedAnalysesSummary', language).replace('{total}', String(total))}
        </p>
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
