import { FileText } from 'lucide-react';
import { signalTone, formatMoney, formatPct, upsideClass, upsidePct } from './utils';
import type { BrokerTarget } from './types';

interface BrokerCalloutCardProps {
  broker: BrokerTarget;
  currentPrice: number | null;
  isHovered: boolean;
  currency: string;
  /** 이 증권사가 이 종목에 대해 낸 리포트 수 (0이면 배지·클릭 모두 없음) */
  reportCount: number;
  reportHint: string;
  onHoverChange: (hovered: boolean) => void;
  onSelect: () => void;
}

export function BrokerCalloutCard({
  broker,
  currentPrice,
  isHovered,
  currency,
  reportCount,
  reportHint,
  onHoverChange,
  onSelect,
}: BrokerCalloutCardProps) {
  const tone = signalTone(broker.signal);
  const upside = upsidePct(broker.target_price, currentPrice);
  const clickable = reportCount > 0;

  // Abbreviate broker name for compact view — 10 chars for readability
  const shortName = broker.name.length > 10 ? broker.name.slice(0, 10) : broker.name;

  return (
    <div
      className={[
        'rounded-lg border bg-card transition-all duration-150 ease-out select-none',
        clickable
          ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60'
          : 'cursor-default',
        isHovered ? `${tone.border} shadow-lg` : 'border-border/60',
      ].join(' ')}
      style={{ width: '112px', minHeight: '60px' }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onClick={clickable ? onSelect : undefined}
      onKeyDown={clickable ? e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? reportHint : undefined}
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
        <div className="flex items-center justify-between gap-1">
          {upside !== null ? (
            <span className={`font-mono text-xs leading-tight ${upsideClass(upside)}`}>
              {formatPct(upside)}
            </span>
          ) : <span />}
          {clickable && (
            <span className="flex items-center gap-0.5 text-[10px] leading-none text-emerald-400/90">
              <FileText className="h-2.5 w-2.5" />
              {reportCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
