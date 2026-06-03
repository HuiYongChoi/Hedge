import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/language-context';
import { buildValuationDeepDive } from '@/components/reports/analyst-report-v5/helpers';
import type { ValuationDeepDive, ValuationModel } from '@/components/reports/analyst-report-v5/types';
import { getDefaultModel } from '@/data/models';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import { Network, Plus, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

const MAX_SLOTS = 6;
const DEFAULT_SLOTS = 3;
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

interface CompareSlot {
  id: string;
  ticker: string;
  status: 'empty' | 'loading' | 'ready' | 'error';
  metrics?: Record<string, any>;
  prices?: PricePoint[];
  currentPrice?: number | null;
  valuation?: ValuationDeepDive | null;
  signal?: { signal: string; confidence: number } | null;
  error?: string;
  progressMessage?: string;
}

const FINANCIAL_ROWS: Array<{ key: string; ko: string; en: string; percent?: boolean }> = [
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
    return Array.from({ length: DEFAULT_SLOTS }, () => newSlot());
  });
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
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
    const response = await fetch(`${API_BASE_URL}/hedge-fund/fetch-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, end_date: todayIso() }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, []);

  const runValuationForTicker = useCallback(async (
    ticker: string,
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
      tickers: [ticker],
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
            if (parsed.ticker && String(parsed.ticker).toUpperCase() !== ticker.toUpperCase()) continue;
            const status = parsed.status || (language === 'ko' ? '분석 중' : 'Running');
            updateSlot(slotId, { progressMessage: `${ticker} · ${status}` });
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
      const ticker = slot.ticker.trim();
      try {
        updateSlot(slot.id, { progressMessage: language === 'ko' ? `${ticker} · 재무 데이터 수집 중` : `${ticker} · Loading metrics` });
        const data = await fetchMetricsFor(ticker, controller.signal);
        const prices: PricePoint[] = data.prices || [];
        const currentPrice = prices.length ? prices[prices.length - 1].close : null;
        updateSlot(slot.id, {
          metrics: data.metrics || {},
          prices,
          currentPrice,
          status: 'loading',
          progressMessage: language === 'ko' ? `${ticker} · 가치평가 실행 중` : `${ticker} · Running valuation`,
        });

        try {
          const complete = await runValuationForTicker(ticker, slot.id, controller.signal);
          const analystSignals: Record<string, any> = complete?.analyst_signals || {};
          const valuationKey = Object.keys(analystSignals).find(k => k.startsWith('valuation_analyst'));
          const valuationByTicker = valuationKey ? analystSignals[valuationKey] : {};
          const entry = valuationByTicker?.[ticker];
          if (!entry) throw new Error('valuation result missing');

          updateSlot(slot.id, {
            valuation: buildValuationDeepDive({ reasoning: entry.reasoning } as any, currentPrice),
            signal: { signal: entry.signal, confidence: entry.confidence },
            status: 'ready',
            progressMessage: language === 'ko' ? `${ticker} · 완료` : `${ticker} · Complete`,
          });
        } catch (err: any) {
          if (controller.signal.aborted) return;
          updateSlot(slot.id, {
            status: 'error',
            error: err?.message || 'valuation failed',
            progressMessage: language === 'ko'
              ? `${ticker} · 재무 데이터 완료, 가치평가 실패`
              : `${ticker} · metrics loaded; valuation failed`,
          });
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        updateSlot(slot.id, {
          status: 'error',
          error: err?.message || 'fetch failed',
          progressMessage: language === 'ko' ? `${ticker} · 데이터 수집 실패` : `${ticker} · Metrics failed`,
        });
      }
    };

    await Promise.allSettled(active.map(runSlot));
    if (!controller.signal.aborted) {
      setIsRunning(false);
    }
  }, [slots, isRunning, fetchMetricsFor, runValuationForTicker, updateSlot, language]);

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

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-7xl p-4 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <Network size={18} className="text-primary" />
          <h2 className="text-lg font-semibold">{t('stockCompare', language)}</h2>
          <div className="ml-auto flex items-center gap-2">
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
                          const v = s.metrics?.[row.key];
                          return (
                            <td key={s.id} className="px-3 py-2 text-right font-mono">
                              {row.percent ? fmtPercent(v) : fmtNum(v)}
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
              <div className="border-b px-3 py-2 text-sm font-medium">{t('compareCharts', language)}</div>
              <PriceComparisonChart slots={readySlots} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const CHART_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'];

function PriceComparisonChart({ slots }: { slots: CompareSlot[] }) {
  const series = slots
    .map((s, idx) => {
      const prices = (s.prices || []).filter(p => Number.isFinite(p.close) && p.close > 0);
      if (prices.length < 2) return null;
      const base = prices[0].close;
      const points = prices.map((p, i) => ({
        x: i / (prices.length - 1),
        y: (p.close / base) * 100,
      }));
      return { ticker: s.ticker, color: CHART_COLORS[idx % CHART_COLORS.length], points };
    })
    .filter((x): x is { ticker: string; color: string; points: { x: number; y: number }[] } => x !== null);

  if (series.length === 0) {
    return <div className="p-6 text-center text-xs text-muted-foreground">No price data</div>;
  }

  const allY = series.flatMap(s => s.points.map(p => p.y));
  const minY = Math.min(...allY, 100);
  const maxY = Math.max(...allY, 100);
  const range = maxY - minY || 1;
  const W = 600;
  const H = 200;
  const pad = 8;

  const toSvg = (x: number, y: number) => ({
    sx: pad + x * (W - 2 * pad),
    sy: H - pad - ((y - minY) / range) * (H - 2 * pad),
  });

  return (
    <div className="p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
        {series.map(s => {
          const d = s.points
            .map((p, i) => {
              const { sx, sy } = toSvg(p.x, p.y);
              return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
            })
            .join(' ');
          return <path key={s.ticker} d={d} fill="none" stroke={s.color} strokeWidth={1.5} />;
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map(s => (
          <div key={s.ticker} className="flex items-center gap-1 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.ticker}
          </div>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">Normalized to 100 at series start</div>
    </div>
  );
}
