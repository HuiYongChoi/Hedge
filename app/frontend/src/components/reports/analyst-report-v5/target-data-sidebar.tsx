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
}

interface BrokerConsensusSnapshot {
  consensus: number | null;
  brokerCount: number;
  forwardEps: number | null;
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

function fillTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (next, [key, value]) => next.replace(`{${key}}`, value),
    template,
  );
}

const ORDERED_PRIMARY_TILE_KEYS = ['targetIntrinsicLabel', 'targetMarginLabel'] as const;
const PRIMARY_TILE_KEYS = new Set<string>(ORDERED_PRIMARY_TILE_KEYS);

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, value));
}

function ratioToBandPct(value: number, p10: number, p90: number) {
  const range = p90 - p10;
  if (!Number.isFinite(range) || range <= 0) return 50;
  return clampPercent(((value - p10) / range) * 100);
}

function derivePbrFairPrice(pbr: PbrBand, percentile: number, fallback: number | null | undefined) {
  if (
    pbr.currentPrice !== null
    && Number.isFinite(pbr.currentPrice)
    && pbr.currentPrice > 0
    && Number.isFinite(pbr.currentPbr)
    && pbr.currentPbr > 0
    && Number.isFinite(percentile)
    && percentile > 0
  ) {
    return pbr.currentPrice * percentile / pbr.currentPbr;
  }
  return fallback ?? null;
}

function pbrPositionText(position: PbrBand['positionLabel'], language: ReportLanguage) {
  const labels = {
    below_p25: language === 'ko' ? '밴드 하단 (P10–P25)' : 'Band lower (P10–P25)',
    p25_p50: language === 'ko' ? '밴드 중하 (P25–P50)' : 'Band mid-low (P25–P50)',
    p50_p75: language === 'ko' ? '밴드 중상 (P50–P75)' : 'Band mid-high (P50–P75)',
    above_p75: language === 'ko' ? '밴드 상단 (P75–P90)' : 'Band upper (P75–P90)',
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
        title={`현재 PBR ${currentPbr.toFixed(2)}x`}
      />
      {scenarioPbr !== null && scenarioPct !== null && (
        <div
          className="absolute -top-2 h-6 w-[3px] -translate-x-1/2 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_0_10px_rgba(245,158,11,0.55)]"
          style={{ left: `${clampPercent(scenarioPct)}%` }}
          title={`입력 PBR ${scenarioPbr.toFixed(2)}x`}
        />
      )}
    </div>
  );
}

