import { t } from '@/lib/language-preferences';
import type { BrokerTarget, SigmaMark, ReportLanguage } from './types';
import { formatMoney } from './utils';

interface BrokerTargetBarProps {
  range: { min: number; max: number };
  currentPrice: number | null;
  consensus: number | null;
  intrinsic: number | null;
  mos: number | null;
  brokers: BrokerTarget[];
  sigmaMarks: SigmaMark[];
  hoveredBroker: string | null;
  currency: string;
  language: ReportLanguage;
}

export function BrokerTargetBar({
  range,
  currentPrice,
  consensus,
  intrinsic,
  mos,
  brokers,
  sigmaMarks,
  hoveredBroker,
  currency,
  language,
}: BrokerTargetBarProps) {
  const span = range.max - range.min;
  if (span <= 0) return null;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - range.min) / span) * 100));

  return (
    <div className="w-full">
      {/* Range scenario labels */}
      <div className="mb-1 flex justify-between text-xs font-semibold">
        <span className="text-rose-400/80">{t('pcpLegendBear', language)}</span>
        <span className="text-emerald-400/80">{t('pcpLegendBull', language)}</span>
      </div>

      {/* Bar container */}
      <div className="relative">
        {/* Main gradient bar: green(cheap, left) → amber → red(expensive, right) */}
        <div className="h-9 w-full rounded-full bg-gradient-to-r from-emerald-500/70 via-amber-400/60 to-rose-500/70 shadow-inner" />

        {/* Sigma tick marks + labels */}
        {sigmaMarks.map(mark => {
          const x = pct(mark.value);
          if (x < 1 || x > 99) return null;
          return (
            <div key={mark.label} className="absolute top-0 h-full" style={{ left: `${x}%` }}>
              {/* Tick line */}
              <div className="absolute inset-y-0 w-px -translate-x-px bg-background/40" />
              {/* Label below bar */}
              <div className="absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap font-mono text-sm font-bold text-white">
                {mark.label}
              </div>
              {/* Price label */}
              <div className="absolute top-full mt-[22px] -translate-x-1/2 whitespace-nowrap font-mono text-xs font-semibold text-white/85">
                {formatMoney(mark.value, currency, { maximumFractionDigits: 0 })}
              </div>
            </div>
          );
        })}

        {/* Broker tick marks — neutral subtle lines so they don't compete with bar gradient */}
        {brokers.map(broker => {
          const x = pct(broker.target_price);
          const isHovered = hoveredBroker === broker.name;
          return (
            <div
              key={broker.name}
              className="absolute top-0 h-full"
              style={{ left: `${x}%` }}
              title={`${broker.name}: ${formatMoney(broker.target_price, currency, { maximumFractionDigits: 0 })}`}
            >
              <div
                className={`absolute inset-y-0 -translate-x-1/2 rounded-full transition-all duration-150 ${
                  isHovered
                    ? 'w-[3px] bg-white/80'
                    : 'w-px bg-white/30'
                }`}
              />
            </div>
          );
        })}

        {/* Special markers: MoS (★) and DCF (▲) — above the bar */}
        {mos !== null && (
          <div
            className="absolute -top-5 -translate-x-1/2 text-[11px] text-emerald-300"
            style={{ left: `${pct(mos)}%` }}
            title={`${t('pcpMos', language).replace('{pct}', '25')}: ${formatMoney(mos, currency, { maximumFractionDigits: 0 })}`}
          >
            ★
          </div>
        )}
        {intrinsic !== null && (
          <div
            className="absolute -top-5 -translate-x-1/2 text-[11px] text-emerald-400"
            style={{ left: `${pct(intrinsic)}%` }}
            title={`${t('pcpDcf', language)}: ${formatMoney(intrinsic, currency, { maximumFractionDigits: 0 })}`}
          >
            ▲
          </div>
        )}

        {/* Consensus marker: amber diamond ring on bar */}
        {consensus !== null && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct(consensus)}%` }}
            title={`${t('pcpLegendConsensus', language)}: ${formatMoney(consensus, currency, { maximumFractionDigits: 0 })}`}
          >
            <div className="h-4 w-4 rounded-full border-2 border-amber-400 bg-amber-400/20" />
          </div>
        )}

        {/* Current price: vertical white-gray line through bar + price label above */}
        {currentPrice !== null && (
          <div
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct(currentPrice)}%` }}
            title={`${t('pcpLegendCurrent', language)}: ${formatMoney(currentPrice, currency)}`}
          >
            {/* Vertical line extending above and below the bar */}
            <div className="h-12 w-[2px] -translate-y-1/2 rounded-full bg-white/85 shadow-[0_0_4px_rgba(255,255,255,0.4)]" />
            {/* Price label above bar */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[150%] whitespace-nowrap rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm font-bold text-white backdrop-blur-sm">
              {formatMoney(currentPrice, currency)}
            </div>
          </div>
        )}
      </div>

      {/* Bottom sigma spacing — leave room for labels */}
      <div className="mt-8" />
    </div>
  );
}
