import { signalTone, formatMoney, formatPct, upsideClass, upsidePct } from './utils';
import type { BrokerTarget } from './types';

interface BrokerCalloutCardProps {
  broker: BrokerTarget;
  currentPrice: number | null;
  isHovered: boolean;
  currency: string;
  onHoverChange: (hovered: boolean) => void;
}

export function BrokerCalloutCard({
  broker,
  currentPrice,
  isHovered,
  currency,
  onHoverChange,
}: BrokerCalloutCardProps) {
  const tone = signalTone(broker.signal);
  const upside = upsidePct(broker.target_price, currentPrice);

  // Abbreviate broker name for compact view — 10 chars for readability
  const shortName = broker.name.length > 10 ? broker.name.slice(0, 10) : broker.name;

  return (
    <div
      className={[
        'rounded-lg border bg-card transition-all duration-150 ease-out cursor-default select-none',
        isHovered ? `${tone.border} shadow-lg` : 'border-border/60',
      ].join(' ')}
      style={{ width: '112px', minHeight: '60px' }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="p-2 flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-white truncate leading-tight">
            {shortName}
          </span>
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tone.dot}`} />
        </div>
        <span className="font-mono text-base font-bold text-white leading-tight">
          {formatMoney(broker.target_price, currency, { maximumFractionDigits: 0 })}
        </span>
        {upside !== null && (
          <span className={`font-mono text-xs leading-tight ${upsideClass(upside)}`}>
            {formatPct(upside)}
          </span>
        )}
      </div>
    </div>
  );
}
