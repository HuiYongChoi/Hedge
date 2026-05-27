import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from './types';

type StickyVerdict = 'buy' | 'sell' | 'hold' | 'on_hold';

interface StickyAnalysisHeaderProps {
  ticker: string;
  companyName: string | null;
  country: string | null;
  currentPrice: number | null;
  currency: string;
  priceChangePct: number | null;
  verdict: StickyVerdict;
  verdictConfidence: number | null;
  marginOfSafetyPct: number | null;
  wacc: number | null;
  language: ReportLanguage;
  placement?: 'report' | 'tabHeader';
}

function formatCurrency(value: number | null, currency: string, language: ReportLanguage) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return t('stickyPriceUnavailable', language);
  }
  const code = currency.toUpperCase();
  if (code === 'KRW') return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  if (code === 'JPY') return `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US', { maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function normalizeConfidence(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function verdictLabel(verdict: StickyVerdict, language: ReportLanguage) {
  if (verdict === 'buy') return t('verdictBuy', language);
  if (verdict === 'sell') return t('verdictSell', language);
  return t('verdictHold', language);
}

function verdictClasses(verdict: StickyVerdict) {
  if (verdict === 'buy') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (verdict === 'sell') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
}

function VerdictChip({
  verdict,
  confidence,
  language,
}: {
  verdict: StickyVerdict;
  confidence: number | null;
  language: ReportLanguage;
}) {
  const normalizedConfidence = normalizeConfidence(confidence);
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdictClasses(verdict)}`}>
      <span>{verdictLabel(verdict, language)}</span>
      {normalizedConfidence !== null && (
        <span className="ml-1.5 font-mono text-[10px] opacity-90">
          {t('stickyConfidenceLabel', language)} {Math.round(normalizedConfidence)}
        </span>
      )}
    </span>
  );
}

export function StickyAnalysisHeader({
  ticker,
  companyName,
  country,
  currentPrice,
  currency,
  priceChangePct,
  verdict,
  verdictConfidence,
  marginOfSafetyPct,
  wacc,
  language,
  placement = 'report',
}: StickyAnalysisHeaderProps) {
  const isTabHeader = placement === 'tabHeader';

  return (
    <div
      className={isTabHeader
        ? 'mt-3 border-t border-border/60 pt-3'
        : 'sticky top-0 z-30 -mx-4 mb-4 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70'}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{ticker}</span>
          {companyName && (
            <span className="truncate text-xs font-medium text-muted-foreground">{companyName}</span>
          )}
          {country && (
            <span className="rounded border border-border/60 px-1 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
              {country}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatCurrency(currentPrice, currency, language)}
          </span>
          {priceChangePct !== null && priceChangePct !== undefined && Number.isFinite(priceChangePct) && (
            <span className={`font-mono text-xs ${priceChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {priceChangePct > 0 ? '+' : ''}{(priceChangePct * 100).toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 overflow-hidden text-[11px] text-muted-foreground sm:gap-3">
        <VerdictChip verdict={verdict} confidence={verdictConfidence} language={language} />
        <span className="text-border">·</span>
        <span className="whitespace-nowrap">
          {t('targetMarginLabel', language)} <span className="font-mono text-foreground">{formatPercent(marginOfSafetyPct, true)}</span>
        </span>
        <span className="hidden text-border sm:inline">·</span>
        <span className="hidden whitespace-nowrap sm:inline">
          {t('targetWaccLabel', language)} <span className="font-mono text-foreground">{formatPercent(wacc)}</span>
        </span>
      </div>
    </div>
  );
}
