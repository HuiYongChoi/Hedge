import { t } from '@/lib/language-preferences';
import { signalTone } from './utils';
import type { BrokerTarget, SigmaMark, ReportLanguage } from './types';

interface BrokerTargetBarProps {
  range: { min: number; max: number };
  currentPrice: number | null;
  consensus: number | null;
  intrinsic: number | null;
  mos: number | null;
  brokers: BrokerTarget[];
  sigmaMarks: SigmaMark[];
  hoveredBroker: string | null;
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
  language,
}: BrokerTargetBarProps) {
  const span = range.max - range.min;
  if (span <= 0) return null;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - range.min) / span) * 100));

  return (
    <div className="w-full">
      {/* Range scenario labels */}
      <div className="mb-1 flex justify-between text-[10px] font-medium">
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
              <div className="absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-muted-foreground/70">
                {mark.label}
              </div>
              {/* Price label */}
              <div className="absolute top-full mt-[18px] -translate-x-1/2 whitespace-nowrap font-mono text-[8px] text-muted-foreground/50">
                ${Math.round(mark.value)}
              </div>
            </div>
          );
        })}

        {/* Broker tick marks (thin coloured lines on bar) */}
        {brokers.map(broker => {
          const x = pct(broker.target_price);
          const tone = signalTone(broker.signal);
          const isHovered = hoveredBroker === broker.name;
          return (
            <div
              key={broker.name}
              className="absolute top-0 h-full"
              style={{ left: `${x}%` }}
              title={`${broker.name}: $${broker.target_price}`}
            >
              <div
                className={`absolute inset-y-0 ${isHovered ? 'w-1' : 'w-0.5'} -translate-x-1/2 rounded-full transition-all duration-150 ${tone.dot} opacity-90`}
              />
            </div>
          );
        })}

        {/* Special markers: MoS (★) and DCF (▲) — above the bar */}
        {mos !== null && (
          <div
            className="absolute -top-5 -translate-x-1/2 text-[11px] text-emerald-300"
            style={{ left: `${pct(mos)}%` }}
            title={`${t('pcpMos', language).replace('{pct}', '25')}: $${mos.toFixed(0)}`}
          >
            ★
          </div>
        )}
        {intrinsic !== null && (
          <div
            className="absolute -top-5 -translate-x-1/2 text-[11px] text-emerald-400"
            style={{ left: `${pct(intrinsic)}%` }}
            title={`${t('pcpDcf', language)}: $${intrinsic.toFixed(0)}`}
          >
            ▲
          </div>
        )}

        {/* Consensus marker: amber diamond ring on bar */}
        {consensus !== null && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct(consensus)}%` }}
            title={`${t('pcpLegendConsensus', language)}: $${Math.round(consensus)}`}
          >
            <div className="h-4 w-4 rounded-full border-2 border-amber-400 bg-amber-400/20" />
          </div>
        )}

        {/* Current price: white filled circle */}
        {currentPrice !== null && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct(currentPrice)}%` }}
            title={`${t('pcpLegendCurrent', language)}: $${currentPrice.toFixed(2)}`}
          >
            <div className="h-3 w-3 rounded-full bg-white ring-2 ring-background shadow-md" />
          </div>
        )}
      </div>

      {/* Bottom sigma spacing — leave room for labels */}
      <div className="mt-7" />
    </div>
  );
}
