import { Download, ExternalLink, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { t } from '@/lib/language-preferences';
import { TabService } from '@/services/tab-service';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import { downloadJson, formatDateLong, sourceTabBadgeClass, sourceTabLabel } from './helpers';
import { SavedEmptyState } from './saved-empty-state';
import { SavedStockDetail } from './saved-stock-detail';
import { SavedSandboxDetail } from './saved-sandbox-detail';
import { cn } from '@/lib/utils';

interface SavedDetailPanelProps {
  detail: SavedAnalysis | null;
  language: ReportLanguage;
  isListCollapsed?: boolean;
  onToggleList?: () => void;
}

export function SavedDetailPanel({ detail, language, isListCollapsed = false, onToggleList }: SavedDetailPanelProps) {
  const { openTab } = useTabsContext();
  const { workspace, patchWorkspace } = useWorkspace();

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
      patchWorkspace({
        tickers: req.ticker ?? req.input_ticker ?? detail.ticker,
        startDate: req.start_date ?? workspace.startDate,
        endDate: req.end_date ?? workspace.endDate,
        selectedAgents: new Set(req.selected_agent_keys ?? []),
        selectedModel: req.selected_model ?? workspace.selectedModel,
        useDataSandboxOverrides: Boolean(req.use_data_sandbox_overrides),
      });
      openTab(TabService.createStockSearchTab());
    } else {
      patchWorkspace({
        tickers: req.ticker ?? detail.ticker,
        startDate: req.start_date ?? workspace.startDate,
        endDate: req.end_date ?? workspace.endDate,
      });
      openTab(TabService.createDataSandboxTab());
    }
  }

  const hasRequestData = Boolean(detail.request_data && Object.keys(detail.request_data).length > 0);

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
            <span className="font-mono text-base font-semibold text-primary">{detail.ticker}</span>
            <Badge variant="outline" className={cn('text-[10px] px-1 py-0', sourceTabBadgeClass(detail.source_tab))}>
              {sourceTabLabel(detail.source_tab, language)}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {detail.language.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('savedAt', language)} · {formatDateLong(detail.created_at, language)}
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
        {detail.source_tab !== 'stock_analysis' && detail.source_tab !== 'data_sandbox' && (
          <SavedEmptyState language={language} />
        )}
      </div>
    </main>
  );
}
