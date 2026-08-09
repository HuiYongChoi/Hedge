import type { PbrBand, ReportLanguage } from './types';

// 저장 시점의 "그때 시장 값"을 함께 보관한다.
// 이게 없으면 과거 저장 분석을 열 때 목표가·컨센 EPS·현재가가 전부 실시간 값으로
// 다시 채워져(liveTarget 재조회), 무엇이 언제 어떻게 변했는지 추적이 불가능하다.
export interface MarketSnapshot {
  capturedAt: string;
  currency: string | null;
  currentPrice: number | null;
  consensusTarget: number | null;
  analystCount: number | null;
  forwardEps: number | null;
  forwardPer: number | null;
  trailingEps: number | null;
  trailingPer: number | null;
  pbr: number | null;
  pbrPositionLabel: PbrBand['positionLabel'] | null;
  sigmaAnnual: number | null;
  signal: string | null;
  confidence: number | null;
  compositeScore: number | null;
}

export const MARKET_SNAPSHOT_KEY = 'market_snapshot';

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildMarketSnapshot(input: {
  capturedAt: string;
  currency?: string | null;
  currentPrice?: number | null;
  consensusTarget?: number | null;
  analystCount?: number | null;
  forwardEps?: number | null;
  forwardPer?: number | null;
  trailingEps?: number | null;
  trailingPer?: number | null;
  pbr?: number | null;
  pbrPositionLabel?: PbrBand['positionLabel'] | null;
  sigmaAnnual?: number | null;
  signal?: string | null;
  confidence?: number | null;
  compositeScore?: number | null;
}): MarketSnapshot {
  return {
    capturedAt: input.capturedAt,
    currency: input.currency ?? null,
    currentPrice: finiteOrNull(input.currentPrice),
    consensusTarget: finiteOrNull(input.consensusTarget),
    analystCount: finiteOrNull(input.analystCount),
    forwardEps: finiteOrNull(input.forwardEps),
    forwardPer: finiteOrNull(input.forwardPer),
    trailingEps: finiteOrNull(input.trailingEps),
    trailingPer: finiteOrNull(input.trailingPer),
    pbr: finiteOrNull(input.pbr),
    pbrPositionLabel: input.pbrPositionLabel ?? null,
    sigmaAnnual: finiteOrNull(input.sigmaAnnual),
    signal: input.signal ?? null,
    confidence: finiteOrNull(input.confidence),
    compositeScore: finiteOrNull(input.compositeScore),
  };
}

export function readMarketSnapshot(resultData: any): MarketSnapshot | null {
  const raw = resultData?.[MARKET_SNAPSHOT_KEY];
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.capturedAt !== 'string') return null;
  return raw as MarketSnapshot;
}

// ── diff ──────────────────────────────────────────────────────────────────────

export type DiffDirection = 'up' | 'down' | 'flat';

export interface SnapshotDiffRow {
  key: keyof MarketSnapshot;
  labelKo: string;
  labelEn: string;
  /** 값 표기 방식 — 통화 / 배수 / 퍼센트 / 정수 / 문자열 */
  format: 'currency' | 'multiple' | 'percent' | 'count' | 'text';
  before: number | string | null;
  after: number | string | null;
  changePct: number | null;
  direction: DiffDirection;
  /** 값이 오르는 게 좋은 지표인지(목표가↑ 긍정) — null이면 중립 표기 */
  higherIsBetter: boolean | null;
}

const ROW_DEFS: Array<{
  key: keyof MarketSnapshot;
  labelKo: string;
  labelEn: string;
  format: SnapshotDiffRow['format'];
  higherIsBetter: boolean | null;
}> = [
  { key: 'currentPrice', labelKo: '현재가', labelEn: 'Price', format: 'currency', higherIsBetter: null },
  { key: 'consensusTarget', labelKo: '증권사 평균 목표가', labelEn: 'Consensus target', format: 'currency', higherIsBetter: true },
  { key: 'forwardEps', labelKo: '선행 12M 컨센 EPS', labelEn: '12M fwd consensus EPS', format: 'currency', higherIsBetter: true },
  { key: 'forwardPer', labelKo: '현재가 기준 12M 선행 PER', labelEn: '12M fwd P/E (current price)', format: 'multiple', higherIsBetter: null },
  { key: 'trailingPer', labelKo: 'TTM PER', labelEn: 'TTM P/E', format: 'multiple', higherIsBetter: null },
  { key: 'pbr', labelKo: 'PBR', labelEn: 'PBR', format: 'multiple', higherIsBetter: null },
  { key: 'sigmaAnnual', labelKo: '연 변동성', labelEn: 'Annualised vol', format: 'percent', higherIsBetter: false },
  { key: 'analystCount', labelKo: '커버 애널리스트', labelEn: 'Analyst count', format: 'count', higherIsBetter: null },
  { key: 'compositeScore', labelKo: '종합 점수', labelEn: 'Composite score', format: 'count', higherIsBetter: true },
];

