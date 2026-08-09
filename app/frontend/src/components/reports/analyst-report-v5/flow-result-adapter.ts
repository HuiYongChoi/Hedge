import { getAgentMeta } from './helpers';
import type { AgentNodeData, OutputNodeData } from '@/contexts/node-context';
import type { AgentResult, CompleteResult } from './types';

/**
 * 플로우 실행 결과 → 종목분석 v5 리포트 입력으로 변환.
 *
 * 플로우와 종목분석은 백엔드가 같다(`/hedge-fund/run` + graph_nodes/edges). 결과 모양도
 * 사실상 같아서(OutputNodeData 가 decisions/analyst_signals 를 그대로 담는다) 얇은 어댑터
 * 한 겹이면 플로우 결과에도 v5 렌더(제목 정리·근거 카드·출처·원문 그라운딩)를 그대로 쓸 수 있다.
 */

/** 리포트에 넘길 대상 종목 목록. decisions 키가 우선, 없으면 에이전트가 다룬 티커. */
export function resolveFlowTickers(
  outputData: OutputNodeData | null | undefined,
  agentData: Record<string, AgentNodeData> | null | undefined,
): string[] {
  const fromDecisions = Object.keys(outputData?.decisions ?? {})
    .map(key => key.trim())
    .filter(Boolean);
  if (fromDecisions.length > 0) return fromDecisions;

  const fromAgents = Object.values(agentData ?? {})
    .map(node => (node?.ticker || '').trim())
    .filter(Boolean);
  return Array.from(new Set(fromAgents));
}

/** 플로우 노드 상태 맵 → 리포트가 쓰는 AgentResult 맵. */
export function toAgentResults(
  agentData: Record<string, AgentNodeData> | null | undefined,
  outputData: OutputNodeData | null | undefined,
  ticker: string,
): Map<string, AgentResult> {
  const results = new Map<string, AgentResult>();
  const signals = outputData?.analyst_signals ?? {};

  for (const [agentKey, node] of Object.entries(agentData ?? {})) {
    // 백테스트 진행 노드는 분석 리포트의 근거가 아니다.
    if (agentKey === 'backtest') continue;

    // 해당 에이전트가 이 종목에 대해 낸 신호(리포트 본문의 실제 근거).
    const signalForTicker = signals?.[agentKey]?.[ticker];

    const partial: AgentResult = {
      agentKey,
      agentName: agentKey,
      status: node?.status ?? 'IDLE',
      ticker: node?.ticker ?? ticker,
      analysis: node?.analysis ?? undefined,
      report: signalForTicker && typeof signalForTicker === 'object' ? signalForTicker : undefined,
      timestamp: node?.timestamp,
    };
    // 표시용 한국어 이름으로 교체(리포트 헤더·출처 칩에서 쓰인다).
    partial.agentName = getAgentMeta(agentKey, partial).name;
    results.set(agentKey, partial);
  }
  return results;
}

/** OutputNodeData → CompleteResult. 필드가 같아 얕은 변환이면 충분하다. */
export function toCompleteResult(
  outputData: OutputNodeData | null | undefined,
): CompleteResult | null {
  if (!outputData || !outputData.decisions) return null;
  return {
    decisions: outputData.decisions,
    analyst_signals: outputData.analyst_signals ?? {},
  };
}

export interface FlowReportInput {
  ticker: string;
  tickers: string[];
  completeResult: CompleteResult;
  agentResults: Map<string, AgentResult>;
}

/**
 * 플로우 결과를 리포트에 바로 넘길 수 있는 형태로 묶는다.
 * 아직 결과가 없거나(실행 전) 판단이 비어 있으면 null — 호출부가 안내 문구를 띄운다.
 */
export function buildFlowReportInput(
  agentData: Record<string, AgentNodeData> | null | undefined,
  outputData: OutputNodeData | null | undefined,
  preferredTicker?: string | null,
): FlowReportInput | null {
  const completeResult = toCompleteResult(outputData);
  if (!completeResult) return null;

  const tickers = resolveFlowTickers(outputData, agentData);
  if (tickers.length === 0) return null;

  const ticker = preferredTicker && tickers.includes(preferredTicker)
    ? preferredTicker
    : tickers[0];

  return {
    ticker,
    tickers,
    completeResult,
    agentResults: toAgentResults(agentData, outputData, ticker),
  };
}
