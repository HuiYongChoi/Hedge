import { t } from '@/lib/language-preferences';
import { formatPct, upsideClass } from './utils';
import type { TargetDistribution, ReportLanguage } from './types';

interface OpinionDistributionProps {
  distribution: TargetDistribution | null;
  currentPrice: number | null;
  language: ReportLanguage;
}

interface BarRowProps {
  label: string;
  count: number;
  total: number;
  barClass: string;
}

function BarRow({ label, count, total, barClass }: BarRowProps) {
  const widthPct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-12 flex-shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barClass}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="w-4 flex-shrink-0 text-right font-mono text-muted-foreground">{count}</span>
    </div>
  );
}

export function OpinionDistribution({ distribution, currentPrice, language }: OpinionDistributionProps) {
  if (!distribution) return null;

  const avgUpside = distribution.average != null && currentPrice
    ? ((distribution.average - currentPrice) / currentPrice) * 100
    : null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/5 p-3 space-y-3">
      {/* Title */}
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('pcpOpinionTitle', language)}
        <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">
          · n={distribution.total}
        </span>
      </h4>

      {/* Distribution bars */}
      <div className="space-y-1.5">
        <BarRow
          label={t('pcpSignalBuy', language)}
          count={distribution.buy}
          total={distribution.total}
          barClass="bg-emerald-500/70"
        />
        <BarRow
          label={t('pcpSignalHold', language)}
          count={distribution.hold}
          total={distribution.total}
          barClass="bg-amber-400/70"
        />
        <BarRow
          label={t('pcpSignalNeutral', language)}
          count={distribution.neutral}
          total={distribution.total}
          barClass="bg-sky-400/70"
        />
        <BarRow
          label={t('pcpSignalSell', language)}
          count={distribution.sell}
          total={distribution.total}
          barClass="bg-rose-500/70"
        />
      </div>

      {/* Footer stats */}
      <div className="grid grid-cols-3 gap-1 border-t border-border/40 pt-2">
        <div className="text-center">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('pcpOpinionAvg', language)}</div>
          {distribution.average != null ? (
            <>
              <div className="font-mono text-sm font-semibold text-foreground">
                ${Math.round(distribution.average)}
              </div>
              {avgUpside != null && (
                <div className={`font-mono text-[9px] ${upsideClass(avgUpside)}`}>
                  {formatPct(avgUpside)}
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground/50">—</div>
          )}
        </div>
        <div className="text-center">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('pcpOpinionMedian', language)}</div>
          {distribution.median != null ? (
            <div className="font-mono text-sm font-semibold text-foreground">
              ${Math.round(distribution.median)}
            </div>
          ) : (
            <div className="text-muted-foreground/50">—</div>
          )}
        </div>
        <div className="text-center">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('pcpOpinionStdev', language)}</div>
          {distribution.stdev != null ? (
            <>
              <div className="font-mono text-sm font-semibold text-foreground">
                ${Math.round(distribution.stdev)}
              </div>
              <div className="text-[9px] text-muted-foreground/60">{t('pcpOpinionSpread', language)}</div>
            </>
          ) : (
            <div className="text-muted-foreground/50">—</div>
          )}
        </div>
      </div>
    </div>
  );
}
