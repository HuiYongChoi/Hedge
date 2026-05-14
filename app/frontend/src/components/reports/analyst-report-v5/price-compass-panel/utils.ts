import type { ReportLanguage } from '../types';

export type SignalTone = {
  text: string;
  bg: string;
  border: string;
  dot: string;
  label: string;
};

/** Map signal string → Tailwind class objects */
export function signalTone(signal: 'BUY' | 'HOLD' | 'NEUTRAL' | 'SELL'): SignalTone {
  switch (signal) {
    case 'BUY':
      return {
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/15',
        border: 'border-emerald-500/50',
        dot: 'bg-emerald-400',
        label: signal,
      };
    case 'HOLD':
      return {
        text: 'text-amber-400',
        bg: 'bg-amber-500/15',
        border: 'border-amber-500/50',
        dot: 'bg-amber-400',
        label: signal,
      };
    case 'NEUTRAL':
      return {
        text: 'text-sky-400',
        bg: 'bg-sky-500/15',
        border: 'border-sky-500/50',
        dot: 'bg-sky-400',
        label: signal,
      };
    case 'SELL':
      return {
        text: 'text-rose-400',
        bg: 'bg-rose-500/15',
        border: 'border-rose-500/50',
        dot: 'bg-rose-400',
        label: signal,
      };
  }
}

/** Format P/E multiple: 39.1 → "39.1×" */
export function formatMultiple(pe: number | null | undefined): string {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return '—';
  return `${pe.toFixed(1)}×`;
}

/** Format percent with optional sign: 12.0 → "+12.0%", -9.4 → "-9.4%" */
export function formatPct(p: number | null | undefined, signed = true): string {
  if (p == null || !Number.isFinite(p)) return '—';
  const prefix = signed && p > 0 ? '+' : '';
  return `${prefix}${p.toFixed(1)}%`;
}

/** Upside percent colour class (market convention: positive = green) */
export function upsideClass(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground';
  if (Math.abs(pct) <= 0.5) return 'text-muted-foreground';
  return pct > 0 ? 'text-emerald-400' : 'text-rose-400';
}

/** Days-ago label */
export function formatDaysAgo(d: number, language: ReportLanguage): string {
  if (language === 'ko') return `${d}일 전`;
  return `${d}d ago`;
}

/** Compute upside% from target and current price */
export function upsidePct(targetPrice: number, currentPrice: number | null): number | null {
  if (!currentPrice || currentPrice <= 0) return null;
  return ((targetPrice - currentPrice) / currentPrice) * 100;
}

/** Compute implied forward P/E from target price and forward EPS */
export function impliedFwdPe(targetPrice: number, forwardEps: number | null | undefined): number | null {
  if (!forwardEps || forwardEps <= 0) return null;
  return targetPrice / forwardEps;
}

/** Clamp a value between lo and hi */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