function directionOf(before: number | null, after: number | null): DiffDirection {
  if (before === null || after === null) return 'flat';
  if (after > before) return 'up';
  if (after < before) return 'down';
  return 'flat';
}

export function diffMarketSnapshots(
  before: MarketSnapshot,
  after: MarketSnapshot,
): SnapshotDiffRow[] {
  const rows: SnapshotDiffRow[] = [];

  for (const def of ROW_DEFS) {
    const b = before[def.key];
    const a = after[def.key];
    const bNum = typeof b === 'number' ? b : null;
    const aNum = typeof a === 'number' ? a : null;
    // 양쪽 다 없으면 행 자체를 만들지 않는다(빈 줄로 표를 늘리지 않음)
    if (bNum === null && aNum === null) continue;
    const changePct = bNum !== null && aNum !== null && bNum !== 0
      ? (aNum - bNum) / Math.abs(bNum)
      : null;
    rows.push({
      key: def.key,
      labelKo: def.labelKo,
      labelEn: def.labelEn,
      format: def.format,
      before: bNum,
      after: aNum,
      changePct,
      direction: directionOf(bNum, aNum),
      higherIsBetter: def.higherIsBetter,
    });
  }

  // 신호는 문자열이라 별도 처리 — 바뀐 경우에만 노출
  if (before.signal || after.signal) {
    const changed = (before.signal ?? null) !== (after.signal ?? null);
    if (changed) {
      rows.unshift({
        key: 'signal',
        labelKo: '신호',
        labelEn: 'Signal',
        format: 'text',
        before: before.signal ?? null,
        after: after.signal ?? null,
        changePct: null,
        direction: 'flat',
        higherIsBetter: null,
      });
    }
  }

  return rows;
}

/**
 * 하락장에서 가장 중요한 한 줄: 주가 하락이 "이익 추정 하락(펀더멘털)" 때문인지
 * "배수 축소(심리)" 때문인지 분해한다.
 *   가격변화 ≈ EPS변화 + PER변화 (로그 근사, 곱셈 관계)
 * EPS가 안 빠졌는데 가격만 빠졌으면 멀티플(심리) 요인이 크다는 뜻.
 */
export interface PriceMoveAttribution {
  priceChangePct: number;
  epsChangePct: number;
  multipleChangePct: number;
  driver: 'earnings' | 'multiple' | 'mixed';
}

export function attributePriceMove(
  before: MarketSnapshot,
  after: MarketSnapshot,
): PriceMoveAttribution | null {
  const p0 = before.currentPrice;
  const p1 = after.currentPrice;
  const e0 = before.forwardEps;
  const e1 = after.forwardEps;
  if (p0 === null || p1 === null || e0 === null || e1 === null) return null;
  if (p0 <= 0 || p1 <= 0 || e0 <= 0 || e1 <= 0) return null;

  const priceChangePct = p1 / p0 - 1;
  const epsChangePct = e1 / e0 - 1;
  // PER = P / E 이므로 배수 변화는 가격변화를 EPS변화로 나눈 값
  const multipleChangePct = (1 + priceChangePct) / (1 + epsChangePct) - 1;

  const absEps = Math.abs(epsChangePct);
  const absMultiple = Math.abs(multipleChangePct);
  const driver: PriceMoveAttribution['driver'] = absEps === 0 && absMultiple === 0
    ? 'mixed'
    : absEps > absMultiple * 2
      ? 'earnings'
      : absMultiple > absEps * 2
        ? 'multiple'
        : 'mixed';

  return { priceChangePct, epsChangePct, multipleChangePct, driver };
}

export function attributionSummary(
  attribution: PriceMoveAttribution,
  language: ReportLanguage,
): string {
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  if (language === 'ko') {
    const driverText = attribution.driver === 'earnings'
      ? '이익 추정 변화가 주도'
      : attribution.driver === 'multiple'
        ? '배수(심리) 변화가 주도'
        : '이익·배수 요인이 혼재';
    return `주가 ${pct(attribution.priceChangePct)} = 선행 EPS ${pct(attribution.epsChangePct)} × 배수 ${pct(attribution.multipleChangePct)} · ${driverText}`;
  }
  const driverText = attribution.driver === 'earnings'
    ? 'earnings-driven'
    : attribution.driver === 'multiple'
      ? 'multiple-driven'
      : 'mixed drivers';
  return `Price ${pct(attribution.priceChangePct)} = Fwd EPS ${pct(attribution.epsChangePct)} × multiple ${pct(attribution.multipleChangePct)} · ${driverText}`;
}
