import { useMemo } from 'react';
import { AnalystReportDashboard } from '@/components/reports/analyst-report-dashboard';
import { t } from '@/lib/language-preferences';
import { calculateCompositeScore } from '@/components/tabs/stock-search-tab';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import type { AgentResult, ReportLanguage } from '@/components/reports/analyst-report-v5/types';

interface Props {
  detail: SavedAnalysis;
  language: ReportLanguage;
}

export function SavedStockDetail({ detail, language }: Props) {
  let result: any;
  try {
    result = detail.result_data ?? {};
  } catch {
    result = {};
  }

  const completeResult = result.complete_result ?? null;
  const agentResultsArr: AgentResult[] = result.agent_results ?? [];
  const agentResultsMap = useMemo(
    () => new Map(agentResultsArr.map((r: AgentResult) => [r.agentKey, r])),
    [agentResultsArr],
  );
  const ticker = detail.ticker;

  if (!completeResult || !completeResult.decisions) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">{t('savedNoDecisions', language)}</p>
        <pre className="max-h-64 w-full overflow-auto rounded border bg-muted/20 p-3 text-[11px] font-mono">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    );
  }

  let compositeScore = 50;
  try {
    compositeScore = calculateCompositeScore(
      completeResult.analyst_signals,
      ticker,
      completeResult.decisions[ticker],
    );
  } catch {
    // fallback to 50
  }

  return (
    <AnalystReportDashboard
      ticker={ticker}
      completeResult={completeResult}
      agentResults={agentResultsMap}
      language={language}
      compositeScore={compositeScore}
      onSave={undefined}
      isSaving={false}
    />
  );
}
