import { Button } from '@/components/ui/button';
import { t } from '@/lib/language-preferences';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { computePbrTrend, toneToClasses } from './helpers';
import type { JustifiedPbrBreakdown, OtherAgent, PbrBand, ReportLanguage, ReportTone, TargetTile, ValuationDeepDive } from './types';

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

const ORDERED_PRIMARY_TILE_KEYS = ['targetIntrinsicLabel', 'targetMarginLabel'] as const;
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
      <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
        <span>{language === 'ko' ? '10%' : '10%'} {formatPbrMultiple(pbr.percentiles.p10)}</span>
        <span>50% {formatPbrMultiple(pbr.percentiles.p50)}</span>
        <span>{language === 'ko' ? '90%' : '90%'} {formatPbrMultiple(pbr.percentiles.p90)}</span>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {language === 'ko' ? '계산 기준 BPS' : 'BPS basis'} {formatCurrency(bpsBasis, currency)}
      </div>

      <dl className="mt-3 space-y-1 border-t border-border/50 pt-2 text-[10px]">
        <Row label={language === 'ko' ? '하단 방어가' : 'Lower band'}>
          <span className="font-mono">{formatCurrency(fairP10, currency)}</span>
        </Row>
        <Row label={language === 'ko' ? '역사적 PBR 중위값 기준 주가' : 'Historical median PBR price'}>
          <span className="font-mono font-semibold text-foreground">{formatCurrency(fairP50, currency)}</span>
        </Row>
        <Row label={language === 'ko' ? '상단 시나리오' : 'Upper case'}>
          <span className="font-mono">{formatCurrency(pbrFairP90, currency)}</span>
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

