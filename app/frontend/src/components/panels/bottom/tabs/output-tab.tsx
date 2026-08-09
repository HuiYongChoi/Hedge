import { useFlowContext } from '@/contexts/flow-context';
import { useNodeContext } from '@/contexts/node-context';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/language-context';
import { BacktestOutput } from './backtest-output';
import { FlowReportOutput } from './flow-report-output';
import { sortAgents } from './output-tab-utils';
import { RegularOutput } from './regular-output';

interface OutputTabProps {
  className?: string;
}

export function OutputTab({ className }: OutputTabProps) {
  const { currentFlowId } = useFlowContext();
  const { getAgentNodeDataForFlow, getOutputNodeDataForFlow } = useNodeContext();
  const { language } = useLanguage();
  const [, setUpdateTrigger] = useState(0);
  // 원문(진행 로그) / 리포트(종목분석과 같은 v5 렌더) 보기 전환
  const [view, setView] = useState<'raw' | 'report'>('raw');

  // Get current flow data
  const agentData = getAgentNodeDataForFlow(currentFlowId?.toString() || null);
  const outputData = getOutputNodeDataForFlow(currentFlowId?.toString() || null);

  // Force re-render periodically to show real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTrigger(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Detect if this is a backtest run
  const isBacktestRun = agentData && agentData['backtest'];

  // Sort agents for display (exclude backtest agent from regular agent list)
  const sortedAgents = sortAgents(Object.entries(agentData).filter(([agentId]) => agentId !== 'backtest'));

  // 백테스트가 아니고 판단 결과가 있으면 리포트로도 볼 수 있다.
  const canShowReport = !isBacktestRun && Boolean(outputData?.decisions);

  return (
    <div className={cn("h-full overflow-y-auto font-mono text-sm", className)}>
      {canShowReport && (
        <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-2 py-1.5 backdrop-blur">
          <Button
            type="button"
            size="sm"
            variant={view === 'raw' ? 'default' : 'ghost'}
            className="h-7 text-xs"
            onClick={() => setView('raw')}
          >
            {language === 'ko' ? '진행 로그' : 'Run log'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'report' ? 'default' : 'ghost'}
            className="h-7 text-xs"
            onClick={() => setView('report')}
          >
            {language === 'ko' ? '리포트' : 'Report'}
          </Button>
        </div>
      )}

      {/* Render backtest output if this is a backtest run */}
      {isBacktestRun && (
        <BacktestOutput agentData={agentData} outputData={outputData} />
      )}

      {/* 리포트 보기 — 종목분석과 동일한 v5 렌더 */}
      {canShowReport && view === 'report' && (
        <FlowReportOutput
          agentData={agentData}
          outputData={outputData}
          flowId={currentFlowId?.toString() ?? null}
        />
      )}

      {/* Render regular output if not a backtest run */}
      {!isBacktestRun && view === 'raw' && (
        <RegularOutput sortedAgents={sortedAgents} outputData={outputData} />
      )}

      {/* Empty State */}
      {!outputData && sortedAgents.length === 0 && !isBacktestRun && (
        <div className="text-center py-8 text-muted-foreground">
          No output to display. Run an analysis to see progress and results.
        </div>
      )}
    </div>
  );
}
