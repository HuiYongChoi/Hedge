import { useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { AnalystReportDashboard } from '@/components/reports/analyst-report-dashboard';
import { buildFlowReportInput } from '@/components/reports/analyst-report-v5/flow-result-adapter';
import { calculateCompositeScore } from '@/components/tabs/stock-search-tab';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/language-context';
import { useToastManager } from '@/hooks/use-toast-manager';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import type { MarketSnapshot } from '@/components/reports/analyst-report-v5/market-snapshot';
import type { AgentNodeData, OutputNodeData } from '@/contexts/node-context';

interface FlowReportOutputProps {
  agentData: Record<string, AgentNodeData>;
  outputData: OutputNodeData | null;
  flowName?: string | null;
  flowId?: string | null;
}

/**
 * 플로우 실행 결과를 종목분석과 같은 v5 리포트로 보여준다.
 *
 * 플로우와 종목분석은 백엔드가 동일하므로(같은 /hedge-fund/run), 결과만 어댑터로
 * 옮기면 그동안 다듬은 리포트 렌더(제목 정리·근거 카드·출처·원문 그라운딩)를
 * 플로우에서도 그대로 쓸 수 있다.
 */
export function FlowReportOutput({ agentData, outputData, flowName, flowId }: FlowReportOutputProps) {
  const { language } = useLanguage();
  const { success, error } = useToastManager();
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const input = useMemo(
    () => buildFlowReportInput(agentData, outputData, activeTicker),
    [agentData, outputData, activeTicker],
  );

  const compositeScore = useMemo(() => {
    if (!input) return 50;
    try {
      return calculateCompositeScore(
        input.completeResult.analyst_signals,
        input.ticker,
        input.completeResult.decisions?.[input.ticker],
      );
    } catch {
      return 50;
    }
  }, [input]);

  if (!input) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {language === 'ko'
          ? '아직 리포트로 만들 결과가 없습니다. 플로우를 실행하면 종목분석과 같은 형식의 리포트가 여기에 표시됩니다.'
          : 'No results yet. Run the flow to see a report in the same format as Stock Analysis.'}
      </div>
    );
  }

  const handleSave = async (marketSnapshot?: MarketSnapshot) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await savedAnalysisService.saveAnalysis(
        'flow',
        input.ticker,
        language,
        {
          flow_id: flowId ?? null,
          flow_name: flowName ?? null,
          tickers: input.tickers,
          agent_keys: Array.from(input.agentResults.keys()),
        },
        {
          agent_results: Array.from(input.agentResults.values()),
          complete_result: input.completeResult,
          analysis_generated_at: new Date().toISOString(),
          market_snapshot: marketSnapshot ?? null,
          saved_display_name: flowName ? `${flowName} · ${input.ticker}` : input.ticker,
        },
        flowName ? `${flowName} · ${input.ticker}` : undefined,
      );
      success(
        language === 'ko' ? '저장 분석에 보관했습니다.' : 'Saved to Saved Analyses.',
        'flow-report-save',
      );
    } catch (err) {
      console.error('Failed to save flow report', err);
      error(
        language === 'ko' ? '저장에 실패했습니다.' : 'Failed to save.',
        'flow-report-save-error',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2 font-sans">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 다종목 플로우면 종목을 골라 볼 수 있게 한다 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {input.tickers.length > 1 && input.tickers.map(ticker => (
            <Button
              key={ticker}
              type="button"
              size="sm"
              variant={ticker === input.ticker ? 'default' : 'outline'}
              className="h-7 font-mono text-xs"
              onClick={() => setActiveTicker(ticker)}
            >
              {ticker}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => handleSave()}
          disabled={isSaving}
        >
          {isSaving
            ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            : <Save className="mr-1 h-3.5 w-3.5" />}
          {language === 'ko' ? '저장 분석에 보관' : 'Save to archive'}
        </Button>
      </div>

      <AnalystReportDashboard
        ticker={input.ticker}
        completeResult={input.completeResult}
        agentResults={input.agentResults}
        language={language}
        compositeScore={compositeScore}
        onSave={handleSave}
        isSaving={isSaving}
      />
    </div>
  );
}
