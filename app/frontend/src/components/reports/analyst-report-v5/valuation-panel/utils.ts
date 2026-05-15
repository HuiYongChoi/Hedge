export function formatPriceExact(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const norm = currency.toUpperCase();
  if (norm === 'KRW') {
    return '₩' + value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }
  if (norm === 'JPY') {
    return '¥' + value.toLocaleString('ja-JP', { maximumFractionDigits: 0 });
  }
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function formatMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}x`;
}

export function gapColor(gap: number | null): string {
  if (gap === null || !Number.isFinite(gap)) return 'text-muted-foreground';
  if (gap > 0.15) return 'text-emerald-300';
  if (gap < -0.15) return 'text-red-400';
  return 'text-amber-300';
}

export function gapPillClass(gap: number | null): string {
  if (gap === null || !Number.isFinite(gap))
    return 'bg-muted/30 text-muted-foreground border-border/40';
  if (gap > 0.15)
    return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  if (gap < -0.15)
    return 'bg-red-500/20 text-red-400 border-red-500/40';
  return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
}

export function positionLabelColor(posLabel: string): string {
  if (posLabel === 'below_p25') return 'text-emerald-300';
  if (posLabel === 'above_p75') return 'text-red-400';
  return 'text-amber-300';
}
