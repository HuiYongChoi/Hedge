import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/language-preferences';
import type { SavedAnalysisFilter } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';

interface SavedFiltersBarProps {
  value: SavedAnalysisFilter;
  onChange: (f: SavedAnalysisFilter) => void;
  language: ReportLanguage;
}

export function SavedFiltersBar({ value, onChange, language }: SavedFiltersBarProps) {
  const [tickerDraft, setTickerDraft] = useState(value.ticker ?? '');

  useEffect(() => {
    const id = setTimeout(() => {
      if (tickerDraft !== (value.ticker ?? '')) {
        onChange({ ...value, ticker: tickerDraft || undefined, skip: 0 });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [tickerDraft]);

  // Sync draft when filter resets externally
  useEffect(() => {
    setTickerDraft(value.ticker ?? '');
  }, [value.ticker]);

  return (
    <div className="grid grid-cols-1 gap-2 border-b p-3 text-xs">
      {/* Source tab */}
      <div>
        <label className="mb-1 block text-[10px] uppercase text-muted-foreground" htmlFor="sa-filter-source">
          {t('filterSource', language)}
        </label>
        <select
          id="sa-filter-source"
          value={value.source_tab ?? ''}
          onChange={e =>
            onChange({ ...value, source_tab: (e.target.value as SavedAnalysisFilter['source_tab']) || undefined, skip: 0 })
          }
          className="w-full rounded border bg-background px-2 py-1 text-xs"
        >
          <option value="">{t('filterSourceAll', language)}</option>
          <option value="stock_analysis">{t('filterSourceStock', language)}</option>
          <option value="data_sandbox">{t('filterSourceSandbox', language)}</option>
          <option value="stock_compare">{language === 'ko' ? '종목 비교' : 'Stock Compare'}</option>
        </select>
      </div>
      {/* Ticker */}
      <div>
        <label className="mb-1 block text-[10px] uppercase text-muted-foreground" htmlFor="sa-filter-ticker">
          {t('filterTicker', language)}
        </label>
        <Input
          id="sa-filter-ticker"
          value={tickerDraft}
          onChange={e => setTickerDraft(e.target.value)}
          placeholder="AAPL"
          className="h-7 text-xs"
        />
      </div>
      {/* Date range */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground" htmlFor="sa-filter-from">
            {t('filterFrom', language)}
          </label>
          <Input
            id="sa-filter-from"
            type="date"
            value={value.created_from ?? ''}
            onChange={e => onChange({ ...value, created_from: e.target.value || undefined, skip: 0 })}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground" htmlFor="sa-filter-to">
            {t('filterTo', language)}
          </label>
          <Input
            id="sa-filter-to"
            type="date"
            value={value.created_to ?? ''}
            onChange={e => onChange({ ...value, created_to: e.target.value || undefined, skip: 0 })}
            className="h-7 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
