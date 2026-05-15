import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from '../types';
import type { RimBreakdown } from './types';
import { formatPriceExact, formatPct, gapPillClass } from './utils';

interface RimDetailCardProps {
  rim: RimBreakdown;
  currentPrice: number | null;
  currency: string;
  language: ReportLanguage;
}

export function RimDetailCard({ rim, currentPrice, currency, language }: RimDetailCardProps) {
  const total = rim.intrinsicTotal;
  const bvPct = total > 0 ? Math.max(0, rim.bookValue / total) * 100 : 100;
  const exPct = total > 0 ? Math.max(0, rim.presentValueRi / total) * 100 : 0;
  const tvPct = total > 0 ? Math.max(0, rim.terminalPvRi / total) * 100 : 0;

  const gap = rim.intrinsicPerShare !== null && currentPrice && currentPrice > 0
    ? (rim.intrinsicPerShare - currentPrice) / currentPrice
    : null;

  return (
    <div className="rounded-xl border border-border/60 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{t('rimPanelTitle', language)}</h4>
        {rim.intrinsicPerShare !== null && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold text-white">
              {formatPriceExact(rim.intrinsicPerShare, currency)}
            </span>
            {gap !== null && (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${gapPillClass(gap)}`}>
                {formatPct(gap)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stacked composition bar */}
      <div className="mb-1 flex h-3 overflow-hidden rounded">
        <div style={{ flexBasis: `${bvPct}%` }} className="bg-sky-500 min-w-0" />
        <div style={{ flexBasis: `${exPct}%` }} className="bg-emerald-500 min-w-0" />
        <div style={{ flexBasis: `${tvPct}%` }} className="bg-amber-500 min-w-0" />
      </div>
      <div className="mb-3 flex gap-4 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-sky-500" />
          <span className="text-muted-foreground">{t('rimCompositionBV', language)} {bvPct.toFixed(0)}%</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
          <span className="text-muted-foreground">{t('rimCompositionExcess', language)} {exPct.toFixed(0)}%</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" />
          <span className="text-muted-foreground">{t('rimCompositionTerminal', language)} {tvPct.toFixed(0)}%</span>
        </span>
      </div>

      {/* Stats row */}
      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
        {[
          { label: t('rimStatRoe', language), value: `${(rim.roeImplied * 100).toFixed(1)}%` },
          { label: t('rimStatKe', language), value: `${(rim.costOfEquity * 100).toFixed(1)}%` },
          {
            label: t('rimStatSpread', language),
            value: `${rim.spreadRoeKe >= 0 ? '+' : ''}${(rim.spreadRoeKe * 100).toFixed(1)}%`,
            valueClass: rim.spreadRoeKe > 0 ? 'text-emerald-300' : rim.spreadRoeKe < 0 ? 'text-red-400' : 'text-amber-300',
          },
          { label: t('rimStatBvGrowth', language), value: `${(rim.bookValueGrowth * 100).toFixed(1)}%` },
        ].map(({ label, value, valueClass }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{label}</span>
            <span className={`font-mono text-sm font-semibold text-white ${valueClass ?? ''}`}>{value}</span>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t('rimFootnote', language)}</p>
    </div>
  );
}
