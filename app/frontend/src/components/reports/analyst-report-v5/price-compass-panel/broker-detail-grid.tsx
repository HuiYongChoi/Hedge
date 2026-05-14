import { t } from '@/lib/language-preferences';
import { signalTone, formatPct, upsideClass, upsidePct, impliedFwdPe, formatMultiple, formatDaysAgo } from './utils';
import type { BrokerTarget, ReportLanguage } from './types';

interface BrokerDetailGridProps {
  brokers: BrokerTarget[];
  currentPrice: number | null;
  forwardEps: number | null;
  hoveredBroker: string | null;
  onHoverChange: (name: string | null) => void;
  language: ReportLanguage;
}

export function BrokerDetailGrid({
  brokers,
  currentPrice,
  forwardEps,
  hoveredBroker,
  onHoverChange,
  language,
}: BrokerDetailGridProps) {
  if (brokers.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('pcpBrokerGridTitle', language)}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {brokers.map(broker => {
          const tone = signalTone(broker.signal);
          const upside = upsidePct(broker.target_price, currentPrice);
          const fwdPe = impliedFwdPe(broker.target_price, forwardEps);
          const isHovered = hoveredBroker === broker.name;
          const isStale = broker.days_ago > 90;

          const signalLabel = broker.signal === 'BUY'
            ? t('pcpSignalBuy', language)
            : broker.signal === 'HOLD'
            ? t('pcpSignalHold', language)
            : broker.signal === 'SELL'
            ? t('pcpSignalSell', language)
            : t('pcpSignalNeutral', language);

          return (
            <div
              key={broker.name}
              className={[
                'rounded-lg border p-2.5 cursor-default transition-all duration-150',
                isHovered
                  ? `${tone.border} ${tone.bg}`
                  : 'border-border/50 hover:border-border/80 bg-background',
              ].join(' ')}
              onMouseEnter={() => onHoverChange(broker.name)}
              onMouseLeave={() => onHoverChange(null)}
            >
              {/* Row 1: broker name + signal badge */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground truncate">{broker.name}</span>
                <span className={`rounded px-1 py-0.5 text-[10px] font-bold uppercase border ${tone.text} ${tone.border} ${tone.bg}`}>
                  {signalLabel}
                </span>
              </div>

              {/* Row 2: price + upside + fwd PER */}
              <div className="mt-1 flex items-baseline justify-between gap-1">
                <span className="font-mono text-base font-bold text-foreground">
                  ${broker.target_price.toFixed(0)}
                </span>
                {upside !== null && (
                  <span className={`font-mono text-xs ${upsideClass(upside)}`}>
                    {formatPct(upside)}
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {t('pcpBrokerFwdPer', language)} {formatMultiple(fwdPe)}
                </span>
              </div>

              {/* Row 3: days ago */}
              <div className={`mt-0.5 font-mono text-[10px] ${isStale ? 'text-muted-foreground/40' : 'text-muted-foreground/60'}`}>
                {formatDaysAgo(broker.days_ago, language)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