function PbrBandCard({
  pbr,
  pbrFairP50,
  gapToMarket,
  signalTone,
  currency,
  language,
}: {
  pbr: PbrBand;
  pbrFairP50: number | null;
  gapToMarket: number | null;
  signalTone: ReportTone;
  currency: string;
  language: ReportLanguage;
}) {
  const classes = toneToClasses(signalTone);
  const [assumptionPbrInput, setAssumptionPbrInput] = useState(() => pbr.currentPbr.toFixed(2));
  useEffect(() => {
    setAssumptionPbrInput(pbr.currentPbr.toFixed(2));
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
  const fairP10 = derivePbrFairPrice(pbr, pbr.percentiles.p10, pbr.fairPriceP10);
  const fairP50 = derivePbrFairPrice(pbr, pbr.percentiles.p50, pbrFairP50);
  const pbrFairP90 = derivePbrFairPrice(pbr, pbr.percentiles.p90, pbr.fairPriceP90);
  const assumptionPrice = assumptionPbr === null
    ? null
    : derivePbrFairPrice(pbr, assumptionPbr, null);
  const assumptionGap = pbr.currentPrice && assumptionPrice !== null
    ? (assumptionPrice - pbr.currentPrice) / pbr.currentPrice
    : null;
  const assumptionPriceText = assumptionPrice !== null
    ? formatCurrency(assumptionPrice, currency)
    : (language === 'ko' ? '입력 필요' : 'Enter PBR');
  const assumptionGapText = assumptionGap !== null
    ? (language === 'ko'
        ? `현재가 대비 ${formatPercent(assumptionGap)}`
        : `${formatPercent(assumptionGap)} vs current`)
    : (language === 'ko' ? 'PBR을 입력하면 계산됩니다' : 'Enter a PBR to calculate');
  const displayGap = pbr.currentPrice && fairP50 !== null
    ? (fairP50 - pbr.currentPrice) / pbr.currentPrice
    : gapToMarket;
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
        <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('pbrCardTitle', language)}
          <InfoDot title={t('pbrCardTitleTip', language)} />
        </div>
        <div className={`font-mono text-[11px] font-semibold ${classes.text}`}>{formatPercent(displayGap)}</div>
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium text-muted-foreground">
            {language === 'ko' ? 'P50 기준 주가' : 'P50 price'}
          </div>
          <div className={`font-mono text-xl font-semibold ${classes.text}`}>
            {formatCurrency(fairP50, currency)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">
            {language === 'ko' ? '현재 PBR' : 'Current PBR'}
          </div>
          <div className="font-mono text-sm font-semibold text-foreground">{pbr.currentPbr.toFixed(2)}x</div>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] text-muted-foreground">{language === 'ko' ? '현재 위치' : 'Position'}</div>
          <div className={`text-[11px] font-semibold ${classes.text}`}>{position}</div>
        </div>
        <label className="flex flex-col items-end gap-1 text-[10px] text-muted-foreground">
          {language === 'ko' ? '입력 PBR' : 'Input PBR'}
          <div className="flex items-center gap-1">
            <input
              value={assumptionPbrInput}
              onChange={event => setAssumptionPbrInput(event.target.value)}
              inputMode="decimal"
              placeholder={pbr.currentPbr.toFixed(2)}
              aria-label={language === 'ko' ? 'PBR 배수 입력' : 'PBR multiple input'}
              className="h-7 w-16 rounded-md border border-border/70 bg-background px-2 text-right font-mono text-xs font-semibold text-foreground outline-none focus:border-amber-400"
            />
            <span className="font-mono text-xs font-semibold text-foreground">x</span>
          </div>
        </label>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{medianText}</span>
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
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
          <div className="text-muted-foreground">{language === 'ko' ? '현재 PBR 기준' : 'Current PBR basis'}</div>
          <div className="font-mono text-sm font-semibold text-foreground">{pbr.currentPbr.toFixed(2)}x</div>
        </div>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <div className="text-muted-foreground">{language === 'ko' ? '입력 PBR 기준 주가' : 'Input PBR price'}</div>
          <div className="font-mono text-sm font-semibold text-amber-300">{assumptionPriceText}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{assumptionGapText}</div>
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
        <span>{language === 'ko' ? '하단' : 'Low'} {pbr.percentiles.p10.toFixed(2)}x</span>
        <span>P50 {pbr.percentiles.p50.toFixed(2)}x</span>
        <span>{language === 'ko' ? '상단' : 'High'} {pbr.percentiles.p90.toFixed(2)}x</span>
      </div>

      <dl className="mt-3 space-y-1 border-t border-border/50 pt-2 text-[10px]">
        <Row label={language === 'ko' ? '하단 방어가' : 'Lower band'}>
          <span className="font-mono">{formatCurrency(fairP10, currency)}</span>
        </Row>
        <Row label={language === 'ko' ? 'P50 기준 주가' : 'P50 price'}>
          <span className="font-mono font-semibold text-foreground">{formatCurrency(fairP50, currency)}</span>
        </Row>
        <Row label={language === 'ko' ? '상단 시나리오' : 'Upper case'}>
          <span className="font-mono">{formatCurrency(pbrFairP90, currency)}</span>
        </Row>
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
  const fmtMultiple = (value: number | null) => value === null ? '—' : (
    language === 'ko' ? `${value.toFixed(2)}배` : `${value.toFixed(2)}x`
  );
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

function ValuationSidebarPanel({
  dive,
  currency,
  language,
}: {
  dive: ValuationDeepDive;
  currency: string;
  language: ReportLanguage;
}) {
  const pbrModel = dive.models.find(model => model.key === 'pbr_band');
  const rimModel = dive.models.find(model => model.key === 'residual_income');
  const evModel = dive.models.find(model => model.key === 'ev_ebitda');
  const pbrValue = dive.pbr
    ? derivePbrFairPrice(dive.pbr, dive.pbr.percentiles.p50, dive.pbr.fairPriceP50)
    : pbrModel?.intrinsicPerShare ?? null;
  const pbrGap = pbrModel?.gapToMarket ?? (
    dive.pbr?.currentPrice && pbrValue !== null
      ? (pbrValue - dive.pbr.currentPrice) / dive.pbr.currentPrice
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

  if (!hasPbr && !hasRim && !hasEv && !hasJustifiedPbr) return null;

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
  const pbrCard = hasPbr && (() => {
    const classes = toneToClasses(pbrTone);
    return dive.pbr ? (
      <PbrBandCard
        pbr={dive.pbr}
        pbrFairP50={pbrValue}
        gapToMarket={pbrGap}
        signalTone={pbrTone}
        currency={currency}
        language={language}
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

  return (
    <div className="mt-2 space-y-2">
      {dive.regimeNote && (
        <p className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">{dive.regimeNote}</p>
      )}
      {dive.regime === 'capex_heavy' ? (
        <>
          {evCard}
          {pbrCard}
          {justifiedCard}
          {rimCard}
        </>
      ) : (
        <>
          {pbrCard}
          {justifiedCard}
          {rimCard}
          {evCard}
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
}: {
  brokerConsensus: BrokerConsensusSnapshot | null | undefined;
  currency: string;
  language: ReportLanguage;
}) {
  const consensus = brokerConsensus?.consensus ?? null;
  if (consensus === null || !Number.isFinite(consensus) || consensus <= 0) return null;

  const brokerCount = Math.max(0, brokerConsensus?.brokerCount ?? 0);
  const forwardEps = brokerConsensus?.forwardEps ?? null;
  const fwdPer = forwardEps !== null && Number.isFinite(forwardEps) && forwardEps > 0
    ? consensus / forwardEps
    : null;
  const brokerLabel = language === 'ko'
    ? `${brokerCount}명`
    : `${brokerCount} brokers`;
  const subtitle = fwdPer !== null
    ? `Fwd PER ${fwdPer.toFixed(2)}x · ${brokerLabel}`
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

function ConsensusBridgeTile({
  brokerConsensus,
  dive,
  currency,
  language,
}: {
  brokerConsensus: BrokerConsensusSnapshot | null | undefined;
  dive: ValuationDeepDive | null | undefined;
  currency: string;
  language: ReportLanguage;
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
  const impliedPbr = pbr.bvps !== null && pbr.bvps > 0
    ? consensus / pbr.bvps
    : null;
  const fairP50 = derivePbrFairPrice(pbr, pbr.percentiles.p50, pbr.fairPriceP50);
  const fairP90 = derivePbrFairPrice(pbr, pbr.percentiles.p90, pbr.fairPriceP90);
  const gapToP50 = fairP50 ? (consensus - fairP50) / fairP50 : null;
  const gapToP90 = fairP90 ? (consensus - fairP90) / fairP90 : null;
  const upsideToCurrent = pbr.currentPrice ? (consensus - pbr.currentPrice) / pbr.currentPrice : null;
  const rimValue = dive?.rim?.intrinsicPerShare ?? null;
  const multipleText = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}x`;
  const p90Text = gapToP90 === null
    ? '—'
    : (language === 'ko'
        ? `P90 대비 ${formatPercent(gapToP90)}`
        : `${formatPercent(gapToP90)} vs P90`);

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
        FwdPER {multipleText(impliedFwdPer)} · PBR {multipleText(impliedPbr)}
      </div>
      <dl className="mt-2 space-y-0.5 text-[10px]">
        <Row label={language === 'ko' ? 'P50 기준 주가' : 'P50 price'}>
          <span className="font-mono">{formatCurrency(fairP50, currency)}</span>
        </Row>
        <Row label={language === 'ko' ? 'P90 상단 시나리오' : 'P90 upper case'}>
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
          <span> · P50 {formatPercent(gapToP50)}</span>
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
}: TargetDataSidebarProps) {
  const primaryTiles = ORDERED_PRIMARY_TILE_KEYS
    .map(key => tiles.find(tile => tile.labelKey === key))
    .filter((tile): tile is TargetTile => Boolean(tile));
  const secondaryTiles = tiles.filter(tile => !PRIMARY_TILE_KEYS.has(tile.labelKey));
  const topTiles = primaryTiles.length > 0 ? primaryTiles : tiles;
  const hasBrokerConsensus = Boolean(
    brokerConsensus?.consensus
    && Number.isFinite(brokerConsensus.consensus)
    && brokerConsensus.consensus > 0,
  );
  const hasConsensusBridge = Boolean(hasBrokerConsensus && valuationDeepDive?.pbr);

  return (
    <aside className={`w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-[280px] lg:self-start lg:overflow-y-auto lg:max-h-[calc(100vh-6rem)] ${className}`}>
      <div className="rounded-xl border border-border/60 bg-background p-3 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('targetDataTitle', language)}
        </h3>
        {tiles.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {topTiles.map(tile => <TargetTileCard key={tile.labelKey} tile={tile} language={language} />)}
            </div>
            {valuationDeepDive && (
              <ValuationSidebarPanel
                dive={valuationDeepDive}
                currency={currency}
                language={language}
              />
            )}
            {primaryTiles.length > 0 && (secondaryTiles.length > 0 || hasBrokerConsensus || hasConsensusBridge) && (
              <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-1">
                {secondaryTiles.map(tile => <TargetTileCard key={tile.labelKey} tile={tile} language={language} />)}
                <BrokerConsensusTile
                  brokerConsensus={brokerConsensus}
                  currency={currency}
                  language={language}
                />
                <ConsensusBridgeTile
                  brokerConsensus={brokerConsensus}
                  dive={valuationDeepDive}
                  currency={currency}
                  language={language}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-lg border border-dashed p-4 text-center text-[11px] text-muted-foreground">
              {report?.data_coverage !== undefined && report.data_coverage !== null && report.data_coverage < 0.4
                ? (language === 'ko' ? '데이터 커버리지가 낮아 핵심 타겟을 보류했습니다.' : 'Target data is on hold due to low coverage.')
                : (language === 'ko' ? '핵심 타겟 데이터가 없습니다.' : 'No target data available.')}
            </div>
            {valuationDeepDive && (
              <ValuationSidebarPanel
                dive={valuationDeepDive}
                currency={currency}
                language={language}
              />
            )}
          </>
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
