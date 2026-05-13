import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ui/llm-selector';
import { resolveTickerValue, TickerInput } from '@/components/ui/ticker-input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  normalizeReportOrderedMarkers,
  ReportSentimentDashboard,
  renderReportTonedContent,
  sortReportSentimentLines,
} from '@/components/reports/report-sentiment-dashboard';
import { useLanguage } from '@/contexts/language-context';
import { Agent, getAgents } from '@/data/agents';
import { getDefaultModel, getModels, LanguageModel } from '@/data/models';
import { extractBaseAgentKey } from '@/components/ui/agent-formula-tooltip';
import { useToastManager } from '@/hooks/use-toast-manager';
import { t } from '@/lib/language-preferences';
import { MetricsGrid, parseOverrideInput, compareOverrideVsLineItem0, getFinancialFieldLabel } from './data-sandbox/metrics-grid';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import { AlertCircle, ChevronDown, ChevronRight, Database, Loader2, Play, RefreshCw, Square, Bot } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { buildDataSandboxOverrideSnapshot, saveDataSandboxOverrideSnapshot } from '@/lib/data-sandbox-overrides';

const TrendCharts = lazy(() =>
  import('./data-sandbox/trend-charts').then(m => ({ default: m.TrendCharts }))
);

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

// ── Types ──────────────────────────────────────────────────────────────────

interface QuarterlyEPS {
  period: string;
  fiscal_period_end: string;
  eps: number;
  source: string;
  provider?: string | null;
  as_of?: string | null;
  analyst_count?: number | null;
}

interface AnnualEPSEstimate {
  fiscal_year: number;
  fiscal_year_end: string;
  eps: number;
  source: string;
  provider: string;
  as_of: string;
  analyst_count?: number | null;
  dispersion?: number | null;
  confidence?: string | null;
}

interface ForwardMetrics {
  ticker: string;
  as_of_date: string;
  current_price: number | null;
  forward_eps_ttm: number | null;
  forward_pe: number | null;
  composition: QuarterlyEPS[];
  confidence: string;
  notes: string[];
  // Annual FY0 / FY+1 (optional — only present when annual consensus available)
  forward_eps_fy0?: number | null;
  forward_pe_fy0?: number | null;
  fy0_estimate?: AnnualEPSEstimate | null;
  forward_eps_fy1?: number | null;
  forward_pe_fy1?: number | null;
  fy1_estimate?: AnnualEPSEstimate | null;
  annual_estimates?: AnnualEPSEstimate[];
}

interface FetchedData {
  ticker: string;
  metrics: Record<string, any>;
  forward_metrics: ForwardMetrics | null;
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

interface DataSandboxTabProps {
  isTabActive?: boolean;
  tabId?: string;
}

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

function fmtRatio(v: any): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${n.toFixed(2)}x`;
}

function fmtDate(v: any): string {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

function fmtInputNumber(v: any): string {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

function confidenceBadgeClass(confidence?: string): string {
  switch ((confidence || '').toLowerCase()) {
    case 'high':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
    case 'medium':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-400';
  }
}

function sourceBadgeClass(source?: string): string {
  switch ((source || '').toLowerCase()) {
    case 'actual':
      return 'bg-blue-500/10 text-blue-500';
    case 'consensus':
      return 'bg-emerald-500/10 text-emerald-500';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function previewText(value: string, maxLength = 180): string {
  // markdown 기호 제거 후 미리보기
  const stripped = value
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength).trimEnd()}...` : stripped;
}