function JustifiedPbrCard({
  data,
  currency,
  language,
}: {
  data: JustifiedPbrBreakdown;
  currency: string;
  language: ReportLanguage;
}) {
  const classes = toneToClasses(data.signal);
  const fmtMultiple = (value: number | null) => formatPbrMultiple(value);
  const roeWindowText = data.roeSource === 'forward_eps_implied'
    ? (language === 'ko' ? `선행 ${data.roeWindow}` : `forward ${data.roeWindow}`)
    : (language === 'ko' ? `과거 ${data.roeWindow}` : data.roeWindow);
  const signalLabel = data.signal === 'bullish'
    ? (language === 'ko' ? '매수·강세' : 'Buy · bullish')
    : data.signal === 'bearish'
      ? (language === 'ko' ? '매도·약세' : 'Sell · bearish')
      : (language === 'ko' ? '중립' : 'Neutral');

  return (
    <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('justifiedPbrLabel', language)}
          <InfoDot title={t('justifiedPbrTitleTip', language)} />
        </div>
        <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(data.gapToMarket)}</div>
      </div>

      <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
        {formatCurrency(data.targetPrice, currency)}
      </div>

      <div className="text-[10px] text-muted-foreground">
        {language === 'ko'
          ? `목표 PBR ${fmtMultiple(data.justifiedPbr)} · 적용 BVPS ${formatCurrency(data.bvpsForward, currency)}`
          : `Target PBR ${fmtMultiple(data.justifiedPbr)} · BVPS ${formatCurrency(data.bvpsForward, currency)}`}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{language === 'ko' ? '입력 가정' : 'Inputs'}</span>
        <InfoDot title={t('justifiedPbrInputsTip', language)} />
      </div>
      <dl className="space-y-0.5 text-[10px]">
        <Row label="ROE" tip={t('justifiedPbrRoeTip', language)}>
          <span className="font-mono">{formatPercentPlain(data.roeUsed)} ({roeWindowText})</span>
        </Row>
        <Row label="Ke · g" tip={t('justifiedPbrKeGTip', language)}>
          <span className="font-mono">{formatPercentPlain(data.costOfEquity)} · {formatPercentPlain(data.growthG)}</span>
        </Row>
        {data.epsGrowth1y !== null && (
          <Row label={language === 'ko' ? 'EPS 성장(FY1)' : 'EPS growth (FY1)'} tip={t('justifiedPbrGrowthTip', language)}>
            <span className="font-mono">{formatPercent(data.epsGrowth1y)} (fy0-fy1)</span>
          </Row>
        )}
      </dl>

      <div className={`mt-2 text-[10px] font-mono font-semibold ${classes.text}`}>
        {language === 'ko' ? `시그널 ${signalLabel}` : `Signal ${signalLabel}`}
      </div>
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
        {safetyPrice !== null && (
          <Row label={language === 'ko' ? 'DCF 안전가' : 'DCF safety'}>
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
  const hasJustifiedPbr = Boolean(dive.justifiedPbr);
  const hasEbitdaModel = (ebitdaModel?.intrinsicPerShare ?? null) !== null;
  const hasEvaModel = (evaModel?.intrinsicPerShare ?? null) !== null;

  if (!hasPbr && !hasRim && !hasEv && !hasJustifiedPbr && !hasEbitdaModel && !hasEvaModel) return null;

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
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('evEbitdaLabel', language)}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(evGap)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
          {formatCurrency(evValue, currency)}
        </div>
        <div className="text-[10px] text-muted-foreground">{evSubtitle}</div>
      </div>
    );
  })();
  const ebitdaValue = ebitdaModel?.intrinsicPerShare ?? null;
  const hasEbitda = ebitdaValue !== null;
  const ebitdaCard = hasEbitda && (() => {
    const classes = toneToClasses(ebitdaModel?.signal ?? 'neutral');
    const subtitle = ebitdaModel?.targetMultiple !== null && ebitdaModel?.targetMultiple !== undefined
      ? fillTemplate(t('ebitdaValuationSubtitle', language), {
          multiple: ebitdaModel.targetMultiple.toFixed(1),
        })
      : t('ebitdaValuationSubtitleFallback', language);
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('ebitdaValuationLabel', language)}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(ebitdaModel?.gapToMarket ?? null)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
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
    const subtitle = evaModel?.roic !== null && evaModel?.roic !== undefined
      && evaModel?.wacc !== null && evaModel?.wacc !== undefined
      ? fillTemplate(t('roicWaccSubtitle', language), {
          roic: formatPercent(evaModel.roic),
          wacc: formatPercent(evaModel.wacc),
          spread: formatPercent(evaModel.spread ?? null),
        })
      : t('roicWaccSubtitleFallback', language);
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('roicWaccLabel', language)}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(evaModel?.gapToMarket ?? null)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
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
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {language === 'ko' ? 'PBR 밴드' : 'PBR Band'}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(pbrGap)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
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
    return (
      <div className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {language === 'ko' ? 'RIM 평가' : 'RIM Valuation'}
          </div>
          <div className={`font-mono text-[10px] font-semibold ${classes.text}`}>{formatPercent(rimGap)}</div>
        </div>
        <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
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
  const justifiedCard = dive.justifiedPbr && (
    <JustifiedPbrCard
      data={dive.justifiedPbr}
      currency={currency}
      language={language}
    />
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
    return pbrCard ? <div className="mt-2 space-y-2">{pbrCard}</div> : null;
  }

  if (mode === 'afterPbr') {
    return (
      <div className="mt-2 space-y-2">
        {dive.regimeNote && (
          <p className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">{dive.regimeNote}</p>
        )}
        {justifiedCard}
        {rimCard}
        {evCard}
        {ebitdaCard}
        {evaCard}
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
          {ebitdaCard}
          {evaCard}
          {pbrCard}
          {justifiedCard}
          {rimCard}
          {gapNotice}
        </>
      ) : (
        <>
          {pbrCard}
          {justifiedCard}
          {rimCard}
          {evCard}
          {ebitdaCard}
          {evaCard}
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
    ? `${forwardPer.toFixed(1)}x`
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
      </div>
      <div className="text-[10px] text-muted-foreground">
        FwdPER {forwardPerText} · {t('targetEpsSubtitle', language)}
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
  const rimValue = dive?.rim?.intrinsicPerShare ?? null;
  const perText = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}x`;
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
      </div>
      <div className="text-[10px] text-muted-foreground">
        FwdPER {perText(impliedFwdPer)} · PBR {formatPbrMultiple(impliedPbr)}
      </div>
      <dl className="mt-2 space-y-0.5 text-[10px]">
        <Row label={language === 'ko' ? '역사적 PBR 중위값 기준 주가' : 'Historical median PBR price'}>
          <span className="font-mono">{formatCurrency(fairP50, currency)}</span>
        </Row>
        <Row label={language === 'ko' ? '90% 상단 시나리오' : '90% upper case'}>
          <span className="font-mono">{formatCurrency(fairP90, currency)}</span>
        </Row>
        {rimValue !== null && (
          <Row label={language === 'ko' ? 'RIM' : 'RIM'}>
            <span className="font-mono">{formatCurrency(rimValue, currency)}</span>
          </Row>
        )}
      </dl>
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
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
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
