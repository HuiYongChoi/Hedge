import { Button } from '@/components/ui/button';
import { t } from '@/lib/language-preferences';
import { krwEquivalentText, useKrwRate } from '@/hooks/use-krw-equivalent';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { computePbrTrend, toneToClasses } from './helpers';
import type { CashFlowInsight, OtherAgent, PbrBand, ReportLanguage, ReportTone, TargetTile, ValuationDeepDive } from './types';

interface TargetDataSidebarProps {
  tiles: TargetTile[];
  otherAgents: OtherAgent[];
  language: ReportLanguage;
  onSwitchAgent: (agentKey: string) => void;
  className?: string;
  report?: Record<string, any> | null;
  valuationDeepDive?: ValuationDeepDive | null;
  currency?: string;
  brokerConsensus?: BrokerConsensusSnapshot | null;
  currentPrice?: number | null;
}

interface BrokerConsensusSnapshot {
  consensus: number | null;
  brokerCount: number;
  forwardEps: number | null;
  forwardPer?: number | null;
}

function shortTone(tone: OtherAgent['tone']) {
  if (tone === 'bullish') return 'BUL';
  if (tone === 'bearish') return 'BEA';
  return 'NEU';
}

function formatCurrency(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (currency.toUpperCase() === 'KRW') return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  if (currency.toUpperCase() === 'JPY') return `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// 달러/엔 헤드라인 금액 옆에 원화 환산을 병기한다 — 한국 투자자 체감용.
// 환율 조회 실패나 원화 종목이면 아무것도 렌더하지 않는다(조용히 생략).
function KrwEquivalent({ value, currency }: { value: number | null | undefined; currency: string }) {
  const rate = useKrwRate(currency);
  const text = krwEquivalentText(value, rate);
  if (!text) return null;
  return <span className="ml-1.5 align-middle text-[11px] font-normal text-muted-foreground">({text})</span>;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatPercentPlain(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatPbrMultiple(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

function fillTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (next, [key, value]) => next.replace(`{${key}}`, value),
    template,
  );
}

// 선행 내재가치는 후행 내재가치 '바로 아래'에 온다. 두 값의 폭이 이 화면에서
// 가장 중요한 정보이므로 떨어뜨려 놓으면 비교가 되지 않는다.
// 내재가치 3종을 먼저 나란히, 그 아래 같은 순서로 안전가 3종.
// 짝을 맞춰 두지 않으면 '어느 기준의 안전가인지'가 화면에서 헷갈린다.
const ORDERED_PRIMARY_TILE_KEYS = [
  'targetIntrinsicLabel', 'targetForwardIntrinsicLabel',
  // 컨센서스 분기가 없으면 같은 자리에 '후행 TTM' 이름으로 뜬다.
  'targetForwardQuarterIntrinsicLabel', 'targetTrailingTtmIntrinsicLabel',
  // 내재가치 바로 다음에 둔다 — '우리가 보는 이익' 옆에 '시장이 보는 이익'.
  'targetMarketImpliedEpsLabel',
  'targetMarginLabel', 'targetForwardMarginLabel',
  'targetForwardQuarterMarginLabel', 'targetTrailingTtmMarginLabel',
] as const;
const PRIMARY_TILE_KEYS = new Set<string>(ORDERED_PRIMARY_TILE_KEYS);
const SAFETY_MARGIN_DISPLAY_BUFFER = 0.25;

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, value));
}

function ratioToBandPct(value: number, p10: number, p90: number) {
  const range = p90 - p10;
  if (!Number.isFinite(range) || range <= 0) return 50;
  return clampPercent(((value - p10) / range) * 100);
}

function derivePbrBps(pbr: PbrBand, marketCurrentPrice?: number | null) {
  const displayCurrentPrice = (
    marketCurrentPrice !== null
    && marketCurrentPrice !== undefined
    && Number.isFinite(marketCurrentPrice)
    && marketCurrentPrice > 0
  )
    ? marketCurrentPrice
    : pbr.currentPrice;
  if (
    displayCurrentPrice !== null
    && Number.isFinite(displayCurrentPrice)
    && displayCurrentPrice > 0
    && Number.isFinite(pbr.currentPbr)
    && pbr.currentPbr > 0
  ) {
    return displayCurrentPrice / pbr.currentPbr;
  }
  return pbr.bvps && Number.isFinite(pbr.bvps) && pbr.bvps > 0 ? pbr.bvps : null;
}

function derivePbrFairPrice(
  pbr: PbrBand,
  percentile: number,
  fallback: number | null | undefined,
  marketCurrentPrice?: number | null,
) {
  const bps = derivePbrBps(pbr, marketCurrentPrice);
  if (bps !== null && Number.isFinite(percentile) && percentile > 0) return bps * percentile;
  return fallback ?? null;
}

function pbrPositionText(position: PbrBand['positionLabel'], language: ReportLanguage) {
  const labels = {
    below_p25: language === 'ko' ? '밴드 하단 (10–25%)' : 'Band lower (10–25%)',
    p25_p50: language === 'ko' ? '밴드 중하 (25–50%)' : 'Band mid-low (25–50%)',
    p50_p75: language === 'ko' ? '밴드 중상 (50–75%)' : 'Band mid-high (50–75%)',
    above_p75: language === 'ko' ? '밴드 상단 (75–90%)' : 'Band upper (75–90%)',
  };
  return labels[position];
}

function pbrSignalText(signalTone: ReportTone, language: ReportLanguage) {
  if (signalTone === 'bullish') return language === 'ko' ? '매수·강세' : 'Buy · bullish';
  if (signalTone === 'bearish') return language === 'ko' ? '매도·약세' : 'Sell · bearish';
  return language === 'ko' ? '중립' : 'Neutral';
}

function InfoDot({ title }: { title: string }) {
  return (
    <span
      role="tooltip"
      title={title}
      className="inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-border/60 text-[8px] text-muted-foreground"
      aria-label={title}
    >
      ?
    </span>
  );
}

function Row({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-1 text-muted-foreground">
        <span>{label}</span>
        {tip && <InfoDot title={tip} />}
      </dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function PbrMiniRail({
  percentiles,
  currentPbr,
  positionPct,
  scenarioPbr,
  scenarioPct,
  tone,
}: {
  percentiles: PbrBand['percentiles'];
  currentPbr: number;
  positionPct: number;
  scenarioPbr: number | null;
  scenarioPct: number | null;
  tone: ReportTone;
}) {
  const classes = toneToClasses(tone);
  const p25Pct = ratioToBandPct(percentiles.p25, percentiles.p10, percentiles.p90);
  const p50Pct = ratioToBandPct(percentiles.p50, percentiles.p10, percentiles.p90);
  const p75Pct = ratioToBandPct(percentiles.p75, percentiles.p10, percentiles.p90);
  const left = Math.min(p25Pct, p75Pct);
  const width = Math.abs(p75Pct - p25Pct);

  return (
    <div className="relative mt-1 h-2 w-full rounded-full bg-muted">
      <div
        className="absolute h-2 rounded-full bg-muted-foreground/30"
        style={{ left: `${left}%`, width: `${width}%` }}
      />
      <div className="absolute -top-0.5 h-3 w-px bg-muted-foreground/70" style={{ left: `${p50Pct}%` }} />
      <div
        className={`absolute -top-1.5 h-5 w-[2px] -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.85)] ${classes.text}`}
        style={{ left: `${positionPct}%` }}
        title={`현재 PBR ${formatPbrMultiple(currentPbr)}`}
      />
      {scenarioPbr !== null && scenarioPct !== null && (
        <div
          className="absolute -top-2 h-6 w-[3px] -translate-x-1/2 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_0_10px_rgba(245,158,11,0.55)]"
          style={{ left: `${clampPercent(scenarioPct)}%` }}
          title={`입력 PBR ${formatPbrMultiple(scenarioPbr)}`}
        />
      )}
    </div>
  );
}

function PbrBandCard({
  pbr,
  pbrFairP50,
  signalTone,
  currency,
  language,
  marketCurrentPrice,
}: {
  pbr: PbrBand;
  pbrFairP50: number | null;
  signalTone: ReportTone;
  currency: string;
  language: ReportLanguage;
  marketCurrentPrice?: number | null;
}) {
  const classes = toneToClasses(signalTone);
  const displayCurrentPrice = (
    marketCurrentPrice !== null
    && marketCurrentPrice !== undefined
    && Number.isFinite(marketCurrentPrice)
    && marketCurrentPrice > 0
  )
    ? marketCurrentPrice
    : pbr.currentPrice;
  const [assumptionPbrInput, setAssumptionPbrInput] = useState(() => formatPbrMultiple(pbr.currentPbr));
  useEffect(() => {
    setAssumptionPbrInput(formatPbrMultiple(pbr.currentPbr));
  }, [pbr.currentPbr]);
  const trend = computePbrTrend(pbr.history, language);
  const railPct = ratioToBandPct(pbr.currentPbr, pbr.percentiles.p10, pbr.percentiles.p90);
  const assumptionPbr = useMemo(() => {
    const parsed = Number(assumptionPbrInput.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [assumptionPbrInput]);
  const scenarioPct = assumptionPbr === null
    ? null
    : ratioToBandPct(assumptionPbr, pbr.percentiles.p10, pbr.percentiles.p90);
  const showScenarioMarker = assumptionPbr !== null && Math.abs(assumptionPbr - pbr.currentPbr) > 0.005;
  const fairP10 = derivePbrFairPrice(pbr, pbr.percentiles.p10, pbr.fairPriceP10, displayCurrentPrice);
  const fairP50 = derivePbrFairPrice(pbr, pbr.percentiles.p50, pbrFairP50, displayCurrentPrice);
  const pbrFairP90 = derivePbrFairPrice(pbr, pbr.percentiles.p90, pbr.fairPriceP90, displayCurrentPrice);
  const bpsBasis = derivePbrBps(pbr, displayCurrentPrice);
  const assumptionPrice = assumptionPbr === null
    ? null
    : derivePbrFairPrice(pbr, assumptionPbr, null, displayCurrentPrice);
  const assumptionGap = displayCurrentPrice && assumptionPrice !== null
    ? (assumptionPrice - displayCurrentPrice) / displayCurrentPrice
    : null;
  const assumptionPriceText = assumptionPrice !== null
    ? formatCurrency(assumptionPrice, currency)
    : (language === 'ko' ? '입력 필요' : 'Enter PBR');
  const assumptionGapText = assumptionGap !== null
    ? (language === 'ko'
        ? `현재가 대비 ${formatPercent(assumptionGap)}`
        : `${formatPercent(assumptionGap)} vs current`)
    : (language === 'ko' ? 'PBR을 입력하면 계산됩니다' : 'Enter a PBR to calculate');
  const vsMedian = pbr.percentiles.p50 ? (pbr.currentPbr - pbr.percentiles.p50) / pbr.percentiles.p50 : null;
  const vsP90 = pbr.percentiles.p90 ? (pbr.currentPbr - pbr.percentiles.p90) / pbr.percentiles.p90 : null;
  const position = pbrPositionText(pbr.positionLabel, language);
  const signal = pbrSignalText(signalTone, language);
  const medianText = vsMedian === null
    ? ''
    : (language === 'ko'
        ? `중앙값 대비 ${formatPercent(vsMedian)}`
        : `${formatPercent(vsMedian)} vs median`);
  const highText = vsP90 === null
    ? ''
    : (language === 'ko'
        ? `상단까지 ${formatPercent(-vsP90)}`
        : `${formatPercent(-vsP90)} to upper band`);

  return (
    <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('pbrCardTitle', language)}
            <InfoDot title={t('pbrCardTitleTip', language)} />
          </div>
          {displayCurrentPrice !== null && (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              현재가 {formatCurrency(displayCurrentPrice, currency)}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`font-mono text-[11px] font-semibold ${classes.text}`}>{formatPercent(vsMedian)}</div>
          <div className="text-[9px] text-muted-foreground">
            {language === 'ko' ? '중위 PBR 대비' : 'vs median PBR'}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">
            {language === 'ko' ? '현재 PBR' : 'Current PBR'}
          </div>
          <div className="font-mono text-sm font-semibold text-foreground">{formatPbrMultiple(pbr.currentPbr)}</div>
        </div>
        <label className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">{language === 'ko' ? '입력 PBR' : 'Input PBR'}</div>
          <div className="mt-1">
            <input
              value={assumptionPbrInput}
              onChange={event => setAssumptionPbrInput(event.target.value)}
              onBlur={() => {
                if (assumptionPbr !== null) setAssumptionPbrInput(formatPbrMultiple(assumptionPbr));
              }}
              inputMode="decimal"
              placeholder={formatPbrMultiple(pbr.currentPbr)}
              aria-label={language === 'ko' ? 'PBR 배수 입력' : 'PBR multiple input'}
              className="h-7 w-full rounded-md border border-border/70 bg-background px-2 text-right font-mono text-sm font-semibold text-foreground outline-none focus:border-amber-400"
            />
          </div>
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{language === 'ko' ? '현재 위치' : 'Position'} · <span className={classes.text}>{position}</span></span>
        <InfoDot title={t('pbrRailTip', language)} />
      </div>
      <PbrMiniRail
        percentiles={pbr.percentiles}
        currentPbr={pbr.currentPbr}
        positionPct={railPct}
        scenarioPbr={showScenarioMarker ? assumptionPbr : null}
        scenarioPct={showScenarioMarker ? scenarioPct : null}
        tone={signalTone}
      />
      <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px]">
        <div className="text-muted-foreground">{language === 'ko' ? '입력 PBR 기준 주가' : 'Input PBR price'}</div>
        <div className="font-mono text-sm font-semibold text-amber-300">{assumptionPriceText}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{assumptionGapText}</div>
      </div>
      {/* 중위값은 이 카드의 기준점이다 — 나머지 눈금과 같은 크기로 두면
          '무엇과 비교하는 중인지'가 눈에 안 들어온다. */}
      <div className="mt-1 flex items-baseline justify-between font-mono text-[10px] text-muted-foreground">
        <span>10% {formatPbrMultiple(pbr.percentiles.p10)}</span>
        <span className="text-xs font-semibold text-foreground">
          {language === 'ko' ? '중위' : 'median'} {formatPbrMultiple(pbr.percentiles.p50)}
        </span>
        <span>90% {formatPbrMultiple(pbr.percentiles.p90)}</span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {language === 'ko' ? '계산 기준 BPS' : 'BPS basis'} {formatCurrency(bpsBasis, currency)}
      </div>

      <dl className="mt-3 space-y-1 border-t border-border/50 pt-2 text-[10px]">
        {/* 가격만 있으면 '이게 몇 배짜리 가격인지'를 위 눈금과 눈으로 맞춰야 한다.
            줄마다 배수를 같이 적어 그 자리에서 검산되게 한다. */}
        <Row label={language === 'ko' ? '하단 방어가 (10%)' : 'Lower band (10%)'}
             tip={t('pbrLowerBandTip', language)}>
          <span className="font-mono">
            {formatCurrency(fairP10, currency)}
            <span className="ml-1 text-[9px] text-muted-foreground">PBR {formatPbrMultiple(pbr.percentiles.p10)}</span>
          </span>
        </Row>
        <Row label={language === 'ko' ? '중위값 기준 주가 (50%)' : 'Median price (50%)'}
             tip={t('pbrMedianPriceTip', language)}>
          <span className="font-mono text-xs font-semibold text-foreground">
            {formatCurrency(fairP50, currency)}
            <span className="ml-1 text-[9px] font-normal text-muted-foreground">PBR {formatPbrMultiple(pbr.percentiles.p50)}</span>
          </span>
        </Row>
        <Row label={language === 'ko' ? '상단 시나리오 (90%)' : 'Upper case (90%)'}
             tip={t('pbrUpperBandTip', language)}>
          <span className="font-mono">
            {formatCurrency(pbrFairP90, currency)}
            <span className="ml-1 text-[9px] text-muted-foreground">PBR {formatPbrMultiple(pbr.percentiles.p90)}</span>
          </span>
        </Row>
        <Row label={t('pbrRowPosition', language)} tip={t('pbrRowPositionTip', language)}>
          <span className={`font-semibold ${classes.text}`}>{position}</span>
        </Row>
        {highText && (
          <Row label={t('pbrRowExtremes', language)} tip={t('pbrRowExtremesTip', language)}>
            <span className="font-mono">{highText}</span>
          </Row>
        )}
        {trend && (
          <Row label={t('pbrRowTrend', language)} tip={t('pbrRowTrendTip', language)}>
            <span className={`font-mono ${trend.tone}`}>{trend.icon} {trend.label} · {trend.pctText}</span>
          </Row>
        )}
        <Row label={t('pbrRowSignal', language)} tip={t('pbrRowSignalTip', language)}>
          <span className={`font-mono font-semibold ${classes.text}`}>{signal}</span>
        </Row>
      </dl>

      <div className="mt-2 rounded-md bg-muted/15 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
        {language === 'ko'
          ? `${highText || medianText}. PBR은 중앙값 가격과 상단 가격을 함께 봐야 합니다.`
          : `${highText || medianText}. Read the median and upper-band values together.`}
      </div>

      {pbr.reratingNote && (
        <div className="mt-2 text-[10px] leading-4 text-muted-foreground">{pbr.reratingNote}</div>
      )}
    </div>
  );
}

/** 사이클 정점을 언제로 보느냐에 따른 주당 가치.
 *
 * 기존 DCF 는 정점 개념이 없어 '지금 이익이 영원히 이어진다'로 계산한다. 사이클
 * 업종에서는 그것만으로 4배가 갈린다(실측 000660.KS: 정점 없이 597만, 2년 뒤
 * 정점이면 158만). 정점 연도를 알려 주는 자료는 없으므로 하나를 박지 않고
 * 나란히 놓아, 지금 가격이 어느 시나리오에 앉아 있는지를 보이게 한다.
 */
function CyclePeakCard({
  report, currency, language,
}: {
  report?: Record<string, any> | null;
  currency: string;
  language: ReportLanguage;
}) {
  const rows = Array.isArray(report?.cycle_peak_scenarios) ? report!.cycle_peak_scenarios : [];
  if (rows.length === 0) return null;
  const note = typeof report?.cycle_normalization_note === 'string' ? report!.cycle_normalization_note : '';
  const isKo = language === 'ko';

  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="text-[11px] font-semibold text-foreground">
        {isKo ? '사이클 정점 시나리오' : 'Cycle peak scenarios'}
      </div>
      <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
        {isKo
          ? '정점 이후 정상 수준까지 내려오는 경로를 반영한 주당 가치입니다. 위쪽 선행 내재가치는 정점 없이 계산한 값입니다.'
          : 'Per-share value along a peak-then-normalise path. The forward intrinsic tiles above assume no peak.'}
      </div>
      <dl className="mt-2 space-y-1">
        {rows.map((row: any) => {
          const perShare = Number(row?.intrinsic_per_share);
          const gap = Number(row?.gap_to_price);
          const years = Number(row?.years_to_peak);
          if (!Number.isFinite(perShare) || !Number.isFinite(years)) return null;
          // 현재가에 가장 가까운 시나리오가 '시장이 보고 있는 정점'이다.
          const nearest = Number.isFinite(gap) && Math.abs(gap) <= 0.15;
          return (
            <div key={years} className="flex items-baseline justify-between gap-2 text-[11px]">
              <dt className={nearest ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                {isKo ? `정점 ${years}년 뒤` : `Peak in ${years}y`}
                {nearest && <span className="ml-1 text-[9px] font-normal">{isKo ? '· 현재가 수준' : '· near price'}</span>}
              </dt>
              <dd className={`font-mono ${nearest ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                {formatCurrency(perShare, currency)}
                {Number.isFinite(gap) && (
                  <span className="ml-1 text-[10px]">({gap > 0 ? '+' : ''}{(gap * 100).toFixed(0)}%)</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {note && <div className="mt-1.5 font-mono text-[9px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function ValuationGapNotice({
  dive,
  brokerConsensus,
  currentPrice,
  currency,
  language,
}: {
  dive: ValuationDeepDive;
  brokerConsensus?: BrokerConsensusSnapshot | null;
  currentPrice?: number | null;
  currency: string;
  language: ReportLanguage;
}) {
  const dcfModel = dive.models.find(model => model.key === 'dcf');
  const dcfValue = dcfModel?.intrinsicPerShare ?? null;
  const safetyPrice = dcfValue !== null && Number.isFinite(dcfValue) && dcfValue > 0
    ? dcfValue * (1 - SAFETY_MARGIN_DISPLAY_BUFFER)
    : null;
  const rimValue = dive.rim?.intrinsicPerShare
    ?? dive.models.find(model => model.key === 'residual_income')?.intrinsicPerShare
    ?? null;
  const consensus = brokerConsensus?.consensus ?? null;
  const livePrice = currentPrice && Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;
  const safetyGap = livePrice && safetyPrice ? (safetyPrice - livePrice) / livePrice : null;
  const rimGap = livePrice && rimValue ? (rimValue - livePrice) / livePrice : null;
  const consensusGap = livePrice && consensus ? (consensus - livePrice) / livePrice : null;
  const shouldShow = Boolean(
    livePrice
    && (
      (safetyGap !== null && Math.abs(safetyGap) >= 0.35)
      || (rimGap !== null && Math.abs(rimGap) >= 0.35)
    ),
  );

  if (!shouldShow) return null;

  return (
    <div className="relative rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('valuationGapNoticeTitle', language)}
        </div>
        <InfoDot title={t('valuationGapNoticeTip', language)} />
      </div>
      <div className="mt-1 text-[10px] leading-4 text-muted-foreground">
        {t('valuationGapNoticeBody', language)}
      </div>
      <dl className="mt-2 space-y-1 text-[10px]">
        <Row label={language === 'ko' ? '현재가' : 'Current'}>
          <span className="font-mono text-foreground">{formatCurrency(livePrice, currency)}</span>
        </Row>
        {consensus !== null && (
          <Row label={language === 'ko' ? '증권사 평균' : 'Broker avg'}>
            <span className="font-mono text-foreground">
              {formatCurrency(consensus, currency)} {consensusGap !== null ? `(${formatPercent(consensusGap)})` : ''}
            </span>
          </Row>
        )}
        {/* 위 타일의 '안전가'와 이름이 겹치면 안 된다 — 여기 값은 가치평가
            분석가의 보수 DCF(후행 FCF · 대형주 성장률 10% 상한 · 변동성 보정)에서
            나온 별개의 숫자다. 같은 이름의 다른 값이 둘 뜨면 독자는 어느 쪽이
            틀린 줄 안다. */}
        {safetyPrice !== null && (
          <Row label={language === 'ko'
            ? `보수 DCF 안전가 (가치평가 분석가 · 적정가 −${Math.round(SAFETY_MARGIN_DISPLAY_BUFFER * 100)}%)`
            : `Conservative DCF safety (Valuation Analyst, fair −${Math.round(SAFETY_MARGIN_DISPLAY_BUFFER * 100)}%)`}>
            <span className="font-mono">
              {formatCurrency(safetyPrice, currency)} {safetyGap !== null ? `(${formatPercent(safetyGap)})` : ''}
            </span>
          </Row>
        )}
        {rimValue !== null && (
          <Row label={language === 'ko' ? 'RIM' : 'RIM'}>
            <span className="font-mono">
              {formatCurrency(rimValue, currency)} {rimGap !== null ? `(${formatPercent(rimGap)})` : ''}
            </span>
          </Row>
        )}
      </dl>
    </div>
  );
}

/** 모델 이름 → 설명. 이름만으로는 무엇을 재는 값인지 알 수 없다.
 *
 * 화면에 DCF·Owner Earnings·EV/EBITDA·EV/EBIT·EBITDA 정규화·ROIC−WACC EVA·RIM 이
 * 한꺼번에 뜨는데, 각각이 무엇을 보는 값인지 모르면 숫자 일곱 개가 그냥 흩어진
 * 값으로 읽힌다. 이름에 걸리는 낱말로 설명을 붙인다(라벨 문구가 조금 바뀌어도
 * 계속 걸리도록 넓게 잡는다).
 */
const VALUATION_MODEL_GLOSSARY: Array<{ match: RegExp; key: string }> = [
  { match: /owner|오너/i, key: 'valuationModelGlossaryOwner' },
  { match: /ev\s*\/?\s*ebitda/i, key: 'valuationModelGlossaryEvEbitda' },
  { match: /ev\s*\/?\s*ebit\b/i, key: 'valuationModelGlossaryEvEbit' },
  { match: /ebitda/i, key: 'valuationModelGlossaryEbitda' },
  { match: /eva|roic/i, key: 'valuationModelGlossaryEva' },
  { match: /rim|잔여이익/i, key: 'valuationModelGlossaryRim' },
  { match: /pbr/i, key: 'valuationModelGlossaryPbr' },
  { match: /dcf|현금흐름/i, key: 'valuationModelGlossaryDcf' },
];

function valuationModelTip(label: string, language: ReportLanguage): string | undefined {
  const hit = VALUATION_MODEL_GLOSSARY.find(entry => entry.match.test(label));
  return hit ? t(hit.key, language) : undefined;
}

function ValuationModelsSummary({
  dive,
  currency,
  language,
}: {
  dive: ValuationDeepDive;
  currency: string;
  language: ReportLanguage;
}) {
  // Compact at-a-glance list of every valuation model the agent emitted, so
  // EV/EBITDA, EBITDA (normalized) and ROIC−WACC EVA surface alongside DCF/RIM.
  // Flagged outliers (excluded from the blend) are pushed to the bottom and
  // tagged low-confidence so they stay visible without distorting the read.
  const visible = dive.models.filter(m => m.intrinsicPerShare !== null && m.intrinsicPerShare !== undefined);
  if (visible.length === 0) return null;
  const rows = [
    ...visible.filter(m => !m.isOutlier),
    ...visible.filter(m => m.isOutlier),
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('valuationModelsSummaryTitle', language)}
        </div>
        <InfoDot title={t('valuationModelsHowToRead', language)} />
      </div>
      <dl className="space-y-0.5 text-[10px]">
        {rows.map(model => {
          const classes = toneToClasses(model.signal);
          return (
            <div
              key={model.key}
              className={`flex items-center justify-between gap-2${model.isOutlier ? ' opacity-60' : ''}`}
            >
              <dt className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
                <span className="truncate" title={valuationModelTip(model.labelKey, language)}>
                  {model.labelKey}
                </span>
                {model.isOutlier && (
                  <span
                    title={model.outlierNote ?? undefined}
                    className="shrink-0 rounded-sm border border-amber-500/40 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
                  >
                    {t('valuationLowConfidenceBadge', language)}
                  </span>
                )}
              </dt>
              <dd className={`flex items-center gap-1.5 font-mono ${model.isOutlier ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
                <span>{formatCurrency(model.intrinsicPerShare, currency)}</span>
                {model.gapToMarket !== null && model.gapToMarket !== undefined && (
                  <span className="text-[9px]">{formatPercent(model.gapToMarket)}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// Amber "low-confidence" badge for a model excluded from the blend, shared by
// the compact summary list and the prominent per-model detail cards so a
// flagged model never looks like a live valuation in either place.
function ModelLowConfidenceBadge({ note, language }: { note?: string | null; language: ReportLanguage }) {
  return (
    <span
      title={note ?? undefined}
      className="shrink-0 rounded-sm border border-amber-500/40 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
    >
      {t('valuationLowConfidenceBadge', language)}
    </span>
  );
}

function CashFlowInsightCard({
  cashFlow,
  currency,
  language,
}: {
  cashFlow: CashFlowInsight;
  currency: string;
  language: ReportLanguage;
}) {
  const ko = language === 'ko';
  const trapTone: ReportTone =
    cashFlow.valueTrapFlag === 'genuine_value' ? 'bullish'
    : cashFlow.valueTrapFlag === 'trap_risk' ? 'bearish'
    : 'neutral';
  const capacityTone: ReportTone =
    cashFlow.shareholderCapacity === 'strong' ? 'bullish'
    : cashFlow.shareholderCapacity === 'negative' ? 'bearish'
    : 'neutral';

  const trapText = cashFlow.valueTrapFlag
    ? t(`cashFlowTrap_${cashFlow.valueTrapFlag}`, language)
    : null;
  const capacityText = cashFlow.shareholderCapacity
    ? t(`cashFlowCapacity_${cashFlow.shareholderCapacity}`, language)
    : null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{t('cashFlowInsightTitle', language)}</span>
        <InfoDot title={t('cashFlowInsightTip', language)} />
      </div>
      <dl className="space-y-1 text-[10px]">
        <Row label={t('cashFlowFcffYield', language)} tip={t('cashFlowFcffTip', language)}>
          <span className="font-mono">{formatPercentPlain(cashFlow.fcffYield)}</span>
        </Row>
        <Row label={t('cashFlowFcfeYield', language)} tip={t('cashFlowFcfeTip', language)}>
          <span className="font-mono">{formatPercentPlain(cashFlow.fcfeYield)}</span>
        </Row>
        <Row label={t('cashFlowGrowth', language)} tip={t('cashFlowGrowthTip', language)}>
          <span className="font-mono">{formatPercent(cashFlow.fcfGrowth)}</span>
        </Row>
        {cashFlow.fcfeIntrinsicPerShare !== null && (
          <Row label={t('cashFlowFcfeIntrinsic', language)} tip={t('cashFlowFcfeIntrinsicTip', language)}>
            <span className="font-mono">{formatCurrency(cashFlow.fcfeIntrinsicPerShare, currency)}</span>
          </Row>
        )}
      </dl>
      {(trapText || capacityText) && (
        <div className="mt-2 space-y-1">
          {trapText && (
            <p className={`rounded-md border px-2 py-1 text-[10px] leading-4 ${toneToClasses(trapTone).border} ${toneToClasses(trapTone).text}`}>
              {ko ? '밸류트랩 점검: ' : 'Value-trap check: '}{trapText}
            </p>
          )}
          {capacityText && (
            <p className={`rounded-md border px-2 py-1 text-[10px] leading-4 ${toneToClasses(capacityTone).border} ${toneToClasses(capacityTone).text}`}>
              {ko ? '주주 환원 여력: ' : 'Shareholder return: '}{capacityText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ValuationSidebarPanel({
  dive,
  currency,
  language,
  currentPrice,
  brokerConsensus,
  mode = 'all',
}: {
  dive: ValuationDeepDive;
  currency: string;
  language: ReportLanguage;
  currentPrice?: number | null;
  brokerConsensus?: BrokerConsensusSnapshot | null;
  mode?: 'all' | 'pbrOnly' | 'afterPbr';
}) {
  const pbrModel = dive.models.find(model => model.key === 'pbr_band');
  const rimModel = dive.models.find(model => model.key === 'residual_income');
  const evModel = dive.models.find(model => model.key === 'ev_ebitda');
  const evEbitModel = dive.models.find(model => model.key === 'ev_ebit');
  const ebitdaModel = dive.models.find(model => model.key === 'ebitda_valuation');
  const evaModel = dive.models.find(model => model.key === 'roic_wacc_valuation');
  const pbrValue = dive.pbr
    ? derivePbrFairPrice(dive.pbr, dive.pbr.percentiles.p50, dive.pbr.fairPriceP50, currentPrice)
    : pbrModel?.intrinsicPerShare ?? null;
  const pbrGap = pbrModel?.gapToMarket ?? (
    currentPrice && pbrValue !== null
      ? (pbrValue - currentPrice) / currentPrice
      : null
  );
  const rimValue = dive.rim?.intrinsicPerShare ?? rimModel?.intrinsicPerShare ?? null;
  const rimGap = rimModel?.gapToMarket ?? (
    dive.rim?.intrinsicPerShare && dive.pbr?.currentPrice
      ? (dive.rim.intrinsicPerShare - dive.pbr.currentPrice) / dive.pbr.currentPrice
      : null
  );
  const evValue = evModel?.intrinsicPerShare ?? null;
  const evGap = evModel?.gapToMarket ?? (
    dive.pbr?.currentPrice && evValue !== null
      ? (evValue - dive.pbr.currentPrice) / dive.pbr.currentPrice
      : null
  );
  const pbrTone = dive.pbr?.signal ?? pbrModel?.signal ?? 'neutral';
  const rimTone = dive.rim?.signal ?? rimModel?.signal ?? 'neutral';
  const evTone = evModel?.signal ?? 'neutral';
  const hasPbr = pbrValue !== null || dive.pbr;
  const hasRim = rimValue !== null || dive.rim;
  const hasEv = evValue !== null;
  const hasEbitdaModel = (ebitdaModel?.intrinsicPerShare ?? null) !== null;
  const hasEvaModel = (evaModel?.intrinsicPerShare ?? null) !== null;
  const hasEvEbitModel = (evEbitModel?.intrinsicPerShare ?? null) !== null;

  if (!hasPbr && !hasRim && !hasEv && !hasEbitdaModel && !hasEvaModel && !hasEvEbitModel) return null;

  const evSubtitle = evModel?.medianMultiple !== null
    && evModel?.medianMultiple !== undefined
    && evModel?.currentMultiple !== null
    && evModel?.currentMultiple !== undefined
    ? fillTemplate(t('evEbitdaSubtitleMedian', language), {
        median: evModel.medianMultiple.toFixed(1),
        current: evModel.currentMultiple.toFixed(1),
      })
    : t('evEbitdaSubtitleFallback', language);
  const evCard = hasEv && (() => {
    const classes = toneToClasses(evTone);
    const isOutlier = evModel?.isOutlier === true;
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}${isOutlier ? ' opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{t('evEbitdaLabel', language)}</span>
            <InfoDot title={t('evEbitdaTip', language)} />
            {isOutlier && <ModelLowConfidenceBadge note={evModel?.outlierNote} language={language} />}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(evGap)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${isOutlier ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
          {formatCurrency(evValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">{evSubtitle}</div>
      </div>
    );
  })();
  const evEbitValue = evEbitModel?.intrinsicPerShare ?? null;
  const hasEvEbit = evEbitValue !== null;
  const evEbitCard = hasEvEbit && (() => {
    const classes = toneToClasses(evEbitModel?.signal ?? 'neutral');
    const isOutlier = evEbitModel?.isOutlier === true;
    const subtitle = evEbitModel?.medianMultiple !== null && evEbitModel?.medianMultiple !== undefined
      && evEbitModel?.currentMultiple !== null && evEbitModel?.currentMultiple !== undefined
      ? fillTemplate(t('evEbitSubtitleMedian', language), {
          median: evEbitModel.medianMultiple.toFixed(1),
          current: evEbitModel.currentMultiple.toFixed(1),
        })
      : t('evEbitSubtitleFallback', language);
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}${isOutlier ? ' opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{t('evEbitLabel', language)}</span>
            <InfoDot title={t('evEbitTip', language)} />
            {isOutlier && <ModelLowConfidenceBadge note={evEbitModel?.outlierNote} language={language} />}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(evEbitModel?.gapToMarket ?? null)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${isOutlier ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
          {formatCurrency(evEbitValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
    );
  })();
  const ebitdaValue = ebitdaModel?.intrinsicPerShare ?? null;
  const hasEbitda = ebitdaValue !== null;
  const ebitdaCard = hasEbitda && (() => {
    const classes = toneToClasses(ebitdaModel?.signal ?? 'neutral');
    const isOutlier = ebitdaModel?.isOutlier === true;
    const subtitle = ebitdaModel?.targetMultiple !== null && ebitdaModel?.targetMultiple !== undefined
      ? fillTemplate(t('ebitdaValuationSubtitle', language), {
          multiple: ebitdaModel.targetMultiple.toFixed(1),
        })
      : t('ebitdaValuationSubtitleFallback', language);
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}${isOutlier ? ' opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{t('ebitdaValuationLabel', language)}</span>
            <InfoDot title={t('ebitdaValuationTip', language)} />
            {isOutlier && <ModelLowConfidenceBadge note={ebitdaModel?.outlierNote} language={language} />}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(ebitdaModel?.gapToMarket ?? null)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${isOutlier ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
          {formatCurrency(ebitdaValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
    );
  })();
  const evaValue = evaModel?.intrinsicPerShare ?? null;
  const hasEva = evaValue !== null;
  const evaCard = hasEva && (() => {
    const classes = toneToClasses(evaModel?.signal ?? 'neutral');
    const isOutlier = evaModel?.isOutlier === true;
    const subtitle = evaModel?.roic !== null && evaModel?.roic !== undefined
      && evaModel?.wacc !== null && evaModel?.wacc !== undefined
      ? fillTemplate(t('roicWaccSubtitle', language), {
          roic: formatPercent(evaModel.roic),
          wacc: formatPercent(evaModel.wacc),
          spread: formatPercent(evaModel.spread ?? null),
        })
      : t('roicWaccSubtitleFallback', language);
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}${isOutlier ? ' opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{t('roicWaccLabel', language)}</span>
            <InfoDot title={t('roicWaccTip', language)} />
            {isOutlier && <ModelLowConfidenceBadge note={evaModel?.outlierNote} language={language} />}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(evaModel?.gapToMarket ?? null)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${isOutlier ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
          {formatCurrency(evaValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
    );
  })();
  const pbrCard = hasPbr && (() => {
    const classes = toneToClasses(pbrTone);
    return dive.pbr ? (
      <PbrBandCard
        pbr={dive.pbr}
        pbrFairP50={pbrValue}
        signalTone={pbrTone}
        currency={currency}
        language={language}
        marketCurrentPrice={currentPrice}
      />
    ) : (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}${pbrModel?.isOutlier === true ? ' opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{language === 'ko' ? 'PBR 밴드' : 'PBR Band'}</span>
            {pbrModel?.isOutlier === true && <ModelLowConfidenceBadge note={pbrModel?.outlierNote} language={language} />}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(pbrGap)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${pbrModel?.isOutlier === true ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
          {formatCurrency(pbrValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {language === 'ko' ? '밴드 평가' : 'Band value'}
        </div>
      </div>
    );
  })();
  const rimCard = hasRim && (() => {
    const classes = toneToClasses(rimTone);
    const isOutlier = rimModel?.isOutlier === true;
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}${isOutlier ? ' opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{language === 'ko' ? 'RIM 평가' : 'RIM Valuation'}</span>
            {isOutlier && <ModelLowConfidenceBadge note={rimModel?.outlierNote} language={language} />}
          </div>
          <InfoDot title={t('valuationModelGlossaryRim', language)} />
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(rimGap)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${isOutlier ? 'text-muted-foreground line-through decoration-1' : classes.text}`}>
          {formatCurrency(rimValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {dive.rim
            ? `ROE ${formatPercent(dive.rim.roeImplied)} · Ke ${formatPercent(dive.rim.costOfEquity)}`
            : (language === 'ko' ? '잔여이익모델' : 'Residual income model')}
        </div>
      </div>
    );
  })();
  const primaryPbrCard = pbrCard;
  const secondaryRimCard = rimCard;
  const cashFlowCard = dive.cashFlow && (
    <CashFlowInsightCard cashFlow={dive.cashFlow} currency={currency} language={language} />
  );
  const gapNotice = (
    <ValuationGapNotice
      dive={dive}
      brokerConsensus={brokerConsensus}
      currentPrice={currentPrice}
      currency={currency}
      language={language}
    />
  );

  if (mode === 'pbrOnly') {
    return primaryPbrCard ? <div className="mt-2 space-y-2">{primaryPbrCard}</div> : null;
  }

  if (mode === 'afterPbr') {
    return (
      <div className="mt-2 space-y-2">
        {dive.regimeNote && (
          <p className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">{dive.regimeNote}</p>
        )}
        <ValuationModelsSummary dive={dive} currency={currency} language={language} />
        {evCard}
        {evEbitCard}
        {ebitdaCard}
        {evaCard}
        {secondaryRimCard}
        {cashFlowCard}
        {gapNotice}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {dive.regimeNote && (
        <p className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">{dive.regimeNote}</p>
      )}
      {dive.regime === 'capex_heavy' ? (
        <>
          {evCard}
          {evEbitCard}
          {ebitdaCard}
          {evaCard}
          {pbrCard}
          {rimCard}
          {cashFlowCard}
          {gapNotice}
        </>
      ) : (
        <>
          {pbrCard}
          {rimCard}
          {evCard}
          {evEbitCard}
          {ebitdaCard}
          {evaCard}
          {cashFlowCard}
          {gapNotice}
        </>
      )}
    </div>
  );
}

function TargetTileCard({ tile, language }: { tile: TargetTile; language: ReportLanguage }) {
  const classes = toneToClasses(tile.tone);
  const sourceName = tile.sourceAgent
    ? (language === 'ko' ? tile.sourceAgent.nameKo : tile.sourceAgent.nameEn)
    : '';

  return (
    <div key={tile.labelKey} className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
      {tile.sourceAgent && !tile.isFromActiveAgent && (
        <span
          className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-border/70 bg-background px-1 font-mono text-[10px] font-semibold text-muted-foreground"
          title={t('targetTileFromAgent', language).replace('{name}', sourceName)}
        >
          {sourceName.slice(0, 1)}
        </span>
      )}
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(tile.labelKey, language)}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
        {tile.value}
      </div>
      {tile.note && (
        <div className="font-mono text-[10px] text-muted-foreground">{tile.note}</div>
      )}
      <div className="text-[10px] text-muted-foreground">
        {t(tile.sublabelKey, language)}
      </div>
    </div>
  );
}

function BrokerConsensusTile({
  brokerConsensus,
  currency,
  language,
  currentPrice,
}: {
  brokerConsensus: BrokerConsensusSnapshot | null | undefined;
  currency: string;
  language: ReportLanguage;
  currentPrice?: number | null;
}) {
  const consensus = brokerConsensus?.consensus ?? null;
  if (consensus === null || !Number.isFinite(consensus) || consensus <= 0) return null;

  const brokerCount = Math.max(0, brokerConsensus?.brokerCount ?? 0);
  const upside = currentPrice && Number.isFinite(currentPrice) && currentPrice > 0
    ? (consensus - currentPrice) / currentPrice
    : null;
  const brokerLabel = language === 'ko'
    ? `${brokerCount}명`
    : `${brokerCount} brokers`;
  const subtitle = upside !== null
    ? `${brokerLabel} · ${language === 'ko' ? '현재가 대비' : 'vs current'} ${formatPercent(upside)}`
    : brokerLabel;

  return (
    <div className="relative rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('brokerConsensusLabel', language)}
        </div>
        <InfoDot title={t('brokerConsensusTip', language)} />
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-foreground">
        {formatCurrency(consensus, currency)}
        <KrwEquivalent value={consensus} currency={currency} />
      </div>
      <div className="text-[10px] text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function ForwardConsensusTile({
  brokerConsensus,
  currency,
  language,
}: {
  brokerConsensus: BrokerConsensusSnapshot | null | undefined;
  currency: string;
  language: ReportLanguage;
}) {
  const forwardEps = brokerConsensus?.forwardEps ?? null;
  if (forwardEps === null || !Number.isFinite(forwardEps) || forwardEps <= 0) return null;

  const forwardPer = brokerConsensus?.forwardPer ?? null;
  const forwardPerText = forwardPer !== null && Number.isFinite(forwardPer) && forwardPer > 0
    ? `${forwardPer.toFixed(1)}`
    : '—';

  return (
    <div className="relative rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('targetEpsLabel', language)}
        </div>
        <InfoDot title={t('forwardConsensusTip', language)} />
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-foreground">
        {formatCurrency(forwardEps, currency)}
        <KrwEquivalent value={forwardEps} currency={currency} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {t('fwdPerCurrentLabel', language)} {forwardPerText}
      </div>
    </div>
  );
}

function ConsensusBridgeTile({
  brokerConsensus,
  dive,
  currency,
  language,
  currentPrice,
}: {
  brokerConsensus: BrokerConsensusSnapshot | null | undefined;
  dive: ValuationDeepDive | null | undefined;
  currency: string;
  language: ReportLanguage;
  currentPrice?: number | null;
}) {
  const consensus = brokerConsensus?.consensus ?? null;
  const pbr = dive?.pbr ?? null;
  if (
    consensus === null
    || !Number.isFinite(consensus)
    || consensus <= 0
    || !pbr
  ) return null;

  const forwardEps = brokerConsensus?.forwardEps ?? null;
  const impliedFwdPer = forwardEps !== null && Number.isFinite(forwardEps) && forwardEps > 0
    ? consensus / forwardEps
    : null;
  const pbrBasis = derivePbrBps(pbr, currentPrice);
  const impliedPbr = pbrBasis !== null && pbrBasis > 0
    ? consensus / pbrBasis
    : null;
  const fairP50 = derivePbrFairPrice(pbr, pbr.percentiles.p50, pbr.fairPriceP50, currentPrice);
  const fairP90 = derivePbrFairPrice(pbr, pbr.percentiles.p90, pbr.fairPriceP90, currentPrice);
  const gapToP50 = fairP50 ? (consensus - fairP50) / fairP50 : null;
  const gapToP90 = fairP90 ? (consensus - fairP90) / fairP90 : null;
  const displayCurrentPrice = currentPrice ?? pbr.currentPrice;
  const upsideToCurrent = displayCurrentPrice ? (consensus - displayCurrentPrice) / displayCurrentPrice : null;
  const perText = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}`;
  const p90Text = gapToP90 === null
    ? '—'
    : (language === 'ko'
        ? `90% 대비 ${formatPercent(gapToP90)}`
        : `${formatPercent(gapToP90)} vs 90%`);

  return (
    <div className="relative rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('consensusBridgeLabel', language)}
        </div>
        <InfoDot title={t('consensusBridgeTip', language)} />
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-foreground">
        {formatCurrency(consensus, currency)}
        <KrwEquivalent value={consensus} currency={currency} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {t('fwdPerTargetLabel', language)} {perText(impliedFwdPer)} · PBR {formatPbrMultiple(impliedPbr)}
      </div>
      {/* 중위값·상단 시나리오는 바로 위 PBR 밴드 카드에 이미 있고, RIM 은 아래
          '보수 모델 괴리 확인' 카드에 또 있었다. 같은 숫자가 한 화면에 세 번
          나오면 어느 것이 기준인지 흐려진다. 여기서는 '목표가가 그 기준들에서
          얼마나 떨어져 있는가'만 남긴다 — 그게 이 카드의 일이다. */}
      <div className="mt-2 text-[10px] leading-4 text-muted-foreground">
        {p90Text}
        {upsideToCurrent !== null && (
          <span> · {language === 'ko' ? '현재가 대비' : 'vs current'} {formatPercent(upsideToCurrent)}</span>
        )}
        {gapToP50 !== null && (
          <span> · 50% {formatPercent(gapToP50)}</span>
        )}
      </div>
    </div>
  );
}

export function TargetDataSidebar({
  tiles,
  otherAgents,
  language,
  onSwitchAgent,
  className = '',
  report,
  valuationDeepDive,
  currency = 'USD',
  brokerConsensus,
  currentPrice,
}: TargetDataSidebarProps) {
  const primaryTiles = ORDERED_PRIMARY_TILE_KEYS
    .map(key => tiles.find(tile => tile.labelKey === key))
    .filter((tile): tile is TargetTile => Boolean(tile));
  const secondaryTiles = tiles.filter(tile => !PRIMARY_TILE_KEYS.has(tile.labelKey));
  const hasBrokerConsensus = Boolean(
    brokerConsensus?.consensus
    && Number.isFinite(brokerConsensus.consensus)
    && brokerConsensus.consensus > 0,
  );
  const hasForwardConsensus = Boolean(
    brokerConsensus?.forwardEps
    && Number.isFinite(brokerConsensus.forwardEps)
    && brokerConsensus.forwardEps > 0,
  );
  const secondaryTilesForBottom = secondaryTiles.filter(tile => (
    hasForwardConsensus ? tile.labelKey !== 'targetEpsLabel' : true
  ));
  const hasConsensusBridge = Boolean(hasBrokerConsensus && valuationDeepDive?.pbr);
  const hasAnyContent = tiles.length > 0 || Boolean(valuationDeepDive) || hasBrokerConsensus || hasForwardConsensus;

  return (
    <aside className={`w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-[280px] lg:self-start lg:overflow-y-auto lg:max-h-[calc(100vh-6rem)] ${className}`}>
      <div className="rounded-xl border border-border/60 bg-background p-3 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('targetDataTitle', language)}
        </h3>
        {hasAnyContent ? (
          <>
            {(hasBrokerConsensus || hasForwardConsensus) && (
              <div className="report-sidebar-page1-end grid grid-cols-2 gap-2 lg:grid-cols-1">
                <BrokerConsensusTile
                  brokerConsensus={brokerConsensus}
                  currency={currency}
                  language={language}
                  currentPrice={currentPrice}
                />
                <ForwardConsensusTile
                  brokerConsensus={brokerConsensus}
                  currency={currency}
                  language={language}
                />
              </div>
            )}
            {valuationDeepDive && (
              <ValuationSidebarPanel
                dive={valuationDeepDive}
                currency={currency}
                language={language}
                currentPrice={currentPrice}
                brokerConsensus={brokerConsensus}
                mode="pbrOnly"
              />
            )}
            {hasConsensusBridge && (
              <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-1">
                <ConsensusBridgeTile
                  brokerConsensus={brokerConsensus}
                  dive={valuationDeepDive}
                  currency={currency}
                  language={language}
                  currentPrice={currentPrice}
                />
              </div>
            )}
            {primaryTiles.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-1">
                {primaryTiles.map(tile => <TargetTileCard key={tile.labelKey} tile={tile} language={language} />)}
                <CyclePeakCard report={report} currency={currency} language={language} />
              </div>
            )}
            {valuationDeepDive && (
              <ValuationSidebarPanel
                dive={valuationDeepDive}
                currency={currency}
                language={language}
                currentPrice={currentPrice}
                brokerConsensus={brokerConsensus}
                mode="afterPbr"
              />
            )}
            {secondaryTilesForBottom.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-1">
                {secondaryTilesForBottom.map(tile => <TargetTileCard key={tile.labelKey} tile={tile} language={language} />)}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center text-[11px] text-muted-foreground">
            {report?.data_coverage !== undefined && report.data_coverage !== null && report.data_coverage < 0.4
              ? (language === 'ko' ? '데이터 커버리지가 낮아 핵심 타겟을 보류했습니다.' : 'Target data is on hold due to low coverage.')
              : (language === 'ko' ? '핵심 타겟 데이터가 없습니다.' : 'No target data available.')}
          </div>
        )}

        {otherAgents.length > 0 && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('otherAgentsTitle', language)}
            </h3>
            <div className="space-y-1">
              {otherAgents.map(agent => {
                const classes = toneToClasses(agent.tone);
                const displayName = language === 'ko' ? agent.displayNameKo : agent.displayNameEn;
                return (
                  <button
                    key={agent.key}
                    type="button"
                    onClick={() => onSwitchAgent(agent.key)}
                    aria-label={`${displayName} 분석으로 전환`}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-border/60 hover:bg-muted/30"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${classes.bg}`} />
                      <span className="truncate font-medium">{displayName}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px]">
                      <span className={`rounded-full px-1.5 py-0.5 font-semibold ${classes.badge}`}>
                        {shortTone(agent.tone)}
                      </span>
                      <span className="font-mono text-muted-foreground">{Math.round(agent.score)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-3 min-h-[44px] w-full"
          disabled
          aria-disabled="true"
          title={t('comingSoonLabel', language)}
        >
          {t('openConsensusMatrix', language)}
          <ChevronRight className="ml-auto h-3.5 w-3.5" />
        </Button>

      </div>
    </aside>
  );
}
