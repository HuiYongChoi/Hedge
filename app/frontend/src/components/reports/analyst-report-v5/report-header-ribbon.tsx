import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/lib/language-preferences';
import { Database, FileText, Loader2, SearchCode } from 'lucide-react';
import { dataCoverageLabel, getScoreBand, getSignalTone, signalToVerdict, toneToClasses } from './helpers';
import type { AgentMeta, AgentReport, ReportLanguage } from './types';

interface ReportHeaderRibbonProps {
  ticker: string;
  activeAgent: AgentMeta;
  activeReport: AgentReport | null;
  compositeScore: number;
  currentPrice: number | null;
  marginOfSafety: number | null;
  language: ReportLanguage;
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

function formatCurrentPrice(value: number | null, language: ReportLanguage) {
  if (value === null) return language === 'ko' ? '현재가 N/A' : 'Price N/A';
  return `${language === 'ko' ? '현재가' : 'Price'} $${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatMargin(value: number | null, language: ReportLanguage) {
  if (value === null) return language === 'ko' ? '안전마진 N/A' : 'Margin N/A';
  return `${language === 'ko' ? '안전마진' : 'Margin'} ${(value * 100).toFixed(1)}%`;
}

export function ReportHeaderRibbon({
  ticker,
  activeAgent,
  activeReport,
  compositeScore,
  currentPrice,
  marginOfSafety,
  language,
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
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {ticker} · {activeAgent.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {language === 'ko'
                ? '문서형 분석 리포트 · 숫자 칩과 출처 추적 포함'
                : 'Document-style analyst report with data chips and source tracing'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border/60 bg-background/70 px-2 py-1 font-mono">
                {formatCurrentPrice(currentPrice, language)}
              </span>
              <span className="rounded-full border border-border/60 bg-background/70 px-2 py-1 font-mono">
                {formatMargin(marginOfSafety, language)}
              </span>
              <span className="rounded-full border border-border/60 bg-background/70 px-2 py-1">
                {t('periodLabelHeader', language)} · {language === 'ko' ? '최근 분석' : 'Latest run'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" className="min-h-[44px]" disabled aria-disabled="true" title={t('comingSoonLabel', language)}>
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
