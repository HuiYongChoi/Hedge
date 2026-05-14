import { t } from '@/lib/language-preferences';
import { signalTone, formatMultiple, formatPct, upsideClass, upsidePct, impliedFwdPe, formatDaysAgo } from './utils';
import type { BrokerTarget, ReportLanguage } from './types';

interface BrokerCalloutCardProps {
  broker: BrokerTarget;
  currentPrice: number | null;
  forwardEps: number | null;
  trailingPe: number | null;
  trailingEps: number | null;
  isHovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  language: ReportLanguage;
}

export function BrokerCalloutCard({
  broker,
  currentPrice,
  forwardEps,
  trailingPe,
  trailingEps,
  isHovered,
  onHoverChange,
  language,
}: BrokerCalloutCardProps) {
  const tone = signalTone(broker.signal);
  const upside = upsidePct(broker.target_price, currentPrice);
  const fwd_pe = impliedFwdPe(broker.target_price, forwardEps);
  const isStale = broker.days_ago > 90;
  const daysLabel = formatDaysAgo(broker.days_ago, language);

  // Abbreviate broker name for compact view — 10 chars for readability
  const shortName = broker.name.length > 10 ? broker.name.slice(0, 10) : broker.name;

  const signalLabel = broker.signal === 'BUY'
    ? t('pcpSignalBuy', language)
    : broker.signal === 'HOLD'
    ? t('pcpSignalHold', language)
    : broker.signal === 'SELL'
    ? t('pcpSignalSell', language)
    : t('pcpSignalNeutral', language);

  return (
    <div
      className={[
        'rounded-lg border transition-all duration-150 ease-out cursor-default select-none',
        isHovered
          ? `${tone.border} bg-card z-30 min-w-[180px] shadow-xl`
          : 'border-border/60 bg-card z-10 w-28',
      ].join(' ')}
      style={{ minHeight: '64px' }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      {isHovered ? (
        /* ── EXPANDED VIEW ── */
        <div className="p-2 space-y-1">
          {/* Name + signal badge */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{broker.name}</span>
            <span className={`rounded px-1 py-0.5 text-[11px] font-bold uppercase border ${tone.text} ${tone.border} ${tone.bg}`}>
              {signalLabel}
            </span>
          </div>
          {/* Price + upside */}
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-base font-bold text-foreground">${broker.target_price.toFixed(0)}</span>
            {upside !== null && (
              <span className={`font-mono text-xs font-medium ${upsideClass(upside)}`}>
                {formatPct(upside)}
              </span>
            )}
          </div>
          {/* Divider */}
          <div className="border-t border-border/40 my-1" />
          {/* Detail rows */}
          <div className="space-y-0.5">
            <div className="flex justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">PER (TTM)</span>
              <span className="text-xs font-mono text-foreground">{formatMultiple(trailingPe)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">EPS (TTM)</span>
              <span className="text-xs font-mono text-foreground">
                {trailingEps != null ? `$${trailingEps.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">{t('pcpBrokerFwdPer', language)}</span>
              <span className="text-xs font-mono text-foreground">{formatMultiple(fwd_pe)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">FWD EPS</span>
              <span className="text-xs font-mono text-foreground">
                {forwardEps != null ? `$${forwardEps.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-3 border-t border-border/30 pt-0.5 mt-0.5">
              <span className="text-[11px] text-muted-foreground">Updated</span>
              <span className={`text-xs font-mono ${isStale ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
                {daysLabel}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ── COLLAPSED (112×64) VIEW ── */
        <div className="p-2 flex flex-col gap-0.5 h-16 w-28">
          {/* Row 1: broker 이름 + signal dot */}
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold text-foreground truncate leading-tight">
              {shortName}
            </span>
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tone.dot}`} />
          </div>
          {/* Row 2: target price — 가장 큰 글씨 */}
          <span className="font-mono text-sm font-bold text-foreground leading-tight">
            ${broker.target_price.toFixed(0)}
          </span>
          {/* Row 3: upside % */}
          {upside !== null && (
            <span className={`font-mono text-[11px] leading-tight ${upsideClass(upside)}`}>
              {formatPct(upside)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
