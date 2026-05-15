import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from '../types';
import type { PbrBand } from './types';
import { formatPriceExact, formatMultiple, positionLabelColor } from './utils';
import { PbrThermometer } from './pbr-thermometer';

interface PbrBandCardProps {
  pbr: PbrBand;
  currency: string;
  language: ReportLanguage;
}

const POSITION_KEY: Record<PbrBand['positionLabel'], string> = {
  below_p25: 'pbrPositionBelowP25',
  p25_p50: 'pbrPositionP25P50',
  p50_p75: 'pbrPositionP50P75',
  above_p75: 'pbrPositionAboveP75',
};

export function PbrBandCard({ pbr, currency, language }: PbrBandCardProps) {
  const { percentiles, history } = pbr;

  return (
    <div className="rounded-xl border border-border/60 bg-background p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{t('pbrPanelTitle', language)}</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('pbrCurrentLabel', language)}
          </span>
          <span className={`font-mono text-sm font-bold ${positionLabelColor(pbr.positionLabel)}`}>
            {formatMultiple(pbr.currentPbr)}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${
            pbr.positionLabel === 'below_p25'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : pbr.positionLabel === 'above_p75'
                ? 'bg-red-500/20 text-red-400 border-red-500/40'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          }`}>
            {t(POSITION_KEY[pbr.positionLabel], language)}
          </span>
        </div>
      </div>

      {/* Thermometer */}
      <PbrThermometer
        p10={percentiles.p10}
        p90={percentiles.p90}
        percentiles={percentiles}
        currentPbr={pbr.currentPbr}
      />

      {/* Implied price chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground self-center mr-1">
          {t('pbrPriceImpliedLabel', language)}
        </span>
        {[
          { label: 'P25', price: pbr.fairPriceP25 },
          { label: 'P50', price: pbr.fairPriceP50 },
          { label: 'P75', price: pbr.fairPriceP75 },
          { label: 'P90', price: pbr.fairPriceP90 },
        ].map(({ label, price }) => (
          <span
            key={label}
            className="rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-[11px] font-mono"
          >
            <span className="text-muted-foreground mr-1">{label}</span>
            <span className="text-white">{formatPriceExact(price, currency)}</span>
          </span>
        ))}
        {pbr.currentPrice !== null && (
          <span className={`rounded-md border px-2 py-1 text-[11px] font-mono font-semibold ${
            pbr.positionLabel === 'above_p75'
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-border/40 bg-muted/20 text-white'
          }`}>
            <span className="text-muted-foreground mr-1">현재</span>
            {formatPriceExact(pbr.currentPrice, currency)}
          </span>
        )}
      </div>

      {/* Sparkline — pure SVG polyline */}
      {history.length >= 3 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] text-muted-foreground">{t('pbrSparklineLabel', language)}</div>
          <PbrSparkline history={history} p50={percentiles.p50} />
        </div>
      )}

      {/* Re-rating banner */}
      {pbr.reratingNote && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          ⚡ {pbr.reratingNote}
        </div>
      )}
    </div>
  );
}

function PbrSparkline({
  history,
  p50,
}: {
  history: Array<{ period: string; pbr: number }>;
  p50: number;
}) {
  const vals = history.map(h => h.pbr);
  const minV = Math.min(...vals, p50) * 0.9;
  const maxV = Math.max(...vals, p50) * 1.1;
  const range = maxV - minV || 1;
  const W = 200, H = 40;

  const toX = (i: number) => (i / (vals.length - 1)) * W;
  const toY = (v: number) => H - ((v - minV) / range) * H;

  const points = vals.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const p50y = toY(p50);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '40px' }}>
      <line x1="0" y1={p50y} x2={W} y2={p50y} stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="2,2" opacity="0.5" />
      <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth="1.2" />
      {vals.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r="1.5" fill="#60a5fa" />
      ))}
    </svg>
  );
}
