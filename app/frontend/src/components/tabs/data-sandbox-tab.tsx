import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ui/llm-selector';
import { resolveTickerValue, TickerInput } from '@/components/ui/ticker-input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useLanguage } from '@/contexts/language-context';
import { Agent, getAgents } from '@/data/agents';
import { getDefaultModel, getModels, LanguageModel } from '@/data/models';
import { extractBaseAgentKey } from '@/components/ui/agent-formula-tooltip';
import { t } from '@/lib/language-preferences';
import { MetricsGrid, parseOverrideInput, compareOverrideVsLineItem0, getFinancialFieldLabel } from './data-sandbox/metrics-grid';
import { AlertCircle, Database, Loader2, Play, RefreshCw, Square, Bot } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const TrendCharts = lazy(() =>
  import('./data-sandbox/trend-charts').then(m => ({ default: m.TrendCharts }))
);

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

// ── Types ──────────────────────────────────────────────────────────────────

interface FetchedData {
  ticker: string;
  metrics: Record<string, any>;
  market_cap: number | null;
  prices: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  line_items: Record<string, any>[];
  cache_key: string;
}

interface AgentResult {
  agentKey: string;
  agentName: string;
  status: 'waiting' | 'running' | 'complete' | 'error';
  ticker?: string;
  signal?: string;
  confidence?: number;
  reasoning?: string;
}

interface CompleteResult {
  decisions?: Record<string, any>;
  analyst_signals?: Record<string, any>;
}

type ViewTab = 'metrics' | 'line-items' | 'trends' | 'results';

// ── Helpers ────────────────────────────────────────────────────────────────

function getAgentDisplayName(agent: Agent, language: 'ko' | 'en') {
  return language === 'ko' && agent.display_name_ko ? agent.display_name_ko : agent.display_name;
}

function getAgentDescription(agent: Agent, language: 'ko' | 'en') {
  return language === 'ko' && agent.investing_style_ko ? agent.investing_style_ko : agent.investing_style;
}

function fmtNumber(v: any): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(4);
}

// ── Line Items display fields ──────────────────────────────────────────────

const LINE_ITEM_FIELDS = [
  'revenue', 'gross_profit', 'operating_income', 'net_income',
  'ebitda', 'free_cash_flow', 'operating_cash_flow', 'capital_expenditure',
  'total_assets', 'total_liabilities', 'shareholders_equity',
  'cash_and_equivalents', 'total_debt', 'earnings_per_share',
  'research_and_development', 'interest_expense', 'depreciation_and_amortization',
];

// ── Main Component ─────────────────────────────────────────────────────────

