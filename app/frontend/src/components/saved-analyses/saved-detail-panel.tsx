import { Check, Download, Edit3, ExternalLink, PanelLeftOpen, PanelLeftClose, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { t } from '@/lib/language-preferences';
import { TabService } from '@/services/tab-service';
import { getTickerDisplayName } from '@/components/ui/ticker-input';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import { downloadJson, formatDateLong, getSavedDisplayName, sourceTabBadgeClass, sourceTabLabel } from './helpers';
import { SavedEmptyState } from './saved-empty-state';
import { SavedStockDetail } from './saved-stock-detail';
import { SavedSandboxDetail } from './saved-sandbox-detail';
import { SavedCompareDetail } from './saved-compare-detail';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface SavedDetailPanelProps {
  detail: SavedAnalysis | null;
  language: ReportLanguage;
  isListCollapsed?: boolean;
  onToggleList?: () => void;
  onAfterUpdate?: (item: SavedAnalysis) => void;
}

function restoreTickerDisplayInput(value: unknown, fallback: string) {
  const firstValue = Array.isArray(value) ? value[0] : value;
  const rawValue = typeof firstValue === 'string' ? firstValue : fallback;
  return getTickerDisplayName(rawValue);
}

export function SavedDetailPanel({ detail, language, isListCollapsed = false, onToggleList, onAfterUpdate }: SavedDetailPanelProps) {
  const { openTab } = useTabsContext();
  const { workspace, patchWorkspace } = useWorkspace();
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    if (detail) {
      setDraftName(getSavedDisplayName(detail));
      setIsEditingName(false);
    }
  }, [detail]);

  if (!detail) {
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        {onToggleList && (
          <div className="flex items-center border-b px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleList}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label={isListCollapsed ? 'Show list' : 'Hide list'}
            >
              {isListCollapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
              {isListCollapsed ? '목록 열기' : '목록 접기'}
            </Button>
          </div>
        )}
        <SavedEmptyState language={language} />
      </main>
    );
  }

  function handleRestore() {
    if (!detail) return;
    const req = detail.request_data || {};
    if (detail.source_tab === 'stock_analysis') {
      const restoredTickerInput = restoreTickerDisplayInput(req.input_ticker ?? req.ticker, detail.ticker);
      patchWorkspace({
        tickers: restoredTickerInput,
        startDate: req.start_date ?? workspace.startDate,
        endDate: req.end_date ?? workspace.endDate,
        selectedAgents: new Set(req.selected_agent_keys ?? []),
        selectedModel: req.selected_model ?? workspace.selectedModel,
        useDataSandboxOverrides: Boolean(req.use_data_sandbox_overrides),
      });
      openTab(TabService.createStockSearchTab());
    } else if (detail.source_tab === 'data_sandbox') {
      const restoredTickerInput = restoreTickerDisplayInput(req.input_tickers ?? req.ticker, detail.ticker);
      patchWorkspace({
        tickers: restoredTickerInput,
        startDate: req.start_date ?? workspace.startDate,
        endDate: req.end_date ?? workspace.endDate,
      });
      openTab(TabService.createDataSandboxTab());
    } else if (detail.source_tab === 'stock_compare') {
      try {
        localStorage.setItem('stock-compare:slots', JSON.stringify(req.tickers ?? []));
      } catch {
        /* ignore */
      }
      openTab(TabService.createStockCompareTab());
    }
  }

  const hasRequestData = Boolean(detail.request_data && Object.keys(detail.request_data).length > 0);
  const displayName = getSavedDisplayName(detail);

  async function handleSaveDisplayName() {
    if (!detail || !draftName.trim() || draftName.trim() === displayName || isSavingName) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      const updated = await savedAnalysisService.updateDisplayName(detail.id, draftName.trim());
      onAfterUpdate?.(updated);
      setIsEditingName(false);
    } catch (err: any) {
      alert(err.message || 'update failed');
    } finally {
      setIsSavingName(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {/* Toggle list button */}
        {onToggleList && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleList}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={isListCollapsed ? 'Show list' : 'Hide list'}
            title={isListCollapsed ? '목록 열기' : '목록 접기'}
          >
            {isListCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {/* Ticker info - grows to fill space */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Input
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveDisplayName();
                    if (e.key === 'Escape') {
                      setDraftName(displayName);
                      setIsEditingName(false);
                    }
                  }}
                  className="h-8 max-w-md text-sm font-semibold"
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveDisplayName} disabled={isSavingName}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    setDraftName(displayName);
                    setIsEditingName(false);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="group/name flex min-w-0 items-center gap-1 text-left"
                onClick={() => setIsEditingName(true)}
                title={language === 'ko' ? '이름 수정' : 'Edit name'}
              >
                <span className="truncate text-base font-semibold text-primary">{displayName}</span>
                <Edit3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
              </button>
            )}
            <Badge variant="outline" className={cn('text-[10px] px-1 py-0', sourceTabBadgeClass(detail.source_tab))}>
              {sourceTabLabel(detail.source_tab, language)}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {detail.language.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{detail.ticker}</span> · {t('savedAt', language)} · {formatDateLong(detail.created_at, language)}
          </p>
        </div>
        {/* Action buttons */}
        <div className="flex shrink-0 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => downloadJson(detail)} className="text-xs h-7">
            <Download className="mr-1 h-3.5 w-3.5" />
            {t('exportJson', language)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestore}
            disabled={!hasRequestData}
            className="text-xs h-7"
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('restoreToTab', language)}
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {detail.source_tab === 'stock_analysis' && (
          <SavedStockDetail detail={detail} language={language} />
        )}
        {detail.source_tab === 'data_sandbox' && (
          <SavedSandboxDetail detail={detail} language={language} />
        )}
        {detail.source_tab === 'stock_compare' && (
          <SavedCompareDetail detail={detail} language={language} />
        )}
        {detail.source_tab !== 'stock_analysis' && detail.source_tab !== 'data_sandbox' && detail.source_tab !== 'stock_compare' && (
          <SavedEmptyState language={language} />
        )}
      </div>
    </main>
  );
}
