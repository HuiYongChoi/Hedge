/**
 * Analyst Report Dashboard – 6-panel grid layout
 * Top row:    DCF Valuation | Earnings·Multiples | Verdict
 * Bottom row: Bear Thesis   | Risk               | Cross-Check
 * Footer:     Analyst strip grouped by category
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/language-preferences';
import {
  BarChart2,
  Database,
  Loader2,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentReport {
  signal?: string;
  confidence?: number | string;
  reasoning?: string | Record<string, any>;
  [key: string]: any;
}

interface CompleteResult {
  decisions?: Record<string, any>;
  analyst_signals?: Record<string, any>;
  reasoning?: string;
}

interface AgentResult {
  agentKey: string;
  agentName: string;
  status: string;
  ticker?: string;
  analysis?: any;
}

interface AnalystReportDashboardProps {
  ticker: string;
  completeResult: CompleteResult;
  agentResults: Map<string, AgentResult>;
  language: 'ko' | 'en';
  compositeScore: number;
  onSave?: () => void;
  isSaving?: boolean;
}

// ── Agent category registry ───────────────────────────────────────────────────

const AGENT_CATEGORIES: Record<string, { category: string; categoryKo: string }> = {
  aswath_damodaran:      { category: 'Value Investing',       categoryKo: '가치 투자' },
  ben_graham:            { category: 'Value Investing',       categoryKo: '가치 투자' },
  charlie_munger:        { category: 'Value Investing',       categoryKo: '가치 투자' },
  mohnish_pabrai:        { category: 'Value Investing',       categoryKo: '가치 투자' },
  peter_lynch:           { category: 'Value Investing',       categoryKo: '가치 투자' },
  phil_fisher:           { category: 'Value Investing',       categoryKo: '가치 투자' },
  warren_buffett:        { category: 'Value Investing',       categoryKo: '가치 투자' },
  cathie_wood:           { category: 'Growth Investing',      categoryKo: '성장 투자' },
  rakesh_jhunjhunwala:   { category: 'Growth Investing',      categoryKo: '성장 투자' },
  bill_ackman:           { category: 'Macro & Activist',      categoryKo: '거시 및 행동주의' },
  michael_burry:         { category: 'Macro & Activist',      categoryKo: '거시 및 행동주의' },
  nassim_taleb:          { category: 'Macro & Activist',      categoryKo: '거시 및 행동주의' },
  stanley_druckenmiller: { category: 'Macro & Activist',      categoryKo: '거시 및 행동주의' },
  technical_analyst:     { category: 'Technical & Analysis',  categoryKo: '기술 및 분석' },
  fundamentals_analyst:  { category: 'Technical & Analysis',  categoryKo: '기술 및 분석' },
  growth_analyst:        { category: 'Technical & Analysis',  categoryKo: '기술 및 분석' },
  news_sentiment_analyst:{ category: 'Technical & Analysis',  categoryKo: '기술 및 분석' },
  sentiment_analyst:     { category: 'Technical & Analysis',  categoryKo: '기술 및 분석' },
  valuation_analyst:     { category: 'Technical & Analysis',  categoryKo: '기술 및 분석' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAgentReport(
  analystSignals: Record<string, any> | undefined,
  agentKey: string,
  ticker: string,
): AgentReport | null {
  if (!analystSignals) return null;
  // Exact match or agent-suffixed match
  const candidates = [agentKey, `${agentKey}_agent`];
  for (const key of candidates) {
    const signals = analystSignals[key];
    if (signals && typeof signals === 'object') {
      const report = signals[ticker];
      if (report && typeof report === 'object') return report as AgentReport;
    }
  }
  return null;
}

function getSignalTone(signal: unknown): 'bullish' | 'bearish' | 'neutral' {
  const raw = String(signal || '').toLowerCase();
  if (raw === 'bullish' || raw === 'buy' || raw === 'long') return 'bullish';
  if (raw === 'bearish' || raw === 'sell' || raw === 'short') return 'bearish';
  return 'neutral';
}

function signalBadgeClass(tone: 'bullish' | 'bearish' | 'neutral') {
  if (tone === 'bullish') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
  if (tone === 'bearish') return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300';
  return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-300';
}

function signalLabel(tone: 'bullish' | 'bearish' | 'neutral', language: 'ko' | 'en') {
  if (tone === 'bullish') return language === 'ko' ? t('signalBull', language) : t('signalBuy', language);
  if (tone === 'bearish') return language === 'ko' ? t('signalBear', language) : t('signalSell', language);
  return t('signalNeu', language);
}

function normalizeConfidence(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function getScoreBand(score: number, language: 'ko' | 'en') {
  if (score >= 80) return { label: language === 'ko' ? '강력 매수' : 'Strong Buy', cls: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400' };
  if (score >= 60) return { label: language === 'ko' ? '매수' : 'Buy',             cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
  if (score >= 40) return { label: language === 'ko' ? '관망' : 'Watch',           cls: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' };
  if (score >= 20) return { label: language === 'ko' ? '비중 축소' : 'Reduce',     cls: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400' };
  return              { label: language === 'ko' ? '강력 매도' : 'Strong Sell',    cls: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400' };
}

function extractReasoningText(reasoning: unknown): string {
  if (!reasoning) return '';
  if (typeof reasoning === 'string') return reasoning.slice(0, 500);
  if (typeof reasoning === 'object') {
    const r = reasoning as Record<string, any>;
    const text = r.summary || r.analysis || r.details || r.explanation || '';
    return typeof text === 'string' ? text.slice(0, 500) : '';
  }
  return '';
}

function extractMetricValue(report: AgentReport | null, keys: string[]): number | null {
  if (!report) return null;
  for (const key of keys) {
    const val = report[key];
    if (val !== null && val !== undefined) {
      const n = Number(val);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractCrossCheckItems(reasoning: unknown): string[] {
  const text = extractReasoningText(reasoning);
  if (!text) return [];
  const numbered = text.match(/\d+[.)]\s+[^\n]+/g) || [];
  return numbered.slice(0, 5).map(s => s.replace(/^\d+[.)]\s+/, '').trim());
}

function formatNum(value: number | null, decimals = 2, suffix = '') {
  if (value === null) return null;
  return value.toFixed(decimals) + suffix;
}

// ── Cross-check storage ───────────────────────────────────────────────────────

const CROSSCHECK_STORAGE_PREFIX = 'crosscheck:';

function loadCheckedState(ticker: string): Record<number, boolean> {
  try {
    const raw = localStorage.getItem(`${CROSSCHECK_STORAGE_PREFIX}${ticker}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCheckedState(ticker: string, state: Record<number, boolean>) {
  try {
    localStorage.setItem(`${CROSSCHECK_STORAGE_PREFIX}${ticker}`, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PanelCard({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col overflow-hidden ${className}`}>
      <CardHeader className="border-b border-border/60 px-3 py-2.5">
        <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto px-3 py-2.5 text-sm">
        {children}
      </CardContent>
    </Card>
  );
}

function Placeholder({ language }: { language: 'ko' | 'en' }) {
  return (
    <p className="text-xs text-muted-foreground">
      {language === 'ko' ? '이 에이전트가 실행되지 않았습니다.' : 'This agent was not run.'}
    </p>
  );
}

function DcfPanel({
  report,
  language,
}: {
  report: AgentReport | null;
  language: 'ko' | 'en';
}) {
  if (!report) return <Placeholder language={language} />;

  const intrinsicValue = extractMetricValue(report, ['intrinsic_value', 'dcf_value', 'fair_value']);
  const wacc = extractMetricValue(report, ['wacc', 'discount_rate']);
  const terminal = extractMetricValue(report, ['terminal_value', 'terminal_growth_rate', 'growth_rate']);
  const signal = report.signal;
  const tone = getSignalTone(signal);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`text-xs ${signalBadgeClass(tone)}`}>
          {signalLabel(tone, language)}
        </Badge>
        {report.confidence != null && (
          <Badge variant="outline" className="text-xs border-blue-500/25 bg-blue-500/10 text-blue-500">
            {normalizeConfidence(report.confidence)}%
          </Badge>
        )}
      </div>
      {(intrinsicValue !== null || wacc !== null) && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {intrinsicValue !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">{language === 'ko' ? '내재가치' : 'Intrinsic Value'}</div>
              <div className="font-mono font-medium text-foreground">${intrinsicValue.toLocaleString()}</div>
            </div>
          )}
          {wacc !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">WACC</div>
              <div className="font-mono font-medium text-foreground">{formatNum(wacc * (wacc < 1 ? 100 : 1), 1, '%')}</div>
            </div>
          )}
          {terminal !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">{language === 'ko' ? '성장률/터미널' : 'Terminal/Growth'}</div>
              <div className="font-mono font-medium text-foreground">{formatNum(terminal * (terminal < 1 ? 100 : 1), 1, '%')}</div>
            </div>
          )}
        </div>
      )}
      <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
        {extractReasoningText(report.reasoning) || (language === 'ko' ? '세부 근거 없음' : 'No detail available')}
      </p>
    </div>
  );
}

function MultiplesPanel({
  report,
  language,
}: {
  report: AgentReport | null;
  language: 'ko' | 'en';
}) {
  if (!report) return <Placeholder language={language} />;

  const pe = extractMetricValue(report, ['pe_ratio', 'price_to_earnings', 'forward_pe', 'trailing_pe']);
  const pb = extractMetricValue(report, ['pb_ratio', 'price_to_book', 'p_b_ratio']);
  const ps = extractMetricValue(report, ['ps_ratio', 'price_to_sales']);
  const evEbitda = extractMetricValue(report, ['ev_to_ebitda', 'ev_ebitda']);
  const forwardPe = extractMetricValue(report, ['forward_pe', 'forward_pe_ttm']);
  const forwardPeFy0 = extractMetricValue(report, ['forward_pe_fy0']);
  const forwardPeFy1 = extractMetricValue(report, ['forward_pe_fy1']);
  const tone = getSignalTone(report.signal);
  const hasData = [pe, pb, ps, evEbitda, forwardPe, forwardPeFy0, forwardPeFy1].some(v => v !== null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`text-xs ${signalBadgeClass(tone)}`}>
          {signalLabel(tone, language)}
        </Badge>
        {report.confidence != null && (
          <Badge variant="outline" className="text-xs border-blue-500/25 bg-blue-500/10 text-blue-500">
            {normalizeConfidence(report.confidence)}%
          </Badge>
        )}
      </div>
      {hasData && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {forwardPe !== null && (
            <div className="rounded border border-violet-500/30 bg-violet-500/10 p-1.5">
              <div className="text-muted-foreground">Fwd P/E (TTM)</div>
              <div className="font-mono font-medium text-foreground">{formatNum(forwardPe, 1, 'x')}</div>
            </div>
          )}
          {forwardPeFy0 !== null && (
            <div className="rounded border border-violet-500/30 bg-violet-500/10 p-1.5">
              <div className="text-muted-foreground">Fwd P/E (FY0)</div>
              <div className="font-mono font-medium text-foreground">{formatNum(forwardPeFy0, 1, 'x')}</div>
            </div>
          )}
          {forwardPeFy1 !== null && (
            <div className="rounded border border-violet-500/30 bg-violet-500/10 p-1.5">
              <div className="text-muted-foreground">Fwd P/E (FY+1)</div>
              <div className="font-mono font-medium text-foreground">{formatNum(forwardPeFy1, 1, 'x')}</div>
            </div>
          )}
          {pe !== null && forwardPe === null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">P/E</div>
              <div className="font-mono font-medium text-foreground">{formatNum(pe, 1, 'x')}</div>
            </div>
          )}
          {pb !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">P/B</div>
              <div className="font-mono font-medium text-foreground">{formatNum(pb, 2, 'x')}</div>
            </div>
          )}
          {ps !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">P/S</div>
              <div className="font-mono font-medium text-foreground">{formatNum(ps, 2, 'x')}</div>
            </div>
          )}
          {evEbitda !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">EV/EBITDA</div>
              <div className="font-mono font-medium text-foreground">{formatNum(evEbitda, 1, 'x')}</div>
            </div>
          )}
        </div>
      )}
      <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">
        {extractReasoningText(report.reasoning) || (language === 'ko' ? '세부 근거 없음' : 'No detail available')}
      </p>
    </div>
  );
}

function VerdictPanel({
  decision,
  language,
}: {
  decision: any;
  language: 'ko' | 'en';
}) {
  if (!decision) return <Placeholder language={language} />;

  const action = String(decision.action || 'hold').toLowerCase();
  const conf = normalizeConfidence(decision.confidence);
  const reasoning = typeof decision.reasoning === 'string'
    ? decision.reasoning.slice(0, 600)
    : '';

  const actionLabel = (() => {
    if (action === 'buy' || action === 'cover') return language === 'ko' ? '매수' : 'Buy';
    if (action === 'sell' || action === 'short') return language === 'ko' ? '매도' : 'Sell';
    return language === 'ko' ? '관망' : 'Hold';
  })();
  const actionClass = (() => {
    if (action === 'buy' || action === 'cover') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
    if (action === 'sell' || action === 'short') return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300';
    return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-300';
  })();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`text-xs font-semibold ${actionClass}`}>
          {actionLabel}
        </Badge>
        {conf !== null && (
          <Badge variant="outline" className="text-xs border-blue-500/25 bg-blue-500/10 text-blue-500">
            {conf}%
          </Badge>
        )}
        {decision.quantity != null && Number.isFinite(Number(decision.quantity)) && Number(decision.quantity) !== 0 && (
          <Badge variant="outline" className="text-xs border-border/50">
            {language === 'ko' ? '수량' : 'Qty'} {Number(decision.quantity).toLocaleString()}
          </Badge>
        )}
      </div>
      {reasoning && (
        <p className="line-clamp-6 text-xs leading-relaxed text-muted-foreground">{reasoning}</p>
      )}
    </div>
  );
}

function BearThesisPanel({
  analystSignals,
  ticker,
  language,
}: {
  analystSignals: Record<string, any> | undefined;
  ticker: string;
  language: 'ko' | 'en';
}) {
  if (!analystSignals) return <Placeholder language={language} />;

  const bearish = Object.entries(analystSignals)
    .filter(([agentId]) => !agentId.startsWith('risk_management_agent'))
    .map(([agentId, signals]) => {
      const report = signals?.[ticker];
      if (!report) return null;
      const tone = getSignalTone(report.signal);
      if (tone !== 'bearish') return null;
      const conf = normalizeConfidence(report.confidence);
      const text = extractReasoningText(report.reasoning);
      return { agentId, conf, text };
    })
    .filter((x): x is { agentId: string; conf: number | null; text: string } => Boolean(x))
    .sort((a, b) => (b.conf ?? 0) - (a.conf ?? 0))
    .slice(0, 3);

  if (bearish.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {language === 'ko' ? '약세 논거를 제시한 에이전트가 없습니다.' : 'No agents with bearish thesis.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {bearish.map(({ agentId, conf, text }) => {
        const baseKey = agentId.replace(/_agent$/, '');
        const meta = AGENT_CATEGORIES[baseKey];
        const label = meta
          ? baseKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          : baseKey;
        return (
          <div key={agentId} className="rounded border border-red-500/20 bg-red-500/5 p-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="font-medium text-red-500">{label}</span>
              {conf !== null && (
                <span className="text-muted-foreground">{conf}%</span>
              )}
            </div>
            <p className="line-clamp-3 leading-relaxed text-muted-foreground">{text || '—'}</p>
          </div>
        );
      })}
    </div>
  );
}

function RiskPanel({
  analystSignals,
  ticker,
  language,
}: {
  analystSignals: Record<string, any> | undefined;
  ticker: string;
  language: 'ko' | 'en';
}) {
  const riskReport = analystSignals?.['risk_management_agent']?.[ticker];

  if (!riskReport) {
    return (
      <p className="text-xs text-muted-foreground">
        {language === 'ko'
          ? '리스크 관리 에이전트가 실행되지 않았습니다.'
          : 'Risk management agent was not run.'}
      </p>
    );
  }

  const conf = normalizeConfidence(riskReport.confidence);
  const maxPos = extractMetricValue(riskReport, ['max_position_size', 'position_limit']);
  const stop = extractMetricValue(riskReport, ['stop_loss', 'stop_loss_price']);
  const text = extractReasoningText(riskReport.reasoning);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {riskReport.signal && (
          <Badge variant="outline" className={`text-xs ${signalBadgeClass(getSignalTone(riskReport.signal))}`}>
            {signalLabel(getSignalTone(riskReport.signal), language)}
          </Badge>
        )}
        {conf !== null && (
          <Badge variant="outline" className="text-xs border-blue-500/25 bg-blue-500/10 text-blue-500">
            {conf}%
          </Badge>
        )}
      </div>
      {(maxPos !== null || stop !== null) && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {maxPos !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">{language === 'ko' ? '최대 포지션' : 'Max Position'}</div>
              <div className="font-mono font-medium text-foreground">{maxPos.toLocaleString()}</div>
            </div>
          )}
          {stop !== null && (
            <div className="rounded border border-border/50 bg-muted/20 p-1.5">
              <div className="text-muted-foreground">{language === 'ko' ? '손절가' : 'Stop Loss'}</div>
              <div className="font-mono font-medium text-foreground">${stop.toLocaleString()}</div>
            </div>
          )}
        </div>
      )}
      {text && <p className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">{text}</p>}
    </div>
  );
}

function CrossCheckPanel({
  analystSignals,
  ticker,
  language,
}: {
  analystSignals: Record<string, any> | undefined;
  ticker: string;
  language: 'ko' | 'en';
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setChecked(loadCheckedState(ticker));
  }, [ticker]);

  // Collect cross-check items from all agents
  const items: string[] = [];
  if (analystSignals) {
    for (const signals of Object.values(analystSignals)) {
      if (!signals || typeof signals !== 'object') continue;
      const report = signals[ticker];
      if (!report) continue;
      const raw = items.length < 5 ? extractCrossCheckItems(report.reasoning) : [];
      for (const item of raw) {
        if (!items.includes(item)) items.push(item);
        if (items.length >= 6) break;
      }
    }
  }

  // Default checklist if no items found
  const checklistItems = items.length > 0 ? items : (
    language === 'ko'
      ? [
          '사업보고서 실적 데이터 확인',
          '경영진 가이던스 대조',
          '리스크 요인 검토',
          '밸류에이션 가정 점검',
          '경쟁 업체 비교 분석',
        ]
      : [
          'Verify earnings vs. 10-K filing',
          'Cross-check management guidance',
          'Review risk factor disclosures',
          'Validate valuation assumptions',
          'Peer comparison sanity check',
        ]
  );

  const toggle = (i: number) => {
    const next = { ...checked, [i]: !checked[i] };
    setChecked(next);
    saveCheckedState(ticker, next);
  };

  const doneCount = checklistItems.filter((_, i) => checked[i]).length;
  const totalCount = checklistItems.length;

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {t('crosscheckProgress', language)
          .replace('{done}', String(doneCount))
          .replace('{total}', String(totalCount))}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
        />
      </div>
      <ul className="space-y-1.5">
        {checklistItems.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => toggle(i)}
              className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded border transition-colors focus:outline-none focus:ring-1 focus:ring-ring ${
                checked[i]
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-border bg-background hover:border-emerald-400'
              }`}
              aria-label={checked[i] ? 'Uncheck' : 'Check'}
            >
              {checked[i] && (
                <svg viewBox="0 0 12 12" className="h-full w-full p-0.5" fill="none">
                  <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span className={`text-xs leading-relaxed ${checked[i] ? 'line-through text-muted-foreground/60' : 'text-muted-foreground'}`}>
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Analyst Strip ─────────────────────────────────────────────────────────────

function AnalystStrip({
  analystSignals,
  agentResults,
  ticker,
  language,
}: {
  analystSignals: Record<string, any> | undefined;
  agentResults: Map<string, AgentResult>;
  ticker: string;
  language: 'ko' | 'en';
}) {
  const categoryOrder = ['Value Investing', 'Growth Investing', 'Macro & Activist', 'Technical & Analysis'];

  const grouped = categoryOrder.reduce<Record<string, Array<{ key: string; name: string; tone: 'bullish' | 'bearish' | 'neutral'; conf: number | null }>>>((acc, cat) => {
    acc[cat] = [];
    return acc;
  }, {});

  agentResults.forEach((result, agentKey) => {
    const meta = AGENT_CATEGORIES[agentKey];
    const cat = meta?.category || 'Technical & Analysis';
    if (!grouped[cat]) grouped[cat] = [];
    const report = analystSignals?.[agentKey]?.[ticker] || analystSignals?.[`${agentKey}_agent`]?.[ticker];
    const tone = report ? getSignalTone(report.signal) : 'neutral';
    const conf = report ? normalizeConfidence(report.confidence) : null;
    grouped[cat].push({
      key: agentKey,
      name: result.agentName,
      tone,
      conf,
    });
  });

  const activeCategories = categoryOrder.filter(cat => grouped[cat]?.length > 0);
  if (activeCategories.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-muted/10 p-3">
      <div className="mb-2 text-xs font-semibold text-foreground">
        {t('analystStripTotal', language).replace('{total}', String(agentResults.size))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {activeCategories.map(cat => {
          const agents = grouped[cat] || [];
          const catInfo = Object.values(AGENT_CATEGORIES).find(a => a.category === cat);
          const catLabel = language === 'ko' ? catInfo?.categoryKo : cat;
          return (
            <div key={cat}>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{catLabel}</div>
              <div className="flex flex-wrap gap-1">
                {agents.map(agent => (
                  <div
                    key={agent.key}
                    title={`${agent.name}${agent.conf !== null ? ` – ${agent.conf}%` : ''}`}
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${signalBadgeClass(agent.tone)}`}
                  >
                    {agent.name.length > 14 ? agent.name.slice(0, 13) + '…' : agent.name}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Score Gauge (compact) ─────────────────────────────────────────────────────

function ScoreGaugeCompact({ score }: { score: number }) {
  const clamp = Math.max(0, Math.min(100, score));
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamp / 100) * circ;
  const color = clamp >= 60 ? '#059669' : clamp >= 40 ? '#ca8a04' : '#dc2626';

  return (
    <div className="relative h-14 w-14 flex-shrink-0">
      <svg className="h-14 w-14 -rotate-90" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted" />
        <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          style={{ strokeDasharray: `${circ} ${circ}`, strokeDashoffset: offset }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-sm font-bold text-foreground">{clamp}</span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AnalystReportDashboard({
  ticker,
  completeResult,
  agentResults,
  language,
  compositeScore,
  onSave,
  isSaving,
}: AnalystReportDashboardProps) {
  const analystSignals = completeResult.analyst_signals;
  const decision = completeResult.decisions?.[ticker];
  const scoreBand = getScoreBand(compositeScore, language);

  const valuationReport = getAgentReport(analystSignals, 'valuation_analyst', ticker);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-muted/10 px-3 py-2.5">
        <ScoreGaugeCompact score={compositeScore} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-bold text-primary">{ticker}</span>
            <Badge variant="outline" className={`text-xs ${scoreBand.cls}`}>{scoreBand.label}</Badge>
            {decision?.action && (
              <Badge variant="outline" className="text-xs border-border/50">
                {String(decision.action).toUpperCase()}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {language === 'ko'
              ? `에이전트 ${agentResults.size}개 분석 완료`
              : `${agentResults.size} agents analysed`}
          </p>
        </div>
        {onSave && (
          <Button type="button" variant="outline" size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t('reportHeaderSave', language)}</>
              : <><Database className="mr-1.5 h-3.5 w-3.5" />{t('reportHeaderSave', language)}</>
            }
          </Button>
        )}
      </div>

      {/* 6-panel grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Row 1 */}
        <PanelCard
          title={t('dcfValuationTitle', language)}
          icon={<Target className="h-3 w-3" />}
        >
          <DcfPanel report={valuationReport} language={language} />
        </PanelCard>

        <PanelCard
          title={t('multiplesTitle', language)}
          icon={<BarChart2 className="h-3 w-3" />}
        >
          <MultiplesPanel report={valuationReport} language={language} />
        </PanelCard>

        <PanelCard
          title={t('verdictTitle', language)}
          icon={<TrendingUp className="h-3 w-3" />}
        >
          <VerdictPanel decision={decision} language={language} />
        </PanelCard>

        {/* Row 2 */}
        <PanelCard
          title={t('bearThesisTitle', language)}
          icon={<TrendingDown className="h-3 w-3" />}
          className="border-red-500/20"
        >
          <BearThesisPanel analystSignals={analystSignals} ticker={ticker} language={language} />
        </PanelCard>

        <PanelCard
          title={t('riskTitle', language)}
          icon={<Shield className="h-3 w-3" />}
        >
          <RiskPanel analystSignals={analystSignals} ticker={ticker} language={language} />
        </PanelCard>

        <PanelCard
          title={t('crosscheckTitle', language)}
        >
          <CrossCheckPanel analystSignals={analystSignals} ticker={ticker} language={language} />
        </PanelCard>
      </div>

      {/* Analyst strip */}
      <AnalystStrip
        analystSignals={analystSignals}
        agentResults={agentResults}
        ticker={ticker}
        language={language}
      />
    </div>
  );
}
