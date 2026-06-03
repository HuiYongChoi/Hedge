import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveTickerValue } from '@/components/ui/ticker-input';
import { useLanguage } from '@/contexts/language-context';
import { buildValuationDeepDive } from '@/components/reports/analyst-report-v5/helpers';
import type { ValuationDeepDive, ValuationModel } from '@/components/reports/analyst-report-v5/types';
import { getDefaultModel } from '@/data/models';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import { Archive, Network, Plus, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

const MAX_SLOTS = 6;
const DEFAULT_COMPARE_TICKERS = ['MU', 'SK하이닉스', '삼성전자'];
const STORAGE_KEY = 'stock-compare:slots';

// Preferred valuation-model row order; any extra model keys are appended dynamically
// so newly added backend methods (e.g. EBITDA-normalized, ROIC-WACC EVA) show up
// automatically without editing this file.
const PREFERRED_MODEL_ORDER = [
  'dcf',
  'owner_earnings',
  'ev_ebitda',
  'ev_ebit',
  'ebitda_valuation',
  'roic_wacc_valuation',
  'residual_income',
  'pbr_band',
];

interface PricePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerSuggestion {
  ticker: string;
  name: string;
  market?: string;
}

interface CompareSlot {
  id: string;
  ticker: string;
  status: 'empty' | 'loading' | 'ready' | 'error';
  metrics?: Record<string, any>;
  prices?: PricePoint[];
  lineItems?: Record<string, any>[];
  currentPrice?: number | null;
  valuation?: ValuationDeepDive | null;
  signal?: { signal: string; confidence: number } | null;
  error?: string;
  progressMessage?: string;
}

type ChartMetricKey = 'relative_price' | 'eps' | 'free_cash_flow' | 'operating_income_growth' | 'liabilities_to_equity';
type ChartWindow = '3m' | '1y' | '3y' | '5y' | 'all';
type ChartAxisMode = 'normalized' | 'actual';

const COMPARISON_CHART_METRICS: Array<{
  key: ChartMetricKey;
  ko: string;
  en: string;
  unit?: string;
}> = [
  { key: 'relative_price', ko: '상대 가격', en: 'Relative price', unit: '%' },
  { key: 'eps', ko: 'EPS', en: 'EPS' },
  { key: 'free_cash_flow', ko: 'FCF', en: 'FCF' },
  { key: 'operating_income_growth', ko: '영업이익상승률', en: 'Operating income growth', unit: '%' },
  { key: 'liabilities_to_equity', ko: '부채비율', en: 'Debt ratio', unit: '%' },
];

const FINANCIAL_ROWS: Array<{ key: string; ko: string; en: string; percent?: boolean }> = [
  { key: 'currentPrice', ko: '현재가', en: 'Current price' },
  { key: 'price_to_earnings_ratio', ko: 'PER (TTM)', en: 'P/E (TTM)' },
  { key: 'price_to_book_ratio', ko: 'PBR', en: 'P/B' },
  { key: 'enterprise_value_to_ebitda_ratio', ko: 'EV/EBITDA', en: 'EV/EBITDA' },
  { key: 'operating_margin', ko: '영업이익률', en: 'Operating margin', percent: true },
  { key: 'net_margin', ko: '순이익률', en: 'Net margin', percent: true },
  { key: 'return_on_equity', ko: 'ROE', en: 'ROE', percent: true },
  { key: 'return_on_invested_capital', ko: 'ROIC', en: 'ROIC', percent: true },
  { key: 'revenue_growth', ko: '매출 성장', en: 'Revenue growth', percent: true },
  { key: 'earnings_growth', ko: '이익 성장', en: 'Earnings growth', percent: true },
  { key: 'liabilities_to_equity', ko: '부채비율', en: 'Debt ratio', percent: true },
  { key: 'debt_to_equity', ko: '이자부채비율', en: 'Debt/Equity (int)' },
  { key: 'interest_coverage', ko: '이자보상배율', en: 'Interest coverage' },
];

function fmtNum(value: unknown, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function toneClass(signal: string | null | undefined): string {
  if (signal === 'bullish') return 'text-emerald-500';
  if (signal === 'bearish') return 'text-red-500';
  return 'text-muted-foreground';
}

function newSlot(ticker = ''): CompareSlot {
  return {
    id: Math.random().toString(36).slice(2, 9),
    ticker,
    status: ticker ? 'empty' : 'empty',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function fiveYearsAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function normalizeCompareToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function stripKoreanCompanySuffix(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(주\)\s*$/i, '')
    .replace(/\s*주식회사\s*$/i, '')
    .trim();
}

function findExactTickerSuggestion(term: string, suggestions: TickerSuggestion[]): TickerSuggestion | null {
  const normalizedTerm = normalizeCompareToken(stripKoreanCompanySuffix(term));
  if (!normalizedTerm) return null;

  return suggestions.find(suggestion => {
    const candidates = [
      suggestion.ticker,
      suggestion.name,
      stripKoreanCompanySuffix(suggestion.name),
    ].map(normalizeCompareToken);
    return candidates.includes(normalizedTerm);
  }) ?? null;
}

export function StockCompareTab() {
  const { language } = useLanguage();
  const [slots, setSlots] = useState<CompareSlot[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const tickers: string[] = JSON.parse(raw);
        if (Array.isArray(tickers) && tickers.length > 0) {
          return tickers.slice(0, MAX_SLOTS).map(tk => newSlot(tk));
        }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_COMPARE_TICKERS.map(ticker => newSlot(ticker));
  });
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingComparison, setIsSavingComparison] = useState(false);
  const [chartMetricKey, setChartMetricKey] = useState<ChartMetricKey>('relative_price');
  const [chartWindow, setChartWindow] = useState<ChartWindow>('1y');
  const [chartAxisMode, setChartAxisMode] = useState<ChartAxisMode>('normalized');
  const abortRef = useRef<AbortController | null>(null);

  // Persist ticker list (content excluded), mirroring the tabs-context pattern.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(slots.map(s => s.ticker).filter(Boolean)),
      );
    } catch {
      /* ignore */
    }
  }, [slots]);

  const updateSlot = useCallback((id: string, patch: Partial<CompareSlot>) => {
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const handleTickerChange = (id: string, value: string) => {
    updateSlot(id, { ticker: value.toUpperCase() });
  };

  const addSlot = () => {
    setSlots(prev => (prev.length >= MAX_SLOTS ? prev : [...prev, newSlot()]));
  };

  const removeSlot = (id: string) => {
    setSlots(prev => (prev.length <= 1 ? prev : prev.filter(s => s.id !== id)));
    if (baselineId === id) setBaselineId(null);
  };

  const fetchMetricsFor = useCallback(async (ticker: string, signal: AbortSignal) => {
    const commonBody = { ticker, start_date: fiveYearsAgoIso(), end_date: todayIso(), limit: 10 };
    const [ttmResponse, annualResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/hedge-fund/fetch-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commonBody),
        signal,
      }),
      fetch(`${API_BASE_URL}/hedge-fund/fetch-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonBody, period: 'annual' }),
        signal,
      }),
    ]);
    if (!ttmResponse.ok) throw new Error(`HTTP ${ttmResponse.status}`);

    const ttmData = await ttmResponse.json();
    if (!annualResponse.ok) {
      return ttmData;
    }

    const annualData = await annualResponse.json();
    return {
      ...ttmData,
      annual_line_items: annualData.line_items || [],
    };
  }, []);

  const resolveCompareTicker = useCallback(async (input: string, signal: AbortSignal): Promise<string> => {
    const strippedInput = stripKoreanCompanySuffix(input);
    const staticResolved = resolveTickerValue(strippedInput);
    if (staticResolved !== strippedInput) {
      return staticResolved.toUpperCase();
    }

    const response = await fetch(`${API_BASE_URL}/ticker-search?q=${encodeURIComponent(strippedInput)}`, { signal });
    if (!response.ok) {
      return staticResolved.toUpperCase();
    }

    const suggestions: TickerSuggestion[] = await response.json();
    const exact = findExactTickerSuggestion(strippedInput, suggestions);
    return (exact?.ticker || staticResolved).toUpperCase();
  }, []);

  const runValuationForTicker = useCallback(async (
    resolvedTicker: string,
    displayTicker: string,
    slotId: string,
    signal: AbortSignal,
  ) => {
    const model = await getDefaultModel();
    const suffix = Math.random().toString(36).slice(2, 8);
    const pmId = `portfolio_manager_${suffix}`;
    const valuationNodeId = `valuation_analyst_${suffix}`;
    const graphNodes = [
      {
        id: valuationNodeId,
        type: 'agent-node',
        data: { name: 'Valuation', description: 'valuation', status: 'Idle' },
        position: { x: 0, y: 0 },
      },
      { id: pmId, type: 'portfolio-manager-node', data: { name: 'Portfolio Manager', status: 'IDLE' }, position: { x: 0, y: 0 } },
    ];
    const graphEdges = [{ id: 'e-val-pm', source: valuationNodeId, target: pmId }];
    const agentModels = model
      ? [
          { agent_id: valuationNodeId, model_name: model.model_name, model_provider: model.provider },
          { agent_id: pmId, model_name: model.model_name, model_provider: model.provider },
        ]
      : [];

    const body: Record<string, any> = {
      tickers: [resolvedTicker],
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      agent_models: agentModels,
      start_date: oneYearAgoIso(),
      end_date: todayIso(),
      language,
    };

    const response = await fetch(`${API_BASE_URL}/hedge-fund/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No reader');

    const decoder = new TextDecoder();
    let buffer = '';
    let complete: any = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const eventText of events) {
        if (!eventText.trim()) continue;
        const typeMatch = eventText.match(/^event: (.+)$/m);
        const dataMatch = eventText.match(/^data: (.+)$/m);
        if (!typeMatch || !dataMatch) continue;
        if (typeMatch[1] === 'progress') {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            if (parsed.ticker && String(parsed.ticker).toUpperCase() !== resolvedTicker.toUpperCase()) continue;
            const status = parsed.status || (language === 'ko' ? '분석 중' : 'Running');
            updateSlot(slotId, { progressMessage: `${displayTicker} · ${status}` });
          } catch {
            /* ignore */
          }
        }
        if (typeMatch[1] === 'complete') {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            complete = parsed.data || parsed;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return complete;
  }, [language, updateSlot]);

  const runComparison = useCallback(async () => {
    const active = slots.filter(s => s.ticker.trim());
    if (active.length === 0 || isRunning) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);

    setSlots(prev => prev.map(s => (s.ticker.trim() ? {
      ...s,
      status: 'loading',
      error: undefined,
      progressMessage: language === 'ko' ? '대기 중' : 'Queued',
      valuation: null,
      signal: null,
    } : s)));

    const runSlot = async (slot: CompareSlot) => {
      const displayTicker = slot.ticker.trim();
      try {
        updateSlot(slot.id, { progressMessage: language === 'ko' ? `${displayTicker} · 티커 확인 중` : `${displayTicker} · Resolving ticker` });
        const resolvedTicker = await resolveCompareTicker(displayTicker, controller.signal);
        updateSlot(slot.id, { progressMessage: language === 'ko' ? `${displayTicker} · 재무 데이터 수집 중` : `${displayTicker} · Loading metrics` });
        const data = await fetchMetricsFor(resolvedTicker, controller.signal);
        const prices: PricePoint[] = data.prices || [];
        const currentPrice = prices.length ? prices[prices.length - 1].close : null;
        updateSlot(slot.id, {
          metrics: data.metrics || {},
          prices,
          lineItems: data.annual_line_items || data.line_items || [],
          currentPrice,
          status: 'loading',
          progressMessage: language === 'ko' ? `${displayTicker} · 가치평가 실행 중` : `${displayTicker} · Running valuation`,
        });

        try {
          const complete = await runValuationForTicker(resolvedTicker, displayTicker, slot.id, controller.signal);
          const analystSignals: Record<string, any> = complete?.analyst_signals || {};
          const valuationKey = Object.keys(analystSignals).find(k => k.startsWith('valuation_analyst'));
          const valuationByTicker = valuationKey ? analystSignals[valuationKey] : {};
          const entry = valuationByTicker?.[resolvedTicker] ?? valuationByTicker?.[displayTicker];
          if (!entry) throw new Error('valuation result missing');

          updateSlot(slot.id, {
            valuation: buildValuationDeepDive({ reasoning: entry.reasoning } as any, currentPrice),
            signal: { signal: entry.signal, confidence: entry.confidence },
            status: 'ready',
            progressMessage: language === 'ko' ? `${displayTicker} · 완료` : `${displayTicker} · Complete`,
          });
        } catch (err: any) {
          if (controller.signal.aborted) return;
          updateSlot(slot.id, {
            status: 'error',
            error: err?.message || 'valuation failed',
            progressMessage: language === 'ko'
              ? `${displayTicker} · 재무 데이터 완료, 가치평가 실패`
              : `${displayTicker} · metrics loaded; valuation failed`,
          });
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        updateSlot(slot.id, {
          status: 'error',
          error: err?.message || 'fetch failed',
          progressMessage: language === 'ko' ? `${displayTicker} · 데이터 수집 실패` : `${displayTicker} · Metrics failed`,
        });
      }
    };

    await Promise.allSettled(active.map(runSlot));
    if (!controller.signal.aborted) {
      setIsRunning(false);
    }
  }, [slots, isRunning, fetchMetricsFor, resolveCompareTicker, runValuationForTicker, updateSlot, language]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const readySlots = slots.filter(s => s.ticker.trim());

  // Union of valuation model keys across all slots, in preferred order then extras.
  const modelKeys = useMemo(() => {
    const present = new Set<string>();
    readySlots.forEach(s => s.valuation?.models.forEach(m => present.add(m.key)));
    const ordered = PREFERRED_MODEL_ORDER.filter(k => present.has(k));
    const extras = [...present].filter(k => !PREFERRED_MODEL_ORDER.includes(k));
    return [...ordered, ...extras];
  }, [readySlots]);

  const modelLabel = (key: string): string => {
    for (const s of readySlots) {
      const m = s.valuation?.models.find(mm => mm.key === key);
      if (m) return m.labelKey;
    }
    return key;
  };

  const findModel = (slot: CompareSlot, key: string): ValuationModel | undefined =>
    slot.valuation?.models.find(m => m.key === key);

  const handleSaveComparison = useCallback(async () => {
    if (isSavingComparison) return;
    const comparedSlots = slots.filter(slot => slot.ticker.trim());
    if (comparedSlots.length === 0) return;

    const now = new Date().toISOString();
    const tickers = comparedSlots.map(slot => slot.ticker.trim());
    const displayName = `${tickers.join(' vs ')} 비교`;

    setIsSavingComparison(true);
    try {
      await savedAnalysisService.saveAnalysis(
        'stock_compare',
        tickers.join(', '),
        language,
        {
          tickers,
          baseline_ticker: comparedSlots.find(slot => slot.id === baselineId)?.ticker ?? null,
          saved_at: now,
        },
        {
          slots: comparedSlots,
          model_keys: modelKeys,
          financial_rows: FINANCIAL_ROWS,
          baseline_id: baselineId,
          saved_at: now,
        },
        displayName,
      );
      alert(language === 'ko' ? '비교 데이터가 아카이브에 저장되었습니다.' : 'Comparison saved to archive.');
    } catch (err: any) {
      alert(err?.message || (language === 'ko' ? '저장에 실패했습니다.' : 'Save failed.'));
    } finally {
      setIsSavingComparison(false);
    }
  }, [baselineId, isSavingComparison, language, modelKeys, slots]);

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-7xl p-4 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <Network size={18} className="text-primary" />
          <h2 className="text-lg font-semibold">{t('stockCompare', language)}</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveComparison}
              disabled={isSavingComparison || readySlots.length === 0}
            >
              <Archive size={14} className="mr-1" />
              {language === 'ko' ? '아카이브 추가' : 'Save Archive'}
            </Button>
            <Button size="sm" variant="outline" onClick={addSlot} disabled={slots.length >= MAX_SLOTS}>
              <Plus size={14} className="mr-1" />{t('compareAddTicker', language)}
            </Button>
            <Button size="sm" onClick={runComparison} disabled={isRunning || readySlots.length === 0}>
              <RefreshCw size={14} className={cn('mr-1', isRunning && 'animate-spin')} />{t('compareRun', language)}
            </Button>
          </div>
        </div>

        {/* Ticker slot inputs */}
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
          {slots.map(slot => (
            <div key={slot.id} className="relative rounded-lg border bg-muted/10 p-2">
              <div className="flex items-center gap-1">
                <Input
                  value={slot.ticker}
                  placeholder={t('compareEmptySlot', language)}
                  onChange={e => handleTickerChange(slot.id, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runComparison(); }}
                  className="h-8 text-sm"
                />
                {slots.length > 1 && (
                  <button
                    onClick={() => removeSlot(slot.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove slot"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {slot.status === 'error' && (
                <div className="mt-1 text-[10px] text-red-500">{slot.error}</div>
              )}
              {slot.progressMessage && (
                <div className={cn(
                  'mt-1 truncate text-[10px]',
                  slot.status === 'error' ? 'text-red-500' : slot.status === 'ready' ? 'text-emerald-500' : 'text-muted-foreground',
                )}>
                  <span className="sr-only">compareStatus</span>
                  {slot.progressMessage}
                </div>
              )}
              {slot.signal && (
                <button
                  onClick={() => setBaselineId(slot.id)}
                  className={cn(
                    'mt-1 w-full rounded px-1 py-0.5 text-[10px] font-semibold',
                    baselineId === slot.id ? 'ring-1 ring-primary' : '',
                    toneClass(slot.signal.signal),
                  )}
                  title={t('compareBaseline', language)}
                >
                  {slot.signal.signal?.toUpperCase()} · {slot.signal.confidence}
                </button>
              )}
            </div>
          ))}
        </div>

        {readySlots.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t('comparePlaceholder', language)}
          </div>
        ) : (
          <>
            <CurrentPriceSummary slots={readySlots} language={language} />

            {/* Valuation comparison matrix */}
            <section className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">{t('compareValuationMatrix', language)}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Model</th>
                      {readySlots.map(s => (
                        <th key={s.id} className="px-3 py-2 text-right">{s.ticker || '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modelKeys.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-xs text-muted-foreground" colSpan={readySlots.length + 1}>
                          {t('compareNoData', language)}
                        </td>
                      </tr>
                    ) : modelKeys.map(key => (
                      <tr key={key} className="border-t">
                        <td className="px-3 py-2 text-xs">{modelLabel(key)}</td>
                        {readySlots.map(s => {
                          const m = findModel(s, key);
                          return (
                            <td key={s.id} className="px-3 py-2 text-right font-mono">
                              {m ? (
                                <span className={toneClass(m.signal)}>
                                  {fmtCurrency(m.intrinsicPerShare)}
                                  <span className="ml-1 text-[10px]">
                                    {m.gapToMarket !== null && m.gapToMarket !== undefined
                                      ? `(${fmtPercent(m.gapToMarket)})`
                                      : ''}
                                  </span>
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/20">
                      <td className="px-3 py-2 text-xs font-semibold">{t('compareWeightedSignal', language)}</td>
                      {readySlots.map(s => (
                        <td key={s.id} className={cn('px-3 py-2 text-right font-mono font-semibold', toneClass(s.signal?.signal))}>
                          {s.signal ? `${s.signal.signal?.toUpperCase()} ${s.signal.confidence}` : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Financial metrics comparison */}
            <section className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">{t('compareFinancials', language)}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">{language === 'ko' ? '지표' : 'Metric'}</th>
                      {readySlots.map(s => (
                        <th key={s.id} className="px-3 py-2 text-right">{s.ticker || '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FINANCIAL_ROWS.map(row => (
                      <tr key={row.key} className="border-t">
                        <td className="px-3 py-2 text-xs">{language === 'ko' ? row.ko : row.en}</td>
                        {readySlots.map(s => {
                          const v = row.key === 'currentPrice' ? s.currentPrice : s.metrics?.[row.key];
                          return (
                            <td key={s.id} className="px-3 py-2 text-right font-mono">
                              {row.key === 'currentPrice' ? fmtCurrency(v as number | null) : row.percent ? fmtPercent(v) : fmtNum(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Financial charts comparison (normalized price overlay) */}
            <section className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <div className="text-sm font-medium">{t('compareCharts', language)}</div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <select
                    value={chartMetricKey}
                    onChange={event => setChartMetricKey(event.target.value as ChartMetricKey)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label={language === 'ko' ? '차트 지표' : 'Chart metric'}
                  >
                    {COMPARISON_CHART_METRICS.map(metric => (
                      <option key={metric.key} value={metric.key}>{language === 'ko' ? metric.ko : metric.en}</option>
                    ))}
                  </select>
                  <select
                    value={chartWindow}
                    onChange={event => setChartWindow(event.target.value as ChartWindow)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label={language === 'ko' ? '차트 기간' : 'Chart window'}
                  >
                    <option value="3m">{language === 'ko' ? '3개월' : '3M'}</option>
                    <option value="1y">{language === 'ko' ? '1년' : '1Y'}</option>
                    <option value="3y">{language === 'ko' ? '3년' : '3Y'}</option>
                    <option value="5y">{language === 'ko' ? '5년' : '5Y'}</option>
                    <option value="all">{language === 'ko' ? '전체' : 'All'}</option>
                  </select>
                  <select
                    value={chartAxisMode}
                    onChange={event => setChartAxisMode(event.target.value as ChartAxisMode)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label={language === 'ko' ? '세로축 모드' : 'Axis mode'}
                  >
                    <option value="normalized">{language === 'ko' ? '상대축 100' : 'Indexed 100'}</option>
                    <option value="actual">{language === 'ko' ? '실값축' : 'Actual'}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-3 p-3">
                <RelativeComparisonChart
                  slots={readySlots}
                  metricKey={chartMetricKey}
                  chartWindow={chartWindow}
                  chartAxisMode={chartAxisMode}
                  language={language}
                  height={260}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  {COMPARISON_CHART_METRICS.map(metric => (
                    <div key={metric.key} className="rounded-md border bg-muted/5">
                      <RelativeComparisonChart
                        slots={readySlots}
                        metricKey={metric.key}
                        chartWindow={chartWindow}
                        chartAxisMode={metric.key === 'relative_price' ? 'normalized' : chartAxisMode}
                        language={language}
                        compact
                        height={150}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const CHART_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'];

function CurrentPriceSummary({ slots, language }: { slots: CompareSlot[]; language: 'ko' | 'en' }) {
  return (
    <section className="grid gap-2 md:grid-cols-3">
      {slots.map(slot => {
        const prices = (slot.prices || []).filter(p => Number.isFinite(p.close) && p.close > 0);
        const first = prices[0]?.close;
        const last = slot.currentPrice ?? prices[prices.length - 1]?.close ?? null;
        const change = typeof first === 'number' && typeof last === 'number' && first > 0
          ? (last / first) - 1
          : null;
        return (
          <div key={slot.id} className="rounded-lg border bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs text-muted-foreground">{slot.ticker}</div>
              <div className={cn('text-[10px] font-semibold', toneClass(slot.signal?.signal))}>
                {slot.signal ? slot.signal.signal.toUpperCase() : slot.status}
              </div>
            </div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{fmtCurrency(last)}</div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{t('compareCurrentPrice', language)}</span>
              <span className={cn(change !== null && change >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                {change === null ? '—' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function getMetricLabel(metricKey: ChartMetricKey, language: 'ko' | 'en'): string {
  const metric = COMPARISON_CHART_METRICS.find(item => item.key === metricKey);
  return metric ? (language === 'ko' ? metric.ko : metric.en) : metricKey;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function reportDate(item: Record<string, any>): string {
  return String(item.report_period || item.period || item.date || '').slice(0, 10);
}

function windowCutoff(chartWindow: ChartWindow): number | null {
  if (chartWindow === 'all') return null;
  const now = new Date();
  if (chartWindow === '3m') now.setMonth(now.getMonth() - 3);
  if (chartWindow === '1y') now.setFullYear(now.getFullYear() - 1);
  if (chartWindow === '3y') now.setFullYear(now.getFullYear() - 3);
  if (chartWindow === '5y') now.setFullYear(now.getFullYear() - 5);
  return now.getTime();
}

function filterByWindow<T extends { label: string }>(points: T[], chartWindow: ChartWindow): T[] {
  const cutoff = windowCutoff(chartWindow);
  if (cutoff === null) return points;
  return points.filter(point => {
    const ts = new Date(point.label).getTime();
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });
}

function buildMetricPoints(slot: CompareSlot, metricKey: ChartMetricKey, chartWindow: ChartWindow): Array<{ label: string; y: number }> {
  if (metricKey === 'relative_price') {
    const points = (slot.prices || [])
      .filter(p => Number.isFinite(p.close) && p.close > 0)
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(p => ({ label: p.time.slice(0, 10), y: p.close }));
    return filterByWindow(points, chartWindow);
  }

  const items: Array<Record<string, any> & { _label: string }> = (slot.lineItems || [])
    .map(item => ({ ...item, _label: reportDate(item) }))
    .filter((item): item is Record<string, any> & { _label: string } => Boolean(item._label))
    .sort((a, b) => String(a._label).localeCompare(String(b._label)));

  const points = items.map((item, idx) => {
    if (metricKey === 'eps') return { label: item._label, y: numericValue(item.earnings_per_share) };
    if (metricKey === 'free_cash_flow') return { label: item._label, y: numericValue(item.free_cash_flow) };
    if (metricKey === 'liabilities_to_equity') {
      const direct = numericValue(item.liabilities_to_equity);
      if (direct !== null) return { label: item._label, y: direct * 100 };
      const liabilities = numericValue(item.total_liabilities);
      const equity = numericValue(item.shareholders_equity);
      return { label: item._label, y: liabilities !== null && equity !== null && equity !== 0 ? (liabilities / equity) * 100 : null };
    }
    const current = numericValue(item.operating_income);
    const prev = idx > 0 ? numericValue(items[idx - 1].operating_income) : null;
    return {
      label: item._label,
      y: current !== null && prev !== null && prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : null,
    };
  })
    .filter((point): point is { label: string; y: number } => point.y !== null && Number.isFinite(point.y));

  return filterByWindow(points, chartWindow);
}

function fmtAxis(value: number, metricKey: ChartMetricKey, axisMode: ChartAxisMode): string {
  if (axisMode === 'normalized') return value.toFixed(0);
  if (metricKey === 'operating_income_growth' || metricKey === 'liabilities_to_equity') return `${value.toFixed(0)}%`;
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 2);
}

function RelativeComparisonChart({
  slots,
  metricKey,
  chartWindow,
  chartAxisMode,
  language,
  compact = false,
  height = 200,
}: {
  slots: CompareSlot[];
  metricKey: ChartMetricKey;
  chartWindow: ChartWindow;
  chartAxisMode: ChartAxisMode;
  language: 'ko' | 'en';
  compact?: boolean;
  height?: number;
}) {
  const series = slots
    .map((slot, idx) => {
      const rawPoints = buildMetricPoints(slot, metricKey, chartWindow);
      if (rawPoints.length < 2) return null;
      const base = rawPoints.find(point => point.y !== 0)?.y;
      const points = rawPoints.map((point, pointIdx) => ({
        label: point.label,
        x: pointIdx / Math.max(rawPoints.length - 1, 1),
        y: chartAxisMode === 'normalized' && base ? (point.y / base) * 100 : point.y,
      }));
      return { ticker: slot.ticker, color: CHART_COLORS[idx % CHART_COLORS.length], points };
    })
    .filter((x): x is { ticker: string; color: string; points: { label: string; x: number; y: number }[] } => x !== null);

  if (series.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-center text-xs text-muted-foreground" style={{ minHeight: height }}>
        {language === 'ko' ? '표시할 시계열 데이터가 없습니다.' : 'No time-series data to display.'}
      </div>
    );
  }

  const allY = series.flatMap(s => s.points.map(p => p.y));
  const baselineValues = chartAxisMode === 'normalized' ? [100] : [];
  const minY = Math.min(...allY, ...baselineValues);
  const maxY = Math.max(...allY, ...baselineValues);
  const range = maxY - minY || 1;
  const W = 600;
  const H = height;
  const padL = compact ? 34 : 48;
  const padR = 10;
  const padT = 16;
  const padB = compact ? 22 : 34;

  const toSvg = (x: number, y: number) => ({
    sx: padL + x * (W - padL - padR),
    sy: H - padB - ((y - minY) / range) * (H - padT - padB),
  });
  const yTicks = [minY, minY + range / 2, maxY];
  const firstLabel = series[0]?.points[0]?.label;
  const lastPoints = series[0]?.points;
  const lastLabel = lastPoints?.[lastPoints.length - 1]?.label;

  return (
    <div className={cn('p-3', compact && 'p-2')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>
          {getMetricLabel(metricKey, language)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {chartAxisMode === 'normalized'
            ? (language === 'ko' ? '시작점 100 기준' : 'Indexed to 100')
            : (language === 'ko' ? '실값' : 'Actual')}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {yTicks.map(tick => {
          const { sy } = toSvg(0, tick);
          return (
            <g key={tick}>
              <line x1={padL} x2={W - padR} y1={sy} y2={sy} stroke="currentColor" strokeOpacity={0.12} />
              <text x={padL - 6} y={sy + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.55">
                {fmtAxis(tick, metricKey, chartAxisMode)}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" strokeOpacity={0.18} />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="currentColor" strokeOpacity={0.18} />
        {series.map(s => {
          const d = s.points
            .map((p, i) => {
              const { sx, sy } = toSvg(p.x, p.y);
              return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
            })
            .join(' ');
          return <path key={s.ticker} d={d} fill="none" stroke={s.color} strokeWidth={1.5} />;
        })}
        {!compact && firstLabel && (
          <text x={padL} y={H - 8} fontSize="9" fill="currentColor" opacity="0.55">{firstLabel}</text>
        )}
        {!compact && lastLabel && (
          <text x={W - padR} y={H - 8} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.55">{lastLabel}</text>
        )}
      </svg>
      <div className={cn('mt-2 flex flex-wrap gap-3', compact && 'gap-2')}>
        {series.map(s => (
          <div key={s.ticker} className="flex items-center gap-1 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.ticker}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {language === 'ko'
            ? '가로축은 선택 기간의 시계열, 세로축은 선택한 상대/실값 모드입니다.'
            : 'X-axis follows the selected time window; Y-axis follows the selected indexed/actual mode.'}
        </div>
      )}
    </div>
  );
}
