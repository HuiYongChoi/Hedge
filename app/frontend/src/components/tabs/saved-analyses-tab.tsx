import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/language-context';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import type { SavedAnalysis, SavedAnalysisFilter } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import { SavedListPanel } from '@/components/saved-analyses/saved-list-panel';
import { SavedDetailPanel } from '@/components/saved-analyses/saved-detail-panel';

export function SavedAnalysesTab() {
  const { language } = useLanguage();
  const reportLanguage = language as ReportLanguage;

  const [filter, setFilter] = useState<SavedAnalysisFilter>({ limit: 25, skip: 0 });
  const [items, setItems] = useState<SavedAnalysis[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SavedAnalysis | null>(null);
  const [isListCollapsed, setIsListCollapsed] = useState(false);

  const handleSelect = (id: number) => {
    setSelectedId(id);
    // Auto-collapse left panel when item is selected
    setIsListCollapsed(true);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { items: fetched, total: count } = await savedAnalysisService.listAnalyses(filter);
      setItems(fetched);
      setTotal(count);
      if (fetched.length > 0 && (selectedId === null || !fetched.some(i => i.id === selectedId))) {
        setSelectedId(fetched[0].id);
      } else if (fetched.length === 0) {
        setSelectedId(null);
        setSelectedDetail(null);
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [filter, selectedId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (selectedId === null) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    savedAnalysisService.getAnalysisById(selectedId).then(d => {
      if (!cancelled) setSelectedDetail(d);
    }).catch(e => {
      if (!cancelled) setErrorMsg(e.message);
    });
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
        onSelect={handleSelect}
        onAfterDelete={refresh}
        onRetry={refresh}
        language={reportLanguage}
        isCollapsed={isListCollapsed}
        onToggleCollapse={() => setIsListCollapsed(c => !c)}
      />
      <SavedDetailPanel
        detail={selectedDetail}
        language={reportLanguage}
        isListCollapsed={isListCollapsed}
        onToggleList={() => setIsListCollapsed(c => !c)}
      />
    </div>
  );
}
