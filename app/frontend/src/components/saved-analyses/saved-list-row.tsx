import { Download, ExternalLink, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { t } from '@/lib/language-preferences';
import { TabService } from '@/services/tab-service';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import {
  agentCountSummary,
  downloadJson,
  formatDateShort,
  sourceTabBadgeClass,
  sourceTabLabel,
} from './helpers';
import { cn } from '@/lib/utils';

interface SavedListRowProps {
  item: SavedAnalysis;
  isSelected: boolean;
  onClick: () => void;
  onAfterDelete: () => void;
  language: ReportLanguage;
}

function IconButton({
  title,
  onClick,
  className,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn('h-6 w-6 p-0 text-muted-foreground hover:text-primary', className)}
    >
      {children}
    </Button>
  );
}

export function SavedListRow({ item, isSelected, onClick, onAfterDelete, language }: SavedListRowProps) {
  const { openTab } = useTabsContext();
  const { workspace, patchWorkspace } = useWorkspace();

  function handleRestore(e: React.MouseEvent) {
    e.stopPropagation();
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
    } else {
      patchWorkspace({
        tickers: req.ticker ?? item.ticker,
        startDate: req.start_date ?? workspace.startDate,
        endDate: req.end_date ?? workspace.endDate,
      });
      openTab(TabService.createDataSandboxTab());
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(t('confirmDelete', language).replace('{ticker}', item.ticker))) return;
    try {
      await savedAnalysisService.deleteAnalysis(item.id);
      onAfterDelete();
    } catch (err: any) {
      alert(err.message || 'delete failed');
    }
  }

  function handleExport(e: React.MouseEvent) {
    e.stopPropagation();
    downloadJson(item);
  }

  return (
    <li
      role="button"
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'group flex cursor-pointer flex-col gap-1 px-3 py-2.5 hover:bg-muted/30 outline-none focus-visible:ring-1 focus-visible:ring-primary',
        isSelected && 'bg-primary/10 border-l-2 border-primary',
      )}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-sm font-semibold text-primary truncate">{item.ticker}</span>
          <Badge variant="outline" className={cn('text-[10px] px-1 py-0', sourceTabBadgeClass(item.source_tab))}>
            {sourceTabLabel(item.source_tab, language)}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {formatDateShort(item.created_at, language)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {agentCountSummary(item, language)}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton title={t('restoreToTab', language)} onClick={handleRestore}>
            <ExternalLink size={12} />
          </IconButton>
          <IconButton title={t('exportJson', language)} onClick={handleExport}>
            <Download size={12} />
          </IconButton>
          <IconButton
            title={`${t('delete', language)} ${item.ticker}`}
            aria-label={`${t('delete', language)} ${item.ticker}`}
            onClick={handleDelete}
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 size={12} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}
