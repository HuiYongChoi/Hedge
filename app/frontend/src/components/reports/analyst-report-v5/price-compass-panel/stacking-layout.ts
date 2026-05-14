import type { BrokerTarget } from '@/services/analyst-target-service';

export interface PositionedCallout {
  broker: BrokerTarget;
  leftPct: number;   // 0..100
  rowIndex: number;  // 0..N
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Greedy bin-pack: sort callouts by leftPct (ascending); place each in the
 * lowest row where the previous callout in that row ends at least `minGapPct`
 * before this one's centre. Guarantees no overlap.
 */
export function stackCallouts(
  brokers: BrokerTarget[],
  range: { min: number; max: number },
  containerPx: number,
  calloutPx: number = 96,
  gapPx: number = 8,
): PositionedCallout[] {
  if (brokers.length === 0 || containerPx <= 0) return [];
  const span = range.max - range.min;
  if (!Number.isFinite(span) || span <= 0) return [];

  const minPctGap = ((calloutPx + gapPx) / containerPx) * 100;
  const sorted = [...brokers].sort((a, b) => a.target_price - b.target_price);
  const rowLastPct: number[] = [];   // last placed leftPct per row
  const result: PositionedCallout[] = [];

  for (const broker of sorted) {
    const leftPct = clamp(((broker.target_price - range.min) / span) * 100, 0, 100);
    let placedRow = -1;
    for (let r = 0; r < rowLastPct.length; r++) {
      if (leftPct - rowLastPct[r] >= minPctGap) {
        placedRow = r;
        break;
      }
    }
    if (placedRow === -1) {
      placedRow = rowLastPct.length;
      rowLastPct.push(leftPct);
    } else {
      rowLastPct[placedRow] = leftPct;
    }
    result.push({ broker, leftPct, rowIndex: placedRow });
  }
  return result;
}
