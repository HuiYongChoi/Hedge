import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '@/lib/language-preferences';
import { Database, FileText, Loader2, RefreshCw, SearchCode } from 'lucide-react';
import type { ReactNode } from 'react';
import { dataCoverageLabel, getScoreBand, getSignalTone, signalToVerdict, toneToClasses } from './helpers';
import { formatMoney } from './price-compass-panel/utils';
import type { AgentMeta, AgentReport, ReportLanguage } from './types';

interface ReportHeaderRibbonProps {
  ticker: string;
  displayTicker: string;
  activeAgent: AgentMeta;
  activeReport: AgentReport | null;
  compositeScore: number;
  currentPrice: number | null;
  marginOfSafety: number | null;
  marginReferencePrice: number | null;
  currency?: string;
  analysisGeneratedAt?: string | null;
  marketDataUpdatedAt?: string | null;
  extendedPrice?: number | null;
  extendedChangePercent?: number | null;
  extendedSession?: 'pre' | 'post' | null;
  language: ReportLanguage;
  onRefreshMarketData?: () => void;
  isRefreshingMarketData?: boolean;
  onCompareSourceClick: () => void;
  onSave?: () => void;
  isSaving?: boolean;
}

export function ScoreGaugeCompact({ score }: { score: number }) {
  const clamp = Math.max(0, Math.min(100, score));
  const r = 24;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamp / 100) * circ;
  const color = clamp >= 60 ? '#059669' : clamp >= 40 ? '#ca8a04' : '#dc2626';

  return (
    <div className="relative h-16 w-16 flex-shrink-0">
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          style={{ strokeDasharray: `${circ} ${circ}`, strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-sm font-bold text-foreground">{clamp}</span>
      </div>
    </div>
  );
}

function formatCurrentPrice(value: number | null, language: ReportLanguage, currency = 'USD') {
  if (value === null) return language === 'ko' ? '현재가 N/A' : 'Price N/A';
  return `${language === 'ko' ? '현재가' : 'Price'} ${formatMoney(value, currency)}`;
}

function formatSignedPercent(value: number) {
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// extended_change_percent is already in percent units (e.g. 4.07 = +4.07%).
function formatExtendedPrice(
  price: number,
  changePercent: number | null | undefined,
  session: 'pre' | 'post',
  language: ReportLanguage,
  currency = 'USD',
) {
  const label = t(session === 'pre' ? 'preMarketLabel' : 'afterMarketLabel', language);
  const priceText = formatMoney(price, currency);
  if (changePercent === null || changePercent === undefined || !Number.isFinite(changePercent)) {
    return `${label} ${priceText}`;
  }
  const sign = changePercent > 0 ? '+' : '';
  return `${label} ${priceText} (${sign}${changePercent.toFixed(1)}%)`;
}

function formatMargin(
  value: number | null,
  language: ReportLanguage,
  currency = 'USD',
  referencePrice: number | null = null,
) {
  if (value === null && referencePrice === null) return language === 'ko' ? '안전마진 N/A' : 'Margin N/A';
  if (referencePrice !== null) {
    const label = language === 'ko' ? '안전가' : 'Safety Price';
    const pct = value !== null ? ` · ${formatSignedPercent(value)}` : '';
    return `${label} ${formatMoney(referencePrice, currency, { maximumFractionDigits: 0 })}${pct}`;
  }
  return `${language === 'ko' ? '안전마진' : 'Margin'} ${formatSignedPercent(value as number)}`;
}

function formatTimestamp(
  value: string | null | undefined,
  language: ReportLanguage,
  labelKey: string,
  fallbackKo: string,
  fallbackEn: string,
) {
  const label = t(labelKey, language);
  if (!value) return `${label} ${language === 'ko' ? fallbackKo : fallbackEn}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${label} ${language === 'ko' ? fallbackKo : fallbackEn}`;
  return `${label} ${date.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

function MetricChip({
  children,
  help,
  mono = false,
}: {
  children: ReactNode;
  help: string;
  mono?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex cursor-help items-center rounded-full border border-border/60 bg-background/70 px-2 py-1 outline-none transition-colors hover:border-primary/40 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-primary/50',
            mono && 'font-mono',
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-sm border border-border bg-popover px-3 py-2 text-left text-xs leading-relaxed text-popover-foreground shadow-lg"
      >
        {help}
      </TooltipContent>
    </Tooltip>
  );
}

export function ReportHeaderRibbon({
  ticker,
  displayTicker,
  activeAgent,
  activeReport,
  compositeScore,
  currentPrice,
  marginOfSafety,
  marginReferencePrice,
  currency = 'USD',
  analysisGeneratedAt,
  marketDataUpdatedAt,
  extendedPrice,
  extendedChangePercent,
  extendedSession,
  language,
  onRefreshMarketData,
  isRefreshingMarketData,
  onCompareSourceClick,
  onSave,
  isSaving,
}: ReportHeaderRibbonProps) {
  const scoreBand = getScoreBand(compositeScore, language);
  const scoreClasses = toneToClasses(scoreBand.tone);
  const signal = activeReport?.signal ? String(activeReport.signal) : '';
  const signalClasses = toneToClasses(signal ? getSignalTone(signal) : 'neutral');
  const confidence = activeReport?.confidence ?? null;
  const normalizedConfidence = confidence === null || confidence === undefined
    ? null
    : Math.round(Number(confidence) <= 1 ? Number(confidence) * 100 : Number(confidence));

  return (
    <header className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-background via-muted/20 to-background shadow-sm">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <ScoreGaugeCompact score={compositeScore} />
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                {language === 'ko' ? activeAgent.categoryKo : activeAgent.categoryEn}
              </Badge>
              <Badge variant="outline" className={scoreClasses.badge}>
                {scoreBand.label}
              </Badge>
              {signal && (
                <Badge variant="outline" className={signalClasses.badge}>
                  {signalToVerdict(signal, language)}
                </Badge>
              )}
              {normalizedConfidence !== null && Number.isFinite(normalizedConfidence) && (
                <Badge variant="outline" className="border-blue-500/25 bg-blue-500/10 text-blue-500">
                  {normalizedConfidence}%
                </Badge>
              )}
              {activeReport?.data_coverage !== undefined && activeReport.data_coverage !== null && (
                <Badge variant="outline" className={cn(
                  'text-[10px] px-1 py-0',
                  activeReport.data_coverage < 0.4 ? 'border-red-500/40 text-red-600' :
                  activeReport.data_coverage < 0.6 ? 'border-amber-500/40 text-amber-600' :
                  'border-emerald-500/40 text-emerald-600',
                )}>
                  {dataCoverageLabel(activeReport.data_coverage, language)}
                </Badge>
              )}
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground" title={ticker}>
              {displayTicker} · {activeAgent.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {language === 'ko'
                ? '문서형 분석 리포트 · 숫자 칩과 출처 추적 포함'
                : 'Document-style analyst report with data chips and source tracing'}
            </p>
            <TooltipProvider delayDuration={120}>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <MetricChip help={t('currentPriceHelp', language)} mono>
                  {formatCurrentPrice(currentPrice, language, currency)}
                </MetricChip>
                {extendedPrice !== null && extendedPrice !== undefined && extendedPrice > 0 && extendedSession && (
                  <MetricChip help={t('extendedPriceHelp', language)} mono>
                    <span
                      className={cn(
                        extendedChangePercent !== null && extendedChangePercent !== undefined && Number.isFinite(extendedChangePercent)
                          ? extendedChangePercent > 0
                            ? 'text-emerald-600'
                            : extendedChangePercent < 0
                              ? 'text-red-600'
                              : 'text-muted-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {formatExtendedPrice(extendedPrice, extendedChangePercent, extendedSession, language, currency)}
                    </span>
                  </MetricChip>
                )}
                <MetricChip help={t('marginOfSafetyHelp', language)} mono>
                  {formatMargin(marginOfSafety, language, currency, marginReferencePrice)}
                </MetricChip>
                <MetricChip help={t('reportGeneratedAtHelp', language)}>
                  {formatTimestamp(analysisGeneratedAt, language, 'reportGeneratedAtLabel', 'N/A', 'N/A')}
                </MetricChip>
                {marketDataUpdatedAt && (
                  <MetricChip help={t('marketDataUpdatedAtHelp', language)}>
                    {formatTimestamp(marketDataUpdatedAt, language, 'marketDataUpdatedAtLabel', 'N/A', 'N/A')}
                  </MetricChip>
                )}
              </div>
            </TooltipProvider>
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2 lg:justify-end">
          {onRefreshMarketData && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={onRefreshMarketData}
              disabled={isRefreshingMarketData}
            >
              {isRefreshingMarketData
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              {t('refreshMarketDataButton', language)}
            </Button>
          )}
          <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => window.print()}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            {t('pdfExportButton', language)}
          </Button>
          <Button variant="outline" size="sm" className="min-h-[44px]" onClick={onCompareSourceClick}>
            <SearchCode className="mr-1.5 h-3.5 w-3.5" />
            {t('compareSourceButton', language)}
          </Button>
          {onSave && (
            <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={onSave} disabled={isSaving}>
              {isSaving
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Database className="mr-1.5 h-3.5 w-3.5" />}
              {t('reportHeaderSave', language)}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
