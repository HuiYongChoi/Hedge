import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/language-preferences';
import type { CanonicalMetrics, ReportLanguage } from './types';
import { analystTargetService, type AnalystTarget } from '@/services/analyst-target-service';

interface PriceCompassBarProps {
  ticker: string;
  metrics: CanonicalMetrics;
  language: ReportLanguage;
  mosBuffer?: number;
  marketSigma?: number;
}

interface MarkerSpec {
  key: 'current' | 'trailingPer' | 'dcf' | 'mos' | 'consensus' | 'fwdPerFy0' | 'fwdPerFy1';
  label: string;
  value: number;
  toneClass: string;
  lineClass: string;
  subtext?: string;
  fiscalYear?: number | null;
}

interface PositionedMarker extends MarkerSpec {
  pct: number;
  labelSideClass: string;
  labelVerticalClass: string;
}

interface CompassRange {
  min: number;
  max: number;
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function pickFurthestAnnual(
  fy0Year: number | null | undefined,
  fy1Year: number | null | undefined,
): 'fy0' | 'fy1' | 'none' {
  const a = fy0Year ?? null;
  const b = fy1Year ?? null;
  if (b !== null && (a === null || b > a)) return 'fy1';
  if (a !== null) return 'fy0';
  return 'none';
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${value.toFixed(2)}`;
}

function formatMultiple(value: number | undefined): string | undefined {
  return value !== undefined ? `${value.toFixed(1)}x` : undefined;
}

function pctForValue(value: number, range: CompassRange): number {
  const raw = ((value - range.min) / (range.max - range.min)) * 100;
  return Math.min(100, Math.max(0, raw));
}

export function PriceCompassBar({
  ticker,
  metrics,
  language,
  mosBuffer = 0.25,
  marketSigma = 0.20,
}: PriceCompassBarProps) {
  const [target, setTarget] = useState<AnalystTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    analystTargetService.fetch(ticker).then(result => {
      if (!cancelled) setTarget(result);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const current = positiveNumber(metrics.currentPrice?.value) ?? positiveNumber(target?.current_price);
  const intrinsic = positiveNumber(metrics.intrinsicValue?.value);
  const beta = positiveNumber(metrics.beta?.value);
  const defaultPerFy0 = positiveNumber(metrics.forwardPeFy0?.value)
    ?? positiveNumber(metrics.forwardPe?.value)
    ?? positiveNumber(target?.forward_pe);
  const defaultPerFy1 = positiveNumber(metrics.forwardPeFy1?.value)
    ?? (defaultPerFy0 !== undefined ? defaultPerFy0 * 0.9 : undefined);
  const [editedPerFy0, setEditedPerFy0] = useState<number | undefined>(undefined);
  const [editedPerFy1, setEditedPerFy1] = useState<number | undefined>(undefined);
  const effectivePerFy0 = editedPerFy0 ?? defaultPerFy0;
  const effectivePerFy1 = editedPerFy1 ?? defaultPerFy1;
  const hasPerEdits = editedPerFy0 !== undefined || editedPerFy1 !== undefined;
  const resetPer = () => { setEditedPerFy0(undefined); setEditedPerFy1(undefined); };

  const betaBand = useMemo(() => {
    if (beta === undefined || current === undefined) return null;
    const move = beta * marketSigma;
    return {
      lo: Math.max(0, current * (1 - move)),
      hi: current * (1 + move),
      movePct: move * 100,
    };
  }, [beta, current, marketSigma]);

  const markers = useMemo<MarkerSpec[]>(() => {
    const out: MarkerSpec[] = [];
    const trailingPe = positiveNumber(target?.trailing_pe);
    const trailingEps = positiveNumber(target?.trailing_eps);
    const forwardEpsFallback = positiveNumber(target?.forward_eps);
    const consensus = positiveNumber(target?.consensus);

    if (current !== undefined) {
      out.push({
        key: 'current',
        label: t('pcbCurrent', language),
        value: current,
        toneClass: 'text-foreground',
        lineClass: 'bg-foreground',
      });
    }

    if (trailingPe !== undefined && trailingEps !== undefined) {
      out.push({
        key: 'trailingPer',
        label: t('pcbTrailingPer', language),
        value: trailingPe * trailingEps,
        toneClass: 'text-violet-500',
        lineClass: 'bg-violet-500',
        subtext: [formatMultiple(trailingPe), `EPS ${trailingEps.toFixed(2)}`].filter(Boolean).join(' · '),
      });
    }

    if (intrinsic !== undefined) {
      const upPct = current ? ((intrinsic - current) / current) * 100 : null;
      const isUpside = current === undefined || intrinsic >= current;
      out.push({
        key: 'dcf',
        label: t('pcbDcf', language),
        value: intrinsic,
        toneClass: isUpside ? 'text-emerald-600' : 'text-red-500',
        lineClass: isUpside ? 'bg-emerald-500' : 'bg-red-500',
        subtext: upPct !== null ? `${upPct >= 0 ? '+' : ''}${upPct.toFixed(1)}%` : undefined,
      });

      out.push({
        key: 'mos',
        label: t('pcbMosBuy', language).replace('{pct}', `${Math.round(mosBuffer * 100)}`),
        value: intrinsic * (1 - mosBuffer),
        toneClass: 'text-emerald-600',
        lineClass: 'bg-emerald-500',
      });
    }

    if (consensus !== undefined) {
      out.push({
        key: 'consensus',
        label: t('pcbConsensus', language),
        value: consensus,
        toneClass: 'text-amber-600',
        lineClass: 'bg-amber-500',
        subtext: target?.analyst_count ? `n=${target.analyst_count}` : undefined,
      });
    }

    const fy0Eps = positiveNumber(metrics.forwardEpsFy0?.value) ?? forwardEpsFallback;
    const fy0Year = metrics.fy0FiscalYear ?? null;
    if (fy0Eps !== undefined && effectivePerFy0 !== undefined) {
      out.push({
        key: 'fwdPerFy0',
        label: t('pcbFwdPerFy0', language),
        value: fy0Eps * effectivePerFy0,
        toneClass: 'text-sky-600',
        lineClass: 'bg-sky-500',
        subtext: [formatMultiple(effectivePerFy0), `EPS ${fy0Eps.toFixed(2)}`].filter(Boolean).join(' · '),
        fiscalYear: fy0Year,
      });
    }

    const fy1Eps = positiveNumber(metrics.forwardEpsFy1?.value);
    const fy1Year = metrics.fy1FiscalYear ?? null;
    const furthest = pickFurthestAnnual(fy0Year, fy1Year);
    if (
      furthest === 'fy1'
      && fy1Eps !== undefined
      && effectivePerFy1 !== undefined
      && (fy0Year === null || (fy1Year !== null && fy1Year > fy0Year))
    ) {
      out.push({
        key: 'fwdPerFy1',
        label: t('pcbFwdPerFyN', language),
        value: fy1Eps * effectivePerFy1,
        toneClass: 'text-cyan-600',
        lineClass: 'bg-cyan-500',
        subtext: [formatMultiple(effectivePerFy1), `EPS ${fy1Eps.toFixed(2)}`].filter(Boolean).join(' · '),
        fiscalYear: fy1Year,
      });
    }

    return out;
  }, [
    current,
    effectivePerFy0,
    effectivePerFy1,
    intrinsic,
    language,
    metrics.forwardEpsFy0?.value,
    metrics.forwardEpsFy1?.value,
    metrics.fy0FiscalYear,
    metrics.fy1FiscalYear,
    mosBuffer,
    target?.analyst_count,
    target?.consensus,
    target?.forward_eps,
    target?.trailing_eps,
    target?.trailing_pe,
  ]);

  const range = useMemo<CompassRange | null>(() => {
    const values = markers.map(marker => marker.value);
    if (betaBand) values.push(betaBand.lo, betaBand.hi);
    if (values.length === 0) return null;

    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = Math.max(hi - lo, Math.max(hi, 1) * 0.16);
    return {
      min: Math.max(0, lo - span * 0.18),
      max: hi + span * 0.18,
    };
  }, [betaBand, markers]);

  const positionedMarkers = useMemo<PositionedMarker[]>(() => {
    if (!range) return [];
    const labelVerticalClasses = ['top-0', 'top-14', 'bottom-14', 'bottom-0'];
    return [...markers]
      .sort((a, b) => a.value - b.value)
      .map((marker, index) => {
        const pct = pctForValue(marker.value, range);
        const laneCycle = labelVerticalClasses.length;
        const shouldLabelLeftOfLine = pct > 76
          || (pct >= 24 && pct <= 76 && (index + Math.floor(index / laneCycle)) % 2 === 0);
        const labelSideClass = shouldLabelLeftOfLine ? 'right-2 text-right items-end' : 'left-2 text-left items-start';
        const labelVerticalClass = labelVerticalClasses[index % labelVerticalClasses.length];
        return { ...marker, pct, labelSideClass, labelVerticalClass };
      });
  }, [markers, range]);

  if (markers.length < 1 || !range) return null;

  const pctFor = (value: number) => pctForValue(value, range);

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('pcbTitle', language)}
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/70">
            {ticker} · USD
          </span>
        </h3>
        {hasPerEdits && (
          <button
            type="button"
            onClick={resetPer}
            className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('pcbResetPer', language)}
          >
            ↺ {t('pcbResetPer', language)}
          </button>
        )}
      </div>

      <div className="relative my-4 h-32 sm:h-64">
        <div className="absolute inset-x-0 top-1/2 h-9 -translate-y-1/2 overflow-hidden rounded-full border border-border/70 bg-gradient-to-r from-red-500/15 via-muted/60 to-emerald-500/20 shadow-inner">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/70" />
          {betaBand && (
            <div
              className="absolute top-1/2 h-full -translate-y-1/2 border-x border-amber-400/60 bg-amber-400/20"
              style={{
                left: `${pctFor(betaBand.lo)}%`,
                width: `${Math.max(1.5, pctFor(betaBand.hi) - pctFor(betaBand.lo))}%`,
              }}
              title={`β=${beta?.toFixed(2)}, ±${betaBand.movePct.toFixed(0)}%`}
            />
          )}
        </div>

        {positionedMarkers.map(marker => (
          <div
            key={marker.key}
            className="absolute inset-y-0 -translate-x-1/2"
            style={{ left: `${marker.pct}%` }}
            title={`${marker.label}: ${formatCurrency(marker.value)}`}
          >
            <div className={`absolute left-0 top-1/2 h-20 w-px -translate-y-1/2 border-l border-white/30 ${marker.lineClass} shadow-[0_0_0_1px_rgba(255,255,255,0.35)]`} />
            <div className={`absolute ${marker.labelVerticalClass} ${marker.labelSideClass} hidden min-w-[7.5rem] max-w-[11rem] flex-col rounded-md bg-background/95 px-2 py-1 shadow-sm ring-1 ring-border/50 sm:flex`}>
              <span className={`truncate text-[10px] font-medium ${marker.toneClass}`}>
                {marker.label}
                {marker.fiscalYear !== undefined && marker.fiscalYear !== null ? ` · FY${marker.fiscalYear}` : ''}
              </span>
              <span className="font-mono text-[12px] font-semibold leading-tight text-foreground">
                {formatCurrency(marker.value)}
              </span>
              {marker.subtext && (
                <span className="truncate font-mono text-[9px] leading-tight text-muted-foreground">
                  {marker.subtext}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] sm:hidden">
        {positionedMarkers.map(marker => (
          <div key={`${marker.key}-mobile`} className="min-w-0 border-t border-border/30 pt-1">
            <div className={`truncate font-medium ${marker.toneClass}`}>
              {marker.label}
              {marker.fiscalYear !== undefined && marker.fiscalYear !== null ? ` · FY${marker.fiscalYear}` : ''}
            </div>
            <div className="font-mono font-semibold text-foreground">{formatCurrency(marker.value)}</div>
            {marker.subtext && (
              <div className="truncate font-mono text-[9px] text-muted-foreground">{marker.subtext}</div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono">
          {formatCurrency(range.min)} - {formatCurrency(range.max)}
        </span>
        {betaBand && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 font-mono text-amber-700">
            <span className="h-2 w-3 rounded-full bg-amber-400/40" />
            {t('pcbBetaBand', language).replace('{beta}', beta!.toFixed(2))}: {formatCurrency(betaBand.lo)} ~ {formatCurrency(betaBand.hi)}
          </span>
        )}
      </div>

      {(defaultPerFy0 !== undefined || defaultPerFy1 !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3 text-[10px] text-muted-foreground">
          {defaultPerFy0 !== undefined && (
            <label className="inline-flex items-center gap-1.5">
              <span>{t('pcbEditPer', language)} FY0</span>
              <input
                type="number"
                step="0.5"
                min="1"
                max="100"
                value={effectivePerFy0 ?? defaultPerFy0}
                onChange={event => {
                  const value = parseFloat(event.target.value);
                  setEditedPerFy0(Number.isFinite(value) ? value : undefined);
                }}
                className="w-14 rounded border border-border/50 bg-transparent px-1 py-0.5 text-right font-mono text-[10px] text-sky-600 focus:border-sky-500 focus:outline-none"
                title={t('pcbEditPer', language)}
                aria-label={`${t('pcbEditPer', language)} FY0`}
              />
            </label>
          )}
          {defaultPerFy1 !== undefined && metrics.forwardEpsFy1?.value !== undefined && (
            <label className="inline-flex items-center gap-1.5">
              <span>{t('pcbEditPer', language)} FY+N</span>
              <input
                type="number"
                step="0.5"
                min="1"
                max="100"
                value={effectivePerFy1 ?? defaultPerFy1}
                onChange={event => {
                  const value = parseFloat(event.target.value);
                  setEditedPerFy1(Number.isFinite(value) ? value : undefined);
                }}
                className="w-14 rounded border border-border/50 bg-transparent px-1 py-0.5 text-right font-mono text-[10px] text-cyan-600 focus:border-cyan-500 focus:outline-none"
                title={t('pcbEditPer', language)}
                aria-label={`${t('pcbEditPer', language)} FY+N`}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