// LLM 출력 마크다운을 JSX로 렌더링
function renderMarkdown(text: string): React.ReactNode {
  const lines = normalizeReportOrderedMarkers(sortReportSentimentLines(text)).split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,3}\s+/.test(line)) {
      const content = line.replace(/^#{1,3}\s+/, '');
      nodes.push(
        <p key={i} className="font-semibold text-xs text-foreground mt-2 mb-0.5">
          {renderInline(content)}
        </p>
      );
    } else if (/^[-*]\s+/.test(line)) {
      nodes.push(
        <p key={i} className="text-xs text-muted-foreground ml-2">
          {'• '}{renderReportTonedContent(line.replace(/^[-*]\s+/, ''), renderInline)}
        </p>
      );
    } else if (line.trim() === '') {
      nodes.push(<div key={i} className="h-1" />);
    } else {
      nodes.push(
        <p key={i} className="text-xs text-muted-foreground">
          {renderReportTonedContent(line, renderInline)}
        </p>
      );
    }
    i++;
  }
  return <div className="space-y-0.5">{nodes}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function ForwardMetricsCard({
  forwardMetrics,
  language,
  forwardPeOverride,
  isForwardPeOverridden,
  onForwardPeOverrideChange,
  onForwardPeOverrideReset,
  forwardPeFy0Override,
  isForwardPeFy0Overridden,
  onForwardPeFy0OverrideChange,
  onForwardPeFy0OverrideReset,
  forwardPeFy1Override,
  isForwardPeFy1Overridden,
  onForwardPeFy1OverrideChange,
  onForwardPeFy1OverrideReset,
}: {
  forwardMetrics: ForwardMetrics | null | undefined;
  language: string;
  forwardPeOverride: string;
  isForwardPeOverridden: boolean;
  onForwardPeOverrideChange: (value: string) => void;
  onForwardPeOverrideReset: () => void;
  forwardPeFy0Override: string;
  isForwardPeFy0Overridden: boolean;
  onForwardPeFy0OverrideChange: (value: string) => void;
  onForwardPeFy0OverrideReset: () => void;
  forwardPeFy1Override: string;
  isForwardPeFy1Overridden: boolean;
  onForwardPeFy1OverrideChange: (value: string) => void;
  onForwardPeFy1OverrideReset: () => void;
}) {
  const isKo = language === 'ko';

  if (!forwardMetrics) {
    return (
      <section className="rounded-xl border border-dashed bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Forward PER</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isKo
                ? '컨센서스 EPS를 만들 수 없어서 이번 조회에는 forward 지표가 비어 있습니다.'
                : 'Forward metrics are not available for this fetch.'}
            </p>
          </div>
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            unavailable
          </span>
        </div>
      </section>
    );
  }

  const actualCount = forwardMetrics.composition.filter(q => q.source === 'actual').length;
  const consensusCount = forwardMetrics.composition.filter(q => q.source === 'consensus').length;

  return (
    <section className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-background to-cyan-500/5 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Forward PER</p>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidenceBadgeClass(forwardMetrics.confidence)}`}>
              {forwardMetrics.confidence || 'low'} confidence
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isKo
              ? `최근 실제 EPS ${actualCount}개와 컨센서스 ${consensusCount}개를 합성한 forward TTM입니다.`
              : `Forward TTM splices ${actualCount} actual EPS quarter(s) with ${consensusCount} consensus quarter(s).`}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {isKo ? '기준일' : 'As of'} {fmtDate(forwardMetrics.as_of_date)}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isKo ? '현재가' : 'Current Price'}
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {fmtNumber(forwardMetrics.current_price)}
          </p>
        </div>
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Forward TTM EPS
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-foreground">
            {fmtNumber(forwardMetrics.forward_eps_ttm)}
          </p>
        </div>
        <div className="rounded-lg border bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Forward PER
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={forwardPeOverride}
              onChange={event => onForwardPeOverrideChange(event.target.value)}
              inputMode="decimal"
              className="h-8 font-mono text-sm"
              placeholder={fmtInputNumber(forwardMetrics.forward_pe)}
            />
            {isForwardPeOverridden && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-[11px]"
                onClick={onForwardPeOverrideReset}
              >
                Reset
              </Button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isKo ? '원본' : 'Original'} {fmtRatio(forwardMetrics.forward_pe)}
            {isForwardPeOverridden ? ` · ${isKo ? '수동 수정됨' : 'manual override'}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Composition</p>
        <div className="overflow-hidden rounded-lg border bg-background/70">
          <div className="grid grid-cols-[1fr_1fr_1fr_1.2fr] border-b bg-muted/20 px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <span>{isKo ? '분기' : 'Quarter'}</span>
            <span>{isKo ? '종료일' : 'Period End'}</span>
            <span>EPS</span>
            <span>{isKo ? '출처' : 'Source'}</span>
          </div>
          {forwardMetrics.composition.map((quarter, idx) => (
            <div
              key={`${quarter.period}-${quarter.fiscal_period_end}-${idx}`}
              className="grid grid-cols-[1fr_1fr_1fr_1.2fr] items-center border-b px-3 py-2 text-xs last:border-b-0"
            >
              <span className="font-mono text-foreground">{quarter.period}</span>
              <span className="font-mono text-muted-foreground">{fmtDate(quarter.fiscal_period_end)}</span>
              <span className="font-mono text-foreground">{fmtNumber(quarter.eps)}</span>
              <span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${sourceBadgeClass(quarter.source)}`}>
                  {quarter.source}
                </span>
                {quarter.provider && (
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    {quarter.provider}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Annual FY0 / FY+1 tiles */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* FY0 tile */}
        {forwardMetrics.forward_pe_fy0 != null || forwardMetrics.forward_eps_fy0 != null ? (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {isKo
                ? `포워드 PER (연간 FY${forwardMetrics.fy0_estimate?.fiscal_year ?? ''}E)`
                : `Forward PER (Annual FY${forwardMetrics.fy0_estimate?.fiscal_year ?? ''}E)`}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {isKo ? '연간 EPS' : 'Annual EPS'}: {fmtNumber(forwardMetrics.forward_eps_fy0)}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={forwardPeFy0Override}
                onChange={event => onForwardPeFy0OverrideChange(event.target.value)}
                inputMode="decimal"
                className="h-8 font-mono text-sm"
                placeholder={fmtInputNumber(forwardMetrics.forward_pe_fy0)}
              />
              {isForwardPeFy0Overridden && (
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px]" onClick={onForwardPeFy0OverrideReset}>
                  Reset
                </Button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {isKo ? '원본' : 'Original'} {fmtRatio(forwardMetrics.forward_pe_fy0)}
              {isForwardPeFy0Overridden ? ` · ${isKo ? '수동 수정됨' : 'manual override'}` : ''}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/10 p-3 flex items-center justify-center">
            <p className="text-[11px] text-muted-foreground">
              {isKo ? 'FY0 연간 컨센서스 없음' : 'Annual consensus unavailable (FY0)'}
            </p>
          </div>
        )}

        {/* FY+1 tile */}
        {forwardMetrics.forward_pe_fy1 != null || forwardMetrics.forward_eps_fy1 != null ? (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {isKo
                ? `포워드 PER (연간 FY${forwardMetrics.fy1_estimate?.fiscal_year ?? ''}E)`
                : `Forward PER (Annual FY${forwardMetrics.fy1_estimate?.fiscal_year ?? ''}E)`}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {isKo ? '연간 EPS' : 'Annual EPS'}: {fmtNumber(forwardMetrics.forward_eps_fy1)}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={forwardPeFy1Override}
                onChange={event => onForwardPeFy1OverrideChange(event.target.value)}
                inputMode="decimal"
                className="h-8 font-mono text-sm"
                placeholder={fmtInputNumber(forwardMetrics.forward_pe_fy1)}
              />
              {isForwardPeFy1Overridden && (
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px]" onClick={onForwardPeFy1OverrideReset}>
                  Reset
                </Button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {isKo ? '원본' : 'Original'} {fmtRatio(forwardMetrics.forward_pe_fy1)}
              {isForwardPeFy1Overridden ? ` · ${isKo ? '수동 수정됨' : 'manual override'}` : ''}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/10 p-3 flex items-center justify-center">
            <p className="text-[11px] text-muted-foreground">
              {isKo ? 'FY+1 연간 컨센서스 없음' : 'Annual consensus unavailable (FY+1)'}
            </p>
          </div>
        )}
      </div>

      {/* Annual Estimates mini-table */}
      {forwardMetrics.annual_estimates && forwardMetrics.annual_estimates.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {isKo ? '연간 컨센서스 추정' : 'Annual Estimates'}
          </p>
          <div className="overflow-hidden rounded-lg border bg-background/70">
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr] border-b bg-muted/20 px-3 py-2 text-[11px] font-medium text-muted-foreground">
              <span>{isKo ? '회계연도' : 'Fiscal Year'}</span>
              <span>{isKo ? '종료일' : 'Year End'}</span>
              <span>EPS</span>
              <span>{isKo ? '제공자' : 'Provider'}</span>
              <span>{isKo ? '애널리스트' : 'Analysts'}</span>
            </div>
            {forwardMetrics.annual_estimates.map((est, idx) => (
              <div
                key={`${est.fiscal_year}-${idx}`}
                className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr] items-center border-b px-3 py-2 text-xs last:border-b-0"
              >
                <span className="font-mono text-foreground">FY{est.fiscal_year}</span>
                <span className="font-mono text-muted-foreground">{fmtDate(est.fiscal_year_end)}</span>
                <span className="font-mono text-foreground">{fmtNumber(est.eps)}</span>
                <span className="text-muted-foreground">{est.provider}</span>
                <span className="font-mono text-muted-foreground">{est.analyst_count ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {forwardMetrics.notes.length > 0 && (
        <div className="mt-3 space-y-1">
          {forwardMetrics.notes.map((note, idx) => (
            <p key={idx} className="text-[11px] leading-relaxed text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}
    </section>
  );
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

export function DataSandboxTab({ isTabActive = true }: DataSandboxTabProps) {
  const { language } = useLanguage();
  const { success, error } = useToastManager();

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
  const [forwardPeOverride, setForwardPeOverride] = useState('');
  const [isForwardPeOverrideDirty, setIsForwardPeOverrideDirty] = useState(false);
  const [forwardPeFy0Override, setForwardPeFy0Override] = useState('');
  const [isForwardPeFy0OverrideDirty, setIsForwardPeFy0OverrideDirty] = useState(false);
  const [forwardPeFy1Override, setForwardPeFy1Override] = useState('');
  const [isForwardPeFy1OverrideDirty, setIsForwardPeFy1OverrideDirty] = useState(false);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [agentResults, setAgentResults] = useState<Map<string, AgentResult>>(new Map());
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isSavingAnalysis, setIsSavingAnalysis] = useState(false);
  const [expandedAgentResults, setExpandedAgentResults] = useState<Set<string>>(new Set());
  const [isFinalDecisionExpanded, setIsFinalDecisionExpanded] = useState(false);
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
    setForwardPeOverride('');
    setIsForwardPeOverrideDirty(false);
    setForwardPeFy0Override('');
    setIsForwardPeFy0OverrideDirty(false);
    setForwardPeFy1Override('');
    setIsForwardPeFy1OverrideDirty(false);
    setCompleteResult(null);
    setAgentResults(new Map());
    setRunError(null);
    setExpandedAgentResults(new Set());
    setIsFinalDecisionExpanded(false);

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
      setForwardPeOverride(fmtInputNumber(data.forward_metrics?.forward_pe));
      setIsForwardPeOverrideDirty(false);
      setForwardPeFy0Override(fmtInputNumber(data.forward_metrics?.forward_pe_fy0));
      setIsForwardPeFy0OverrideDirty(false);
      setForwardPeFy1Override(fmtInputNumber(data.forward_metrics?.forward_pe_fy1));
      setIsForwardPeFy1OverrideDirty(false);
      setViewTab('metrics');
    } catch (err: any) {
      setFetchError(err.message || 'Fetch failed');
    } finally {
      setIsFetching(false);
    }
  };

  // ── Run handler ──────────────────────────────────────────────────────────

  const buildForwardMetricsOverride = () => {
    const baseForwardMetrics = fetchedData?.forward_metrics;
    const anyDirty = isForwardPeOverrideDirty || isForwardPeFy0OverrideDirty || isForwardPeFy1OverrideDirty;
    if (!baseForwardMetrics || !anyDirty) return null;

    const overridePayload: Record<string, any> = { ...baseForwardMetrics };
    const addedNotes: string[] = [...(baseForwardMetrics.notes || [])];

    if (isForwardPeOverrideDirty) {
      const parsedForwardPe = parseOverrideInput(forwardPeOverride);
      if (parsedForwardPe !== null && parsedForwardPe > 0) {
        const originalForwardPe = Number(baseForwardMetrics.forward_pe);
        if (!Number.isFinite(originalForwardPe) || Math.abs(parsedForwardPe - originalForwardPe) >= 1e-9) {
          overridePayload.forward_pe = parsedForwardPe;
          overridePayload.confidence = 'high';
          const note = 'user override: forward_pe manually set via Data Sandbox';
          if (!addedNotes.includes(note)) addedNotes.push(note);
        }
      }
    }

    if (isForwardPeFy0OverrideDirty) {
      const parsed = parseOverrideInput(forwardPeFy0Override);
      if (parsed !== null && parsed > 0) {
        const original = Number(baseForwardMetrics.forward_pe_fy0);
        if (!Number.isFinite(original) || Math.abs(parsed - original) >= 1e-9) {
          overridePayload.forward_pe_fy0 = parsed;
          overridePayload.confidence = 'high';
          const note = 'user override: forward_pe_fy0 manually set via Data Sandbox';
          if (!addedNotes.includes(note)) addedNotes.push(note);
        }
      }
    }

    if (isForwardPeFy1OverrideDirty) {
      const parsed = parseOverrideInput(forwardPeFy1Override);
      if (parsed !== null && parsed > 0) {
        const original = Number(baseForwardMetrics.forward_pe_fy1);
        if (!Number.isFinite(original) || Math.abs(parsed - original) >= 1e-9) {
          overridePayload.forward_pe_fy1 = parsed;
          overridePayload.confidence = 'high';
          const note = 'user override: forward_pe_fy1 manually set via Data Sandbox';
          if (!addedNotes.includes(note)) addedNotes.push(note);
        }
      }
    }

    // Return null if nothing actually changed
    if (
      overridePayload.forward_pe === baseForwardMetrics.forward_pe &&
      overridePayload.forward_pe_fy0 === baseForwardMetrics.forward_pe_fy0 &&
      overridePayload.forward_pe_fy1 === baseForwardMetrics.forward_pe_fy1
    ) return null;

    overridePayload.notes = addedNotes;
    return overridePayload;
  };

  const buildAppliedMetricOverrides = () => {
    const cleanMetrics: Record<string, number> = {};
    Object.entries(metricsOverrides).forEach(([key, value]) => {
      if (value !== '') {
        const parsedValue = parseOverrideInput(value);
        if (parsedValue !== null) cleanMetrics[key] = parsedValue;
      }
    });

    const cleanLineItems = lineItemsOverrides
      .map(row => {
        const cleanRow: Record<string, any> = {};
        Object.entries(row).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== '') cleanRow[key] = value;
        });
        return cleanRow;
      })
      .filter(row => Object.keys(row).length > 0);

    const appliedOverrides: Record<string, any> = {};
    const forwardMetricsOverride = buildForwardMetricsOverride();

    if (Object.keys(cleanMetrics).length > 0) appliedOverrides.metrics = cleanMetrics;
    if (cleanLineItems.length > 0) appliedOverrides.line_items = cleanLineItems;
    if (forwardMetricsOverride) appliedOverrides.forward_metrics = forwardMetricsOverride;
    return appliedOverrides;
  };

  const handleRun = async () => {
    if (!fetchedData || selectedAgents.size === 0) return;

    const ticker = fetchedData.ticker;

    setIsRunning(true);
    setRunError(null);
    setCompleteResult(null);
    setExpandedAgentResults(new Set());
    setIsFinalDecisionExpanded(false);

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

    const metricOverrides = buildAppliedMetricOverrides();

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

  const handleSaveAnalysis = async () => {
    if (!fetchedData || isSavingAnalysis) return;

    const agentResultList = Array.from(agentResults.values());
    if (agentResultList.length === 0 && !completeResult) return;

    setIsSavingAnalysis(true);

    try {
      const appliedOverrides = buildAppliedMetricOverrides();
      const selectedAgentKeys = Array.from(selectedAgents);

      await savedAnalysisService.saveAnalysis(
        'data_sandbox',
        fetchedData.ticker,
        language,
        {
          input_tickers: tickers,
          tickers: [fetchedData.ticker],
          start_date: startDate,
          end_date: endDate,
          selected_model: selectedModel,
          selected_agent_keys: selectedAgentKeys,
          metricsOverrides,
          lineItemsOverrides,
          forwardPeOverride,
          applied_overrides: Object.keys(appliedOverrides).length > 0
            ? { [fetchedData.ticker]: appliedOverrides }
            : {},
        },
        {
          agent_results: agentResultList,
          complete_result: completeResult,
        },
      );

      success(t('savedToDbSuccess', language), 'data-sandbox-save-to-db');
    } catch (saveError) {
      console.error('Failed to save Data Sandbox analysis', saveError);
      error(t('savedToDbError', language), 'data-sandbox-save-to-db-error');
    } finally {
      setIsSavingAnalysis(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
  };

  const handleToggleAgentResult = (agentKey: string) => {
    setExpandedAgentResults(prev => {
      const next = new Set(prev);
      if (next.has(agentKey)) next.delete(agentKey); else next.add(agentKey);
      return next;
    });
  };

  const handleToggleFinalDecision = () => {
    setIsFinalDecisionExpanded(prev => !prev);
  };

  // ── Override helpers ─────────────────────────────────────────────────────

  const handleMetricOverride = (field: string, value: string) => {
    setMetricsOverrides(prev => ({ ...prev, [field]: value }));
  };

  const handleForwardPeOverrideChange = (value: string) => {
    setForwardPeOverride(value);
    setIsForwardPeOverrideDirty(true);
  };

  const resetForwardPeOverride = () => {
    setForwardPeOverride(fmtInputNumber(fetchedData?.forward_metrics?.forward_pe));
    setIsForwardPeOverrideDirty(false);
  };

  const handleForwardPeFy0OverrideChange = (value: string) => {
    setForwardPeFy0Override(value);
    setIsForwardPeFy0OverrideDirty(true);
  };

  const resetForwardPeFy0Override = () => {
    setForwardPeFy0Override(fmtInputNumber(fetchedData?.forward_metrics?.forward_pe_fy0));
    setIsForwardPeFy0OverrideDirty(false);
  };

  const handleForwardPeFy1OverrideChange = (value: string) => {
    setForwardPeFy1Override(value);
    setIsForwardPeFy1OverrideDirty(true);
  };

  const resetForwardPeFy1Override = () => {
    setForwardPeFy1Override(fmtInputNumber(fetchedData?.forward_metrics?.forward_pe_fy1));
    setIsForwardPeFy1OverrideDirty(false);
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
    resetForwardPeOverride();
    resetForwardPeFy0Override();
    resetForwardPeFy1Override();
  };

  const parsedForwardPeOverride = parseOverrideInput(forwardPeOverride);
  const originalForwardPe = Number(fetchedData?.forward_metrics?.forward_pe);
  const hasForwardPeOverride = Boolean(
    fetchedData?.forward_metrics &&
    isForwardPeOverrideDirty &&
    parsedForwardPeOverride !== null &&
    parsedForwardPeOverride > 0 &&
    (!Number.isFinite(originalForwardPe) || Math.abs(parsedForwardPeOverride - originalForwardPe) >= 1e-9),
  );

  const parsedForwardPeFy0Override = parseOverrideInput(forwardPeFy0Override);
  const originalForwardPeFy0 = Number(fetchedData?.forward_metrics?.forward_pe_fy0);
  const hasForwardPeFy0Override = Boolean(
    fetchedData?.forward_metrics &&
    isForwardPeFy0OverrideDirty &&
    parsedForwardPeFy0Override !== null &&
    parsedForwardPeFy0Override > 0 &&
    (!Number.isFinite(originalForwardPeFy0) || Math.abs(parsedForwardPeFy0Override - originalForwardPeFy0) >= 1e-9),
  );

  const parsedForwardPeFy1Override = parseOverrideInput(forwardPeFy1Override);
  const originalForwardPeFy1 = Number(fetchedData?.forward_metrics?.forward_pe_fy1);
  const hasForwardPeFy1Override = Boolean(
    fetchedData?.forward_metrics &&
    isForwardPeFy1OverrideDirty &&
    parsedForwardPeFy1Override !== null &&
    parsedForwardPeFy1Override > 0 &&
    (!Number.isFinite(originalForwardPeFy1) || Math.abs(parsedForwardPeFy1Override - originalForwardPeFy1) >= 1e-9),
  );

  const overrideCount = Object.values(metricsOverrides).filter(v => v !== '').length +
    (hasForwardPeOverride ? 1 : 0) +
    (hasForwardPeFy0Override ? 1 : 0) +
    (hasForwardPeFy1Override ? 1 : 0);

  useEffect(() => {
    if (!fetchedData) return;

    const snapshot = buildDataSandboxOverrideSnapshot({
      ticker: fetchedData.ticker,
      metricsOverrides,
      lineItemsOverrides,
      forwardMetricsOverride: buildForwardMetricsOverride(),
      parseMetricOverride: parseOverrideInput,
    });

    if (snapshot) {
      saveDataSandboxOverrideSnapshot(snapshot);
    }
  }, [fetchedData, forwardPeOverride, isForwardPeOverrideDirty, forwardPeFy0Override, isForwardPeFy0OverrideDirty, forwardPeFy1Override, isForwardPeFy1OverrideDirty, lineItemsOverrides, metricsOverrides]);

  const canFetch = tickers.trim() !== '' && !isFetching && !isRunning;
  const canRun = !!fetchedData && selectedAgents.size > 0 && !isRunning && !isFetching;
  const agentResultList = Array.from(agentResults.values());
  const hasSavableResults = !!fetchedData && !isRunning && (agentResultList.length > 0 || !!completeResult);

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
              isActive={isTabActive}
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
              {fetchedData.forward_metrics && (
                <p>Forward PER: {fmtRatio(fetchedData.forward_metrics.forward_pe)}</p>
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
                  <div className="space-y-4 p-4">
                    <ForwardMetricsCard
                      forwardMetrics={fetchedData.forward_metrics}
                      language={language}
                      forwardPeOverride={forwardPeOverride}
                      isForwardPeOverridden={hasForwardPeOverride}
                      onForwardPeOverrideChange={handleForwardPeOverrideChange}
                      onForwardPeOverrideReset={resetForwardPeOverride}
                      forwardPeFy0Override={forwardPeFy0Override}
                      isForwardPeFy0Overridden={hasForwardPeFy0Override}
                      onForwardPeFy0OverrideChange={handleForwardPeFy0OverrideChange}
                      onForwardPeFy0OverrideReset={resetForwardPeFy0Override}
                      forwardPeFy1Override={forwardPeFy1Override}
                      isForwardPeFy1Overridden={hasForwardPeFy1Override}
                      onForwardPeFy1OverrideChange={handleForwardPeFy1OverrideChange}
                      onForwardPeFy1OverrideReset={resetForwardPeFy1Override}
                    />
                    <p className="text-xs text-muted-foreground">
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
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-foreground">
                          {t('resultsTab', language)}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {language === 'ko'
                            ? '현재 분석 결과를 데이터베이스에 명시적으로 저장할 수 있습니다.'
                            : 'You can explicitly save the current analysis output to the database.'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSaveAnalysis}
                        disabled={!hasSavableResults || isSavingAnalysis}
                      >
                        {isSavingAnalysis ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('saveToDbButton', language)}</>
                        ) : (
                          <><Database className="mr-2 h-4 w-4" />{t('saveToDbButton', language)}</>
                        )}
                      </Button>
                    </div>

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
                    {agentResultList.map(result => {
                      const isExpanded = expandedAgentResults.has(result.agentKey);
                      return (
                        <div key={result.agentKey} className="border rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => handleToggleAgentResult(result.agentKey)}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                            )}
                            <Bot size={14} className={`shrink-0 ${statusColor(result.status)}`} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{result.agentName}</span>
                            {result.signal && (
                              <span className={`shrink-0 text-xs font-semibold ${signalClass(result.signal)}`}>
                                {result.signal}
                              </span>
                            )}
                            {result.confidence !== undefined && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {Math.round(result.confidence <= 1 ? result.confidence * 100 : result.confidence)}%
                              </span>
                            )}
                            <span className={`shrink-0 text-xs font-medium ${statusColor(result.status)}`}>
                              {result.status === 'running' && (
                                <Loader2 size={11} className="inline animate-spin mr-1" />
                              )}
                              {statusLabel(result.status)}
                            </span>
                          </button>
                          {isExpanded && result.reasoning && (
                            <div className="px-3 pb-3 pt-1 border-t border-border/50 pl-9">
                              <ReportSentimentDashboard
                                markdown={result.reasoning}
                                language={language}
                                className="mb-3"
                              />
                              {renderMarkdown(result.reasoning)}
                            </div>
                          )}
                          {!isExpanded && result.reasoning && (
                            <p className="px-3 pb-2 text-xs text-muted-foreground pl-9">
                              {previewText(result.reasoning)}
                            </p>
                          )}
                        </div>
                      );
                    })}

                    {/* Final Decision */}
                    {completeResult?.decisions && (
                      <div className="border border-green-500/30 rounded-lg overflow-hidden bg-green-500/5">
                        <button
                          type="button"
                          onClick={handleToggleFinalDecision}
                          className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-green-500/10 transition-colors cursor-pointer"
                          aria-expanded={isFinalDecisionExpanded}
                        >
                          {isFinalDecisionExpanded ? (
                            <ChevronDown size={14} className="shrink-0 text-green-600 dark:text-green-400" />
                          ) : (
                            <ChevronRight size={14} className="shrink-0 text-green-600 dark:text-green-400" />
                          )}
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                            {t('finalDecision', language)}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {isFinalDecisionExpanded ? t('collapseDetails', language) : t('expandDetails', language)}
                          </span>
                        </button>
                        <div className="px-4 pb-4 pt-1 border-t border-green-500/20">
                          {Object.entries(completeResult.decisions).map(([tkr, decision]: [string, any]) => (
                            <div key={tkr} className="py-2">
                              <div className="flex items-center gap-3 text-sm">
                                <span className="font-mono font-bold">{tkr}</span>
                                <span className={`font-medium uppercase ${signalClass(decision.action)}`}>
                                  {decision.action}
                                </span>
                                {decision.confidence !== undefined && (
                                  <span className="text-muted-foreground text-xs">
                                    {Math.round((decision.confidence <= 1 ? decision.confidence * 100 : decision.confidence))}%
                                  </span>
                                )}
                              </div>
                              {decision.reasoning && (
                                <div className="mt-1">
                                  {isFinalDecisionExpanded ? (
                                    <>
                                      <ReportSentimentDashboard
                                        markdown={decision.reasoning}
                                        language={language}
                                        className="mb-3"
                                      />
                                      {renderMarkdown(decision.reasoning)}
                                    </>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">{previewText(decision.reasoning)}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
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
