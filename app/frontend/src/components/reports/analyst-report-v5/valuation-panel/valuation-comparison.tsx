import { useState } from 'react';
import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from '../types';
import type { ValuationDeepDive, ValuationModel } from './types';
import { formatPriceExact, formatPct, gapPillClass } from './utils';

interface ValuationComparisonCardProps {
  dive: ValuationDeepDive;
  currentPrice: number | null;
  currency: string;
  language: ReportLanguage;
}

function ModelColumn({
  model,
  currency,
  language,
}: {
  model: ValuationModel;
  currency: string;
  language: ReportLanguage;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/40 bg-card/40 px-3 py-3 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
        {t(model.labelKey, language)}
      </span>
      <span className="font-mono text-lg font-bold text-white truncate">
        {formatPriceExact(model.intrinsicPerShare, currency)}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {model.gapToMarket !== null && (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${gapPillClass(model.gapToMarket)}`}>
            {formatPct(model.gapToMarket)}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {t('valuationWeightLabel', language)} {(model.weight * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

export function ValuationComparisonCard({
  dive,
  currentPrice: _currentPrice,
  currency,
  language,
}: ValuationComparisonCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cols = Math.min(Math.max(dive.models.length, 2), 5);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">
          {t('valuationCompareTitle', language)}
        </h4>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          dive.regime === 'capex_heavy'
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
            : 'bg-muted/30 text-muted-foreground border-border/40'
        }`}>
          {t(dive.regime === 'capex_heavy' ? 'valuationRegimeCapex' : 'valuationRegimeDefault', language)}
        </span>
      </div>

      {/* Model grid */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {dive.models.map(model => (
          <ModelColumn
            key={model.key}
            model={model}
            currency={currency}
            language={language}
          />
        ))}
      </div>

      {/* "왜 다를까?" expandable */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{t('valuationCompareWhy', language)}</span>
        <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-border/40 bg-muted/10 p-3">
          {dive.regimeNote && (
            <p className="text-[11px] text-amber-300">{dive.regimeNote}</p>
          )}
          {dive.models.map(m => (
            <p key={m.key} className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/70">{t(m.labelKey, language)}: </span>
              {/* details would come from raw reasoning via a separate prop — omit for brevity */}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
