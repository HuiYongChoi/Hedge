import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/language-preferences';
import type { CanonicalMetrics, ReportLanguage } from './types';
import { analystTargetService, type AnalystTarget } from '@/services/analyst-target-service';

interface PriceCompassBarProps {
  ticker: string;
  metrics: CanonicalMetrics;
  language: ReportLanguage;
  mosBuffer?: number;     // 안전마진 buffer 비율 (기본 0.25)
  marketSigma?: number;   // 시장 σ (기본 0.20 → 1년 ±20%)
}

interface MarkerSpec {
  key: 'current' | 'dcf' | 'mos' | 'consensus' | 'fwdPerFy0' | 'fwdPerFy1';
  label: string;
  value: number;
  glyph: string;           // ●/▲/★/◆/■/▣
  toneClass: string;       // text tailwind
  subtext?: string;
  fiscalYear?: number | null;
}

// FY+N 선택: 회계년도가 더 큰 쪽. 같거나 한쪽 없으면 fallback.
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

export function PriceCompassBar({
  ticker,
  metrics,
  language,
  mosBuffer = 0.25,
  marketSigma = 0.20,
}: PriceCompassBarProps) {
  // 1) Fetch consensus target on mount
  const [target, setTarget] = useState<AnalystTarget | null>(null);
  useEffect(() => {
    let cancelled = false;
    analystTargetService.fetch(ticker).then(r => {
      if (!cancelled) setTarget(r);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  // 2) Editable PER state — FY0 와 FY+N 독립
  const defaultPerFy0 = metrics.forwardPeFy0?.value ?? metrics.forwardPe?.value;
  const defaultPerFy1 = metrics.forwardPeFy1?.value
    ?? (defaultPerFy0 !== undefined ? defaultPerFy0 * 0.9 : undefined);
  const [editedPerFy0, setEditedPerFy0] = useState<number | undefined>(undefined);
  const [editedPerFy1, setEditedPerFy1] = useState<number | undefined>(undefined);
  const effectivePerFy0 = editedPerFy0 ?? defaultPerFy0;
  const effectivePerFy1 = editedPerFy1 ?? defaultPerFy1;
  const resetPer = () => { setEditedPerFy0(undefined); setEditedPerFy1(undefined); };

  // 3) Build markers (only include non-null)
  const markers = useMemo<MarkerSpec[]>(() => {
    const out: MarkerSpec[] = [];
    // metrics.currentPrice가 없으면 FMP quote 현재가로 fallback
    const current = metrics.currentPrice?.value ?? (target?.current_price ?? undefined);
    const intrinsic = metrics.intrinsicValue?.value;

    if (current !== undefined) {
      out.push({
        key: 'current',
        label: t('pcbCurrent', language),
        value: current,
        glyph: '●',
        toneClass: 'text-white',
      });
    }
    if (intrinsic !== undefined) {
      const upPct = current ? ((intrinsic - current) / current) * 100 : null;
      out.push({
        key: 'dcf',
        label: t('pcbDcf', language),
        value: intrinsic,
        glyph: '▲',
        toneClass: intrinsic > (current ?? 0) ? 'text-emerald-400' : 'text-red-400',
        subtext: upPct !== null ? `${upPct >= 0 ? '+' : ''}${upPct.toFixed(1)}%` : undefined,
      });
      const mosPrice = intrinsic * (1 - mosBuffer);
      out.push({
        key: 'mos',
        label: t('pcbMosBuy', language).replace('{pct}', `${Math.round(mosBuffer * 100)}`),
        value: mosPrice,
        glyph: '★',
        toneClass: 'text-emerald-300',
      });
    }
    if (target?.consensus) {
      out.push({
        key: 'consensus',
        label: t('pcbConsensus', language),
        value: target.consensus,
        glyph: '◆',
        toneClass: 'text-amber-400',
        subtext: target.analyst_count ? `n=${target.analyst_count}` : undefined,
      });
    }
    // FY0 implied price
    const fy0Eps = metrics.forwardEpsFy0?.value;
    const fy0Year = metrics.fy0FiscalYear ?? null;
    if (fy0Eps !== undefined && effectivePerFy0 !== undefined) {
      out.push({
        key: 'fwdPerFy0',
        label: t('pcbFwdPerFy0', language),
        value: fy0Eps * effectivePerFy0,
        glyph: '■',
        toneClass: 'text-sky-400',
        fiscalYear: fy0Year,
      });
    }
    // FY+N (furthest available) implied price — 회계년도가 FY0 보다 클 때만 추가
    const fy1Eps = metrics.forwardEpsFy1?.value;
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
        glyph: '▣',
        toneClass: 'text-sky-300',
        fiscalYear: fy1Year,
      });
    }
    return out;
  }, [metrics, target, effectivePerFy0, effectivePerFy1, mosBuffer, language]);

  // 4) Compute bar range (lo, hi)
  const range = useMemo(() => {
    if (markers.length === 0) return null;
    const vals = markers.map(m => m.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || hi * 0.2;
    return { min: Math.max(0, lo - span * 0.15), max: hi + span * 0.15 };
  }, [markers]);

  // 5) Beta band
  const beta = metrics.beta?.value;
  const current = metrics.currentPrice?.value ?? (target?.current_price ?? undefined);
  const betaBand = beta && current
    ? { lo: current * (1 - beta * marketSigma), hi: current * (1 + beta * marketSigma) }
    : null;

  // 6) Hide if <1 marker
  if (markers.length < 1 || !range) return null;

  // 7) Position helper
  const pctFor = (v: number) => ((v - range.min) / (range.max - range.min)) * 100;

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('pcbTitle', language)}
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/70">
            {ticker} · USD
          </span>
        </h3>
        {(editedPerFy0 !== undefined || editedPerFy1 !== undefined) && (
          <button
            type="button"
            onClick={resetPer}
            className="text-[10px] text-muted-foreground hover:text-foreground"
            aria-label={t('pcbResetPer', language)}
          >
            ↺ {t('pcbResetPer', language)}
          </button>
        )}
      </div>

      {/* Bar */}
      <div className="relative my-3 h-16">
        {/* Range track */}
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border/60" />
        {/* Range labels */}
        <span className="absolute left-0 top-full mt-0.5 font-mono text-[9px] text-muted-foreground">
          ${range.min.toFixed(0)}
        </span>
        <span className="absolute right-0 top-full mt-0.5 font-mono text-[9px] text-muted-foreground">
          ${range.max.toFixed(0)}
        </span>
        {/* Beta band */}
        {betaBand && (
          <div
            className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-yellow-500/30 bg-yellow-500/15"
            style={{
              left: `${pctFor(betaBand.lo)}%`,
              width: `${pctFor(betaBand.hi) - pctFor(betaBand.lo)}%`,
            }}
            title={`β=${beta?.toFixed(2)}, ±${(beta! * marketSigma * 100).toFixed(0)}%`}
          />
        )}
        {/* Markers */}
        {markers.map(m => (
          <div
            key={m.key}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg ${m.toneClass}`}
            style={{ left: `${pctFor(m.value)}%` }}
            title={`${m.label}: $${m.value.toFixed(2)}`}
          >
            {m.glyph}
          </div>
        ))}
      </div>

      {/* Marker list */}
      <ul className="mt-4 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
        {markers.map(m => (
          <li key={m.key} className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className={m.toneClass}>{m.glyph}</span>
              <span className="text-muted-foreground">{m.label}</span>
              {m.fiscalYear !== undefined && m.fiscalYear !== null && (
                <span className="rounded-sm border border-border/40 px-1 font-mono text-[9px] text-muted-foreground">
                  FY{m.fiscalYear}
                </span>
              )}
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono font-semibold text-foreground">${m.value.toFixed(2)}</span>
              {m.subtext && (
                <span className="font-mono text-[9px] text-muted-foreground">{m.subtext}</span>
              )}
              {m.key === 'fwdPerFy0' && defaultPerFy0 !== undefined && (
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="100"
                  value={effectivePerFy0 ?? defaultPerFy0}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setEditedPerFy0(Number.isFinite(v) ? v : undefined);
                  }}
                  className="ml-1 w-12 rounded border border-border/40 bg-transparent px-1 py-0 text-right font-mono text-[9px] text-sky-400 focus:border-sky-500 focus:outline-none"
                  title={t('pcbEditPer', language)}
                  aria-label={`${t('pcbEditPer', language)} FY0`}
                />
              )}
              {m.key === 'fwdPerFy1' && defaultPerFy1 !== undefined && (
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="100"
                  value={effectivePerFy1 ?? defaultPerFy1}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setEditedPerFy1(Number.isFinite(v) ? v : undefined);
                  }}
                  className="ml-1 w-12 rounded border border-border/40 bg-transparent px-1 py-0 text-right font-mono text-[9px] text-sky-300 focus:border-sky-500 focus:outline-none"
                  title={t('pcbEditPer', language)}
                  aria-label={`${t('pcbEditPer', language)} FY+N`}
                />
              )}
            </span>
          </li>
        ))}
        {betaBand && (
          <li className="flex items-baseline justify-between gap-2 border-t border-border/40 pt-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm bg-yellow-500/30" />
              <span className="text-muted-foreground">
                {t('pcbBetaBand', language).replace('{beta}', beta!.toFixed(2))}
              </span>
            </span>
            <span className="font-mono text-foreground">
              ${betaBand.lo.toFixed(0)} ~ ${betaBand.hi.toFixed(0)}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
