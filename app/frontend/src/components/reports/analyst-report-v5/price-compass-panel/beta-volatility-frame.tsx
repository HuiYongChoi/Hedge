import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from './types';
import { formatMoney } from './utils';

interface BetaVolatilityFrameProps {
  beta: number | null;
  sigmaAnnual: number | null;
  sigmaIsRealized?: boolean;
  currentPrice: number | null;
  ticker: string;
  simBeta: number;
  onSimBetaChange: (next: number) => void;
  currency: string;
  language: ReportLanguage;
}

const MARKET_SIGMA = 0.14;

export function BetaVolatilityFrame({
  beta,
  sigmaAnnual,
  sigmaIsRealized = false,
  currentPrice,
  ticker,
  simBeta,
  onSimBetaChange,
  currency,
  language,
}: BetaVolatilityFrameProps) {
  const sliderMax = beta != null ? Math.max(2.5, Math.ceil((beta * 1.3) / 0.5) * 0.5) : 2.5;

  // Compute ±2σ price range using simBeta
  const sigma = simBeta * MARKET_SIGMA;
  const lo = currentPrice != null ? Math.round(currentPrice * (1 - 2 * sigma)) : null;
  const hi = currentPrice != null ? Math.round(currentPrice * (1 + 2 * sigma)) : null;

  const explainText = (lo != null && hi != null)
    ? t('pcpBetaExplain', language)
        .replace(/{beta}/g, simBeta.toFixed(2))
        .replace('{ticker}', ticker)
        .replace('{low}', formatMoney(lo, currency, { maximumFractionDigits: 0 }))
        .replace('{high}', formatMoney(hi, currency, { maximumFractionDigits: 0 }))
    : '';

  return (
    <div className="rounded-xl border border-border/60 bg-muted/5 p-3 space-y-3">
      {/* Title */}
      <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
        {t('pcpBetaFrameTitle', language)}
      </h4>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/40 bg-background/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-foreground/70">{t('pcpBetaLabel', language)}</div>
          {beta != null ? (
            <div className="font-mono text-2xl font-bold text-white">{beta.toFixed(2)}</div>
          ) : (
            <div className="font-mono text-sm text-foreground/45">—</div>
          )}
          <div className="text-[10px] text-foreground/60">{t('pcpBetaSub', language)}</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/50 p-2">
          <div className="text-[11px] uppercase tracking-wide text-foreground/70">{t('pcpSigmaLabel', language)}</div>
          {sigmaAnnual != null ? (
            <div className="font-mono text-2xl font-bold text-white">
              {(sigmaAnnual * 100).toFixed(1)}%
            </div>
          ) : (
            <div className="font-mono text-sm text-foreground/45">—</div>
          )}
          <div className="text-[10px] text-foreground/60">
            {t(sigmaIsRealized ? 'pcpSigmaSubRealized' : 'pcpSigmaSub', language)}
          </div>
        </div>
      </div>

      {/* Slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-foreground/65">
          <span>β 0.0</span>
          <span className="text-xs font-semibold text-white">β {simBeta.toFixed(2)}</span>
          <span>β {sliderMax.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={0.05}
          value={simBeta}
          disabled={beta == null}
          onChange={e => onSimBetaChange(parseFloat(e.target.value))}
          className="w-full h-1.5 cursor-pointer accent-sky-400 disabled:opacity-40"
          aria-label="Simulate beta"
        />
      </div>

      {/* Explanation */}
      {explainText && (
        <p className="rounded-md border border-border/30 bg-muted/10 px-2 py-1.5 text-xs leading-relaxed text-foreground/75">
          {explainText}
        </p>
      )}
      {beta == null && (
        <p className="text-xs text-foreground/45">β 데이터 없음</p>
      )}
    </div>
  );
}
