import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ui/llm-selector';
import { TickerInput } from '@/components/ui/ticker-input';
import { useLanguage } from '@/contexts/language-context';
import { Agent, getAgents } from '@/data/agents';
import { getDefaultModel, getModels, LanguageModel } from '@/data/models';
import { t } from '@/lib/language-preferences';
import { Bot, ChevronDown, ChevronUp, Loader2, Play, Search, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (typeof window !== 'undefined' && 
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
    ? 'http://localhost:8000' 
    : '/hedge-api');

interface AgentResult {
  agentKey: string;
  agentName: string;
  status: 'waiting' | 'running' | 'complete' | 'error';
  ticker?: string;
  message?: string;
  analysis?: any;
  timestamp?: string;
}

interface CompleteResult {
  decisions?: Record<string, any>;
  analyst_signals?: Record<string, any>;
  reasoning?: string;
}

export function StockSearchTab() {
  const { language } = useLanguage();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<LanguageModel[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<LanguageModel | null>(null);
  const [tickers, setTickers] = useState('');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0];
  });
  const [isRunning, setIsRunning] = useState(false);
  const [agentResults, setAgentResults] = useState<Map<string, AgentResult>>(new Map());
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [agentList, modelList, defaultModel] = await Promise.all([
          getAgents(),
          getModels(),
          getDefaultModel(),
        ]);
        setAgents(agentList);
        setModels(modelList);
        setSelectedModel(defaultModel);
        // Select all agents by default
        setSelectedAgents(new Set(agentList.map(a => a.key)));
      } catch (err) {
        console.error('Failed to load agents/models', err);
      }
    };
    load();
  }, []);

  const allSelected = agents.length > 0 && selectedAgents.size === agents.length;
  const someSelected = selectedAgents.size > 0 && !allSelected;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedAgents(new Set());
    } else {
      setSelectedAgents(new Set(agents.map(a => a.key)));
    }
  };

  const handleToggleAgent = (key: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
  };

  const handleRun = async () => {
    if (!tickers.trim() || selectedAgents.size === 0) return;

    setIsRunning(true);
    setErrorMessage(null);
    setCompleteResult(null);

    // Build initial agent results map
    const initialResults = new Map<string, AgentResult>();
    agents.filter(a => selectedAgents.has(a.key)).forEach(agent => {
      initialResults.set(agent.key, {
        agentKey: agent.key,
        agentName: agent.display_name,
        status: 'waiting',
      });
    });
    setAgentResults(initialResults);

    // Build graph nodes and edges
    const tickerList = tickers.split(',').map(s => s.trim()).filter(Boolean);
    const suffix = Math.random().toString(36).slice(2, 8);
    const pmId = `portfolio_manager_${suffix}`;
    const startNodeId = `start_${suffix}`;

    const agentNodes = agents
      .filter(a => selectedAgents.has(a.key))
      .map(a => ({
        id: `${a.key}_${suffix}`,
        type: 'agent-node',
        data: { name: a.display_name, description: a.investing_style, status: 'Idle' },
        position: { x: 0, y: 0 },
      }));

    const graphNodes = [
      ...agentNodes,
      {
        id: pmId,
        type: 'portfolio-manager-node',
        data: { name: 'Portfolio Manager', status: 'IDLE' },
        position: { x: 0, y: 0 },
      },
    ];

    const graphEdges = [
      ...agentNodes.map((n, i) => ({
        id: `e-start-agent-${i}`,
        source: startNodeId,
        target: n.id,
      })),
      ...agentNodes.map((n, i) => ({
        id: `e-agent-pm-${i}`,
        source: n.id,
        target: pmId,
      })),
    ];

    const agentModels = selectedModel
      ? [...agentNodes.map(n => ({
          agent_id: n.id,
          model_name: selectedModel.model_name,
          model_provider: selectedModel.provider,
        })),
        { agent_id: pmId, model_name: selectedModel.model_name, model_provider: selectedModel.provider }]
      : [];

    const body = {
      tickers: tickerList,
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      agent_models: agentModels,
      start_date: startDate,
      end_date: endDate,
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${API_BASE_URL}/hedge-fund/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventText of events) {
          if (!eventText.trim()) continue;
          try {
            const typeMatch = eventText.match(/^event: (.+)$/m);
            const dataMatch = eventText.match(/^data: (.+)$/m);
            if (!typeMatch || !dataMatch) continue;

            const eventType = typeMatch[1];
            const eventData = JSON.parse(dataMatch[1]);

            if (eventType === 'progress' && eventData.agent) {
              // Map backend agent key (e.g. "warren_buffett_agent" -> "warren_buffett")
              const baseKey = eventData.agent.replace('_agent', '');
              setAgentResults(prev => {
                const next = new Map(prev);
                const existing = next.get(baseKey);
                if (existing) {
                  next.set(baseKey, {
                    ...existing,
                    status: eventData.status === 'Done' ? 'complete' : 'running',
                    ticker: eventData.ticker,
                    message: eventData.status,
                    analysis: eventData.analysis ?? existing.analysis,
                    timestamp: eventData.timestamp,
                  });
                }
                return next;
              });
            } else if (eventType === 'complete') {
              setCompleteResult(eventData.data || eventData);
              setAgentResults(prev => {
                const next = new Map(prev);
                next.forEach((val, key) => {
                  next.set(key, { ...val, status: 'complete' });
                });
                return next;
              });
            } else if (eventType === 'error') {
              setErrorMessage(eventData.message || 'Unknown error');
              setAgentResults(prev => {
                const next = new Map(prev);
                next.forEach((val, key) => {
                  if (val.status !== 'complete') {
                    next.set(key, { ...val, status: 'error' });
                  }
                });
                return next;
              });
            }
          } catch (_) {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setErrorMessage(err.message || 'Connection error');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const statusColor = (status: AgentResult['status']) => {
    switch (status) {
      case 'complete': return 'text-green-500';
      case 'running': return 'text-blue-500';
      case 'error': return 'text-red-500';
      default: return 'text-muted-foreground';
    }
  };

  const statusLabel = (status: AgentResult['status']) => {
    switch (status) {
      case 'complete': return t('completeStatus', language);
      case 'running': return t('runningStatus', language);
      case 'error': return t('errorStatus', language);
      default: return t('waitingStatus', language);
    }
  };

  const canRun = tickers.trim() !== '' && selectedAgents.size > 0 && !isRunning;

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="border-b p-4 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Search size={18} className="text-blue-500" />
          <h1 className="text-lg font-semibold text-primary">
            {language === 'ko' ? '종목 분석' : 'Stock Analysis'}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {language === 'ko'
            ? '종목을 검색하고 원하는 에이전트를 선택해 상세 분석 보고서를 받으세요.'
            : 'Search for stocks and select agents to receive detailed analysis reports.'}
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Config Panel */}
        <div className="w-72 flex-shrink-0 border-r overflow-y-auto p-4 space-y-4">
          {/* Tickers */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('tickers', language)}</label>
            <TickerInput
              placeholder={t('enterTickers', language)}
              value={tickers}
              onChange={val => setTickers(val)}
              onKeyDown={e => { if (e.key === 'Enter' && canRun) handleRun(); }}
            />
            <p className="text-xs text-muted-foreground">{t('tickersTooltip', language)}</p>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs">{t('startDate', language)}</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs">{t('endDate', language)}</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs" />
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('nodeModel', language)}</label>
            <ModelSelector
              models={models}
              value={selectedModel?.model_name || ''}
              onChange={setSelectedModel}
              placeholder="Auto"
            />
          </div>

          {/* Agent selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('analystNodes', language)}</label>

            {/* Select All */}
            <div className="flex items-center gap-2 pb-1 border-b">
              <Checkbox
                id="select-all"
                checked={allSelected}
                ref={(el) => {
                  if (el) (el as any).indeterminate = someSelected;
                }}
                onCheckedChange={handleSelectAll}
              />
              <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                {language === 'ko' ? '모두 선택' : 'Select All'}
              </label>
              <span className="ml-auto text-xs text-muted-foreground">{selectedAgents.size}/{agents.length}</span>
            </div>

            {agents.map(agent => (
              <div key={agent.key} className="flex items-start gap-2">
                <Checkbox
                  id={`agent-${agent.key}`}
                  checked={selectedAgents.has(agent.key)}
                  onCheckedChange={() => handleToggleAgent(agent.key)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <label htmlFor={`agent-${agent.key}`} className="text-sm cursor-pointer leading-tight">
                    {agent.display_name}
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* Run Button */}
          <Button
            className="w-full"
            onClick={isRunning ? handleStop : handleRun}
            disabled={!canRun && !isRunning}
            variant={isRunning ? 'destructive' : 'default'}
          >
            {isRunning ? (
              <><Square className="h-4 w-4 mr-2" /> {language === 'ko' ? '중지' : 'Stop'}</>
            ) : (
              <><Play className="h-4 w-4 mr-2" /> {language === 'ko' ? '분석 실행' : 'Run Analysis'}</>
            )}
          </Button>
        </div>

        {/* Right: Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {agentResults.size === 0 && !isRunning && (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-2">
                <Bot size={40} className="mx-auto opacity-30" />
                <p className="text-sm">
                  {language === 'ko'
                    ? '종목과 에이전트를 선택한 후 분석을 실행하세요.'
                    : 'Enter a ticker and select agents to run analysis.'}
                </p>
              </div>
            </div>
          )}

          {/* Agent cards */}
          {Array.from(agentResults.values()).map(result => {
            const isExpanded = expandedAgents.has(result.agentKey);
            return (
              <Card key={result.agentKey} className="overflow-hidden">
                <CardHeader
                  className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => result.analysis && toggleExpand(result.agentKey)}
                >
                  <div className="flex items-center gap-3">
                    <Bot size={16} className={statusColor(result.status)} />
                    <CardTitle className="text-sm font-medium flex-1">{result.agentName}</CardTitle>
                    {result.ticker && (
                      <Badge variant="outline" className="text-xs">{result.ticker}</Badge>
                    )}
                    <span className={`text-xs font-medium ${statusColor(result.status)}`}>
                      {result.status === 'running' && <Loader2 size={12} className="inline animate-spin mr-1" />}
                      {statusLabel(result.status)}
                    </span>
                    {result.analysis && (
                      isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />
                    )}
                  </div>
                  {result.message && result.message !== 'Done' && (
                    <p className="text-xs text-muted-foreground mt-1">{result.message}</p>
                  )}
                </CardHeader>

                {isExpanded && result.analysis && (
                  <CardContent className="px-4 pb-4 pt-0">
                    <div className="border-t pt-3 space-y-2">
                      <AnalysisDisplay analysis={result.analysis} agentKey={result.agentKey} language={language} />
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}

          {/* Final Decision */}
          {completeResult && completeResult.decisions && (
            <Card className="border-green-300 dark:border-green-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">
                  {language === 'ko' ? '최종 투자 결정' : 'Final Investment Decisions'}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="space-y-2">
                  {Object.entries(completeResult.decisions).map(([ticker, decision]: [string, any]) => (
                    <div key={ticker} className="flex items-center justify-between p-2 rounded border">
                      <span className="font-mono font-medium">{ticker}</span>
                      <div className="flex items-center gap-3 text-sm">
                        <span className={
                          decision.action === 'buy' ? 'text-green-500 font-medium' :
                          decision.action === 'sell' ? 'text-red-500 font-medium' :
                          'text-yellow-500 font-medium'
                        }>
                          {decision.action === 'buy' ? t('longAction', language).toUpperCase() : 
                           decision.action === 'sell' ? t('shortAction', language).toUpperCase() : 
                           t('holdAction', language).toUpperCase()}
                        </span>
                        {decision.quantity && <span className="text-muted-foreground">{decision.quantity} {t('shares', language)}</span>}
                        {decision.confidence && (
                          <span className="text-muted-foreground text-xs">
                            {Math.round(decision.confidence * 100)}% {language === 'ko' ? '신뢰도' : 'confidence'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {completeResult.reasoning && (
                  <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    {completeResult.reasoning}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisDisplay({ analysis, language }: { analysis: any; agentKey?: string; language: any }) {
  if (!analysis) return null;

  // Try to render structured analysis data
  if (typeof analysis === 'string') {
    return <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{analysis}</p>;
  }

  if (typeof analysis === 'object') {
    return (
      <div className="space-y-2 text-sm">
        {Object.entries(analysis).map(([key, value]) => (
          <div key={key}>
            <span className="font-medium text-primary capitalize">
              {t(key as any, language) !== key ? t(key as any, language) : key.replace(/_/g, ' ')}: 
            </span>
            {renderValue(value, language)}
          </div>
        ))}
      </div>
    );
  }

  return <pre className="text-xs overflow-auto">{JSON.stringify(analysis, null, 2)}</pre>;
}

function renderValue(value: any, language: any): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-500' : 'text-red-500'}>
      {value ? (language === 'ko' ? '예' : 'Yes') : (language === 'ko' ? '아니오' : 'No')}
    </span>;
  }
  if (typeof value === 'number') return <span className="text-blue-500 font-mono">{value}</span>;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'bullish' || lower === 'buy') return <span className="text-green-500 font-medium">{language === 'ko' ? '강세' : value}</span>;
    if (lower === 'bearish' || lower === 'sell') return <span className="text-red-500 font-medium">{language === 'ko' ? '약세' : value}</span>;
    if (lower === 'neutral' || lower === 'hold') return <span className="text-yellow-500 font-medium">{language === 'ko' ? '중립' : value}</span>;
    return <span className="text-foreground">{value}</span>;
  }
  if (typeof value === 'object') {
    return (
      <div className="ml-3 space-y-1 mt-1">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground capitalize">
              {t(k as any, language) !== k ? t(k as any, language) : k.replace(/_/g, ' ')}: 
            </span>
            {renderValue(v, language)}
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}