export function DataSandboxTab() {
  const { language } = useLanguage();

  // Config state
  const [tickers, setTickers] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<LanguageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<LanguageModel | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());

  // Fetch state
  const [isFetching, setIsFetching] = useState(false);
  const [fetchedData, setFetchedData] = useState<FetchedData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Override state (input values as strings for controlled inputs)
  const [metricsOverrides, setMetricsOverrides] = useState<Record<string, string>>({});
  const [lineItemsOverrides, setLineItemsOverrides] = useState<Record<string, any>[]>([]);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [agentResults, setAgentResults] = useState<Map<string, AgentResult>>(new Map());
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // View tab
  const [viewTab, setViewTab] = useState<ViewTab>('metrics');

  // Load agents & models on mount
  useEffect(() => {
    Promise.all([getAgents(), getModels(), getDefaultModel()]).then(([agentList, modelList, defaultModel]) => {
      setAgents(agentList);
      setModels(modelList);
      setSelectedModel(defaultModel);
    }).catch(console.error);
  }, []);

  // Switch to results tab when run starts
  useEffect(() => {
    if (isRunning) setViewTab('results');
  }, [isRunning]);

  // ── Agent selection ──────────────────────────────────────────────────────

  const allSelected = agents.length > 0 && selectedAgents.size === agents.length;
  const someSelected = selectedAgents.size > 0 && !allSelected;

  const handleSelectAll = () => {
    setSelectedAgents(allSelected ? new Set() : new Set(agents.map(a => a.key)));
  };

  const handleToggleAgent = (key: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Fetch handler ────────────────────────────────────────────────────────

  const handleFetch = async () => {
    const raw = tickers.split(',')[0].trim();
    const ticker = resolveTickerValue(raw).toUpperCase();
    if (!ticker) return;

    setIsFetching(true);
    setFetchError(null);
    setFetchedData(null);
    setMetricsOverrides({});
    setCompleteResult(null);
    setAgentResults(new Map());
    setRunError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/hedge-fund/fetch-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          end_date: endDate,
          start_date: startDate,
          period: 'ttm',
          limit: 10,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: FetchedData = await response.json();
      setFetchedData(data);
      setLineItemsOverrides(data.line_items ? data.line_items.map(row => ({ ...row })) : []);
      setViewTab('metrics');
    } catch (err: any) {
      setFetchError(err.message || 'Fetch failed');
    } finally {
      setIsFetching(false);
    }
  };

  // ── Run handler ──────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!fetchedData || selectedAgents.size === 0) return;

    const ticker = fetchedData.ticker;

    setIsRunning(true);
    setRunError(null);
    setCompleteResult(null);

    // Init agent result map
    const initialResults = new Map<string, AgentResult>();
    agents.filter(a => selectedAgents.has(a.key)).forEach(agent => {
      initialResults.set(agent.key, {
        agentKey: agent.key,
        agentName: getAgentDisplayName(agent, language),
        status: 'waiting',
      });
    });
    setAgentResults(initialResults);

    // Build graph nodes & edges (matches stock-search-tab pattern)
    const suffix = Math.random().toString(36).slice(2, 8);
    const pmId = `portfolio_manager_${suffix}`;
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
      { id: pmId, type: 'portfolio-manager-node', data: { name: 'Portfolio Manager', status: 'IDLE' }, position: { x: 0, y: 0 } },
    ];
    const graphEdges = agentNodes.map((n, i) => ({
      id: `e-agent-pm-${i}`,
      source: n.id,
      target: pmId,
    }));
    const agentModels = selectedModel
      ? [
          ...agentNodes.map(n => ({
            agent_id: n.id,
            model_name: selectedModel.model_name,
            model_provider: selectedModel.provider,
          })),
          { agent_id: pmId, model_name: selectedModel.model_name, model_provider: selectedModel.provider },
        ]
      : [];

    // Build metric_overrides — supports shorthand like 3.77B, 1.2M, 500K
    const cleanMetrics: Record<string, number> = {};
    Object.entries(metricsOverrides).forEach(([k, v]) => {
      if (v !== '') {
        const n = parseOverrideInput(v);
        if (n !== null) cleanMetrics[k] = n;
      }
    });
    const cleanLineItems = lineItemsOverrides
      .map(row => {
        const clean: Record<string, any> = {};
        Object.entries(row).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== '') clean[k] = v;
        });
        return clean;
      })
      .filter(row => Object.keys(row).length > 0);

    const metricOverrides: Record<string, any> = {};
    if (Object.keys(cleanMetrics).length > 0) metricOverrides.metrics = cleanMetrics;
    if (cleanLineItems.length > 0) metricOverrides.line_items = cleanLineItems;

    const body: Record<string, any> = {
      tickers: [ticker],
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      agent_models: agentModels,
      start_date: startDate,
      end_date: endDate,
      language,
    };
    if (Object.keys(metricOverrides).length > 0) {
      body.metric_overrides = { [ticker]: metricOverrides };
    }

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
              const baseKey = extractBaseAgentKey(eventData.agent);
              setAgentResults(prev => {
                const next = new Map(prev);
                const existing = next.get(baseKey);
                if (existing) {
                  next.set(baseKey, {
                    ...existing,
                    status: eventData.status === 'Done' ? 'complete' : 'running',
                    ticker: eventData.ticker,
                  });
                }
                return next;
              });
            } else if (eventType === 'complete') {
              const completeData = eventData.data || eventData;
              setCompleteResult(completeData);
              setAgentResults(prev => {
                const next = new Map(prev);
                const analystSignals = completeData.analyst_signals || {};
                Object.entries(analystSignals).forEach(([agentId, report]: [string, any]) => {
                  const baseKey = extractBaseAgentKey(agentId);
                  if (!selectedAgents.has(baseKey)) return;
                  const existing = next.get(baseKey);
                  if (existing) {
                    const tickerReport = typeof report === 'object' ? report[ticker] : null;
                    next.set(baseKey, {
                      ...existing,
                      status: 'complete',
                      signal: tickerReport?.signal,
                      confidence: tickerReport?.confidence,
                      reasoning: tickerReport?.reasoning,
                    });
                  }
                });
                next.forEach((val, key) => {
                  next.set(key, { ...val, status: 'complete' });
                });
                return next;
              });
            } else if (eventType === 'error') {
              setRunError(eventData.message || 'Unknown error');
              setAgentResults(prev => {
                const next = new Map(prev);
                next.forEach((val, key) => {
                  if (val.status !== 'complete') next.set(key, { ...val, status: 'error' });
                });
                return next;
              });
            }
          } catch (_) {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setRunError(err.message || 'Connection error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
  };

  // ── Override helpers ─────────────────────────────────────────────────────

  const handleMetricOverride = (field: string, value: string) => {
    setMetricsOverrides(prev => ({ ...prev, [field]: value }));
  };

  const handleLineItemOverride = (rowIdx: number, field: string, value: string) => {
    setLineItemsOverrides(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [field]: value === '' ? null : Number(value) };
      return next;
    });
  };

  const resetOverrides = () => {
    setMetricsOverrides({});
    if (fetchedData) setLineItemsOverrides(fetchedData.line_items.map(row => ({ ...row })));
  };

  const overrideCount = Object.values(metricsOverrides).filter(v => v !== '').length;

  const canFetch = tickers.trim() !== '' && !isFetching && !isRunning;
  const canRun = !!fetchedData && selectedAgents.size > 0 && !isRunning && !isFetching;

  // ── Status color helpers ─────────────────────────────────────────────────

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
      case 'complete': return t('statusComplete', language);
      case 'running': return t('statusRunning', language);
      case 'error': return t('statusError', language);
      case 'waiting': return t('statusWaiting', language);
    }
  };

  const signalClass = (signal?: string) => {
    const s = (signal || '').toLowerCase();
    if (s === 'bullish' || s === 'buy' || s === 'long') return 'text-green-500';
    if (s === 'bearish' || s === 'sell' || s === 'short') return 'text-red-500';
    return 'text-yellow-500';
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const VIEW_TABS: { key: ViewTab; labelKey: string }[] = [
    { key: 'metrics', labelKey: 'metricsTab' },
    { key: 'line-items', labelKey: 'lineItemsTab' },
    { key: 'trends', labelKey: 'trendsTab' },
    { key: 'results', labelKey: 'resultsTab' },
  ];

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="border-b p-4 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Database size={18} className="text-blue-500" />
          <h1 className="text-lg font-semibold text-primary">
            {t('dataSandbox', language)}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('dataSandboxDesc', language)}
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel ── */}
        <div className="w-72 flex-shrink-0 border-r overflow-y-auto p-4 space-y-4">
          {/* Ticker */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t('tickerCodeLabel', language)}
            </label>
            <TickerInput
              placeholder={t('exampleTicker', language)}
              value={tickers}
              onChange={setTickers}
              onKeyDown={e => { if (e.key === 'Enter' && canFetch) handleFetch(); }}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t('startDateLabel', language)}
              </label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t('endDateLabel', language)}
              </label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs" />
            </div>
          </div>

          {/* Fetch Button */}
          <Button
            className="w-full"
            variant="outline"
            onClick={handleFetch}
            disabled={!canFetch}
          >
            {isFetching
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('fetching', language)}</>
              : fetchedData
                ? <><RefreshCw className="h-4 w-4 mr-2" />{t('reFetch', language)}</>
                : <><Database className="h-4 w-4 mr-2" />{t('fetchData', language)}</>
            }
          </Button>

          {fetchError && (
            <p className="text-xs text-red-500">{fetchError}</p>
          )}

          {fetchedData && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 space-y-0.5">
              <p><span className="font-medium">{fetchedData.ticker}</span></p>
              {fetchedData.market_cap && (
                <p>{t('marketCapLabel', language)}: {fmtNumber(fetchedData.market_cap)}</p>
              )}
              {overrideCount > 0 && (
                <p className="text-blue-400">
                  {t('overrideCountLabel', language).replace('{count}', String(overrideCount))}
                </p>
              )}
            </div>
          )}

          {fetchedData && overrideCount > 0 && (
            <button
              onClick={resetOverrides}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {t('resetOverrides', language)}
            </button>
          )}

          <div className="border-t pt-4 space-y-4">
            {/* Model */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t('modelLabel', language)}
              </label>
              <ModelSelector
                models={models}
                value={selectedModel?.model_name || ''}
                onChange={setSelectedModel}
                placeholder="Auto"
              />
            </div>

            {/* Agents */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t('analystsLabel', language)}
              </label>

              <div className="flex items-center gap-2 pb-1 border-b">
                <Checkbox
                  id="sb-select-all"
                  checked={allSelected}
                  ref={(el) => { if (el) (el as any).indeterminate = someSelected; }}
                  onCheckedChange={handleSelectAll}
                />
                <label htmlFor="sb-select-all" className="text-sm cursor-pointer">
                  {t('selectAllAgents', language)}
                </label>
                <span className="ml-auto text-xs text-muted-foreground">{selectedAgents.size}/{agents.length}</span>
              </div>

              <Accordion type="multiple" defaultValue={Array.from(new Set(agents.map(a => a.category || 'Other')))}>
                {Array.from(new Set(agents.map(a => a.category || 'Other'))).map(category => {
                  const categoryAgents = agents.filter(a => (a.category || 'Other') === category);
                  const categoryKo = categoryAgents[0]?.category_ko || '기타';
                  return (
                    <AccordionItem key={category} value={category} className="border-b-0">
                      <AccordionTrigger className="py-2 text-sm font-semibold hover:no-underline">
                        {language === 'ko' ? categoryKo : category}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 pb-2">
                        {categoryAgents.map(agent => (
                          <div key={agent.key} className="flex items-start gap-2">
                            <Checkbox
                              id={`sb-agent-${agent.key}`}
                              checked={selectedAgents.has(agent.key)}
                              onCheckedChange={() => handleToggleAgent(agent.key)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <label htmlFor={`sb-agent-${agent.key}`} className="text-sm cursor-pointer leading-tight">
                                {getAgentDisplayName(agent, language)}
                              </label>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">
                                {getAgentDescription(agent, language)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>

            {/* Run Button */}
            <Button
              className="w-full"
              onClick={isRunning ? handleStop : handleRun}
              disabled={!canRun && !isRunning}
              variant={isRunning ? 'destructive' : 'default'}
            >
              {isRunning
                ? <><Square className="h-4 w-4 mr-2" />{t('stopButton', language)}</>
                : <><Play className="h-4 w-4 mr-2" />{overrideCount > 0
                    ? `${t('runWithOverrides', language)} (${overrideCount})`
                    : t('runAnalysisButton', language)}</>
              }
            </Button>
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!fetchedData && !isFetching && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-3">
                <Database size={48} className="mx-auto opacity-20" />
                <p className="text-sm">
                  {t('fetchFirst', language)}
                </p>
              </div>
            </div>
          )}

          {isFetching && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-3">
                <Loader2 size={36} className="mx-auto animate-spin opacity-40" />
                <p className="text-sm">
                  {t('fetchingData', language)}
                </p>
              </div>
            </div>
          )}

          {fetchedData && !isFetching && (
            <>
              {/* View Tabs */}
              <div className="flex border-b flex-shrink-0">
                {VIEW_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setViewTab(tab.key)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
                      ${viewTab === tab.key
                        ? 'border-blue-500 text-blue-500'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                      }
                      ${tab.key === 'results' && agentResults.size === 0 && !isRunning ? 'opacity-40' : ''}
                    `}
                  >
                    {t(tab.labelKey, language)}
                    {tab.key === 'metrics' && overrideCount > 0 && (
                      <span className="ml-1.5 text-[10px] bg-blue-500/20 text-blue-400 px-1 rounded">
                        {overrideCount}
                      </span>
                    )}
                    {tab.key === 'results' && agentResults.size > 0 && (
                      <span className="ml-1.5 text-[10px] bg-muted px-1 rounded">
                        {agentResults.size}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto">

                {/* METRICS TAB */}
                {viewTab === 'metrics' && (
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground mb-3">
                      {t('overrideInstruction', language)}
                    </p>
                    <MetricsGrid
                      metrics={fetchedData.metrics || {}}
                      overrides={metricsOverrides}
                      onOverrideChange={handleMetricOverride}
                      language={language}
                      lineItemsOverrides={lineItemsOverrides}
                    />
                  </div>
                )}

                {/* LINE ITEMS TAB */}
                {viewTab === 'line-items' && (
                  <div className="p-4 space-y-4">
                    <p className="text-xs text-muted-foreground mb-3">
                      {t('lineItemsDescription', language)}
                    </p>
                    {lineItemsOverrides.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('noLineItems', language)}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {lineItemsOverrides.map((row, rowIdx) => (
                          <section key={rowIdx} className="rounded-md border bg-background">
                            <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
                              <span className="text-xs font-medium text-muted-foreground">
                                {t('periodColumn', language)}
                              </span>
                              <span className="font-mono text-xs text-foreground">
                                {String(row.report_period || '').slice(0, 10)}
                              </span>
                            </div>
                            <table className="w-full table-fixed text-xs">
                              <thead>
                                <tr className="border-b text-muted-foreground">
                                  <th className="w-1/2 px-3 py-1.5 text-left font-medium">
                                    {t('metricsField', language)}
                                  </th>
                                  <th className="w-1/2 px-3 py-1.5 text-right font-medium">
                                    {t('overrideValue', language)}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {LINE_ITEM_FIELDS.map(field => {
                                  const originalVal = fetchedData.line_items[rowIdx]?.[field];
                                  const currentVal = row[field];
                                  const isChanged = currentVal !== originalVal;
                                  const { mismatch } = rowIdx === 0
                                    ? compareOverrideVsLineItem0(
                                        metricsOverrides[field] ?? '',
                                        currentVal,
                                        fetchedData.metrics?.[field],
                                      )
                                    : { mismatch: false };
                                  return (
                                    <tr key={field} className="border-b border-dashed last:border-b-0 hover:bg-muted/20">
                                      <td className="w-1/2 px-3 py-1.5 text-foreground">
                                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                          {rowIdx === 0 && mismatch && (
                                            <span title={t('mismatchBadgeTitle', language)} className="inline-flex">
                                              <AlertCircle
                                                size={12}
                                                className="text-yellow-500 flex-shrink-0"
                                              />
                                            </span>
                                          )}
                                          <span>{getFinancialFieldLabel(field, language)}</span>
                                          <span className="break-all text-[10px] text-muted-foreground/50">{field}</span>
                                        </div>
                                      </td>
                                      <td className="w-1/2 px-3 py-1.5 text-right">
                                        <input
                                          type="number"
                                          step="any"
                                          value={currentVal ?? ''}
                                          onChange={e => handleLineItemOverride(rowIdx, field, e.target.value)}
                                          className={`w-full max-w-56 text-right text-xs bg-transparent border rounded px-2 py-1 font-mono
                                            focus:outline-none focus:ring-1 focus:ring-blue-500
                                            ${isChanged ? 'border-blue-500/60 text-blue-400' : 'border-border'}`}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* TRENDS TAB */}
                {viewTab === 'trends' && (
                  <div className="p-4">
                    <Suspense fallback={
                      <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        {t('loadingCharts', language)}
                      </div>
                    }>
                      <TrendCharts
                        prices={fetchedData.prices || []}
                        ticker={fetchedData.ticker}
                        language={language}
                      />
                    </Suspense>
                  </div>
                )}

                {/* RESULTS TAB */}
                {viewTab === 'results' && (
                  <div className="p-4 space-y-3">
                    {runError && (
                      <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
                        {runError}
                      </div>
                    )}

                    {agentResults.size === 0 && !isRunning && (
                      <div className="flex items-center justify-center h-40 text-muted-foreground">
                        <div className="text-center space-y-2">
                          <Bot size={36} className="mx-auto opacity-20" />
                          <p className="text-sm">
                            {t('selectAgentsAndRun', language)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Agent cards */}
                    {Array.from(agentResults.values()).map(result => (
                      <div key={result.agentKey} className="border rounded-lg p-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <Bot size={14} className={statusColor(result.status)} />
                          <span className="text-sm font-medium">{result.agentName}</span>
                          <span className={`ml-auto text-xs font-medium ${statusColor(result.status)}`}>
                            {result.status === 'running' && (
                              <Loader2 size={11} className="inline animate-spin mr-1" />
                            )}
                            {statusLabel(result.status)}
                          </span>
                        </div>
                        {result.signal && (
                          <div className="flex gap-3 text-xs text-muted-foreground pl-5">
                            <span className={`font-medium ${signalClass(result.signal)}`}>
                              {result.signal}
                            </span>
                            {result.confidence !== undefined && (
                              <span>
                                {t('confidence', language)}:{' '}
                                {Math.round((result.confidence <= 1 ? result.confidence * 100 : result.confidence))}%
                              </span>
                            )}
                          </div>
                        )}
                        {result.reasoning && (
                          <p className="text-xs text-muted-foreground pl-5 line-clamp-3">
                            {result.reasoning}
                          </p>
                        )}
                      </div>
                    ))}

                    {/* Final Decision */}
                    {completeResult?.decisions && (
                      <div className="border border-green-500/30 rounded-lg p-4 bg-green-500/5">
                        <h3 className="text-sm font-semibold text-green-600 dark:text-green-400 mb-3">
                          {t('finalDecision', language)}
                        </h3>
                        {Object.entries(completeResult.decisions).map(([tkr, decision]: [string, any]) => (
                          <div key={tkr} className="flex items-center gap-3 text-sm">
                            <span className="font-mono font-bold">{tkr}</span>
                            <span className={`font-medium uppercase ${signalClass(decision.action)}`}>
                              {decision.action}
                            </span>
                            {decision.confidence !== undefined && (
                              <span className="text-muted-foreground text-xs">
                                {Math.round((decision.confidence <= 1 ? decision.confidence * 100 : decision.confidence))}%
                              </span>
                            )}
                            {decision.reasoning && (
                              <span className="text-xs text-muted-foreground flex-1 line-clamp-2">
                                {decision.reasoning}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
