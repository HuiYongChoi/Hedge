import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/language-preferences';
import { analystTargetService } from '@/services/analyst-target-service';
import type { AnalystTarget } from '@/services/analyst-target-service';
import type { CanonicalMetrics, ReportLanguage } from '../types';
import { BrokerTargetBar } from './broker-target-bar';
import { BrokerCalloutsRow } from './broker-callouts-row';
import { BetaVolatilityFrame } from './beta-volatility-frame';
import { OpinionDistribution } from './opinion-distribution';
import { BrokerDetailGrid } from './broker-detail-grid';
import type { SigmaMark } from './types';
import { formatMoney } from './utils';

interface PriceCompassPanelProps {
  ticker: string;
  metrics: CanonicalMetrics;
  language: ReportLanguage;
  marketSigma?: number;   // default 0.14
  mosBuffer?: number;     // default 0.25
}

const MARKET_SIGMA_DEFAULT = 0.14;
const MOS_BUFFER_DEFAULT = 0.25;

interface FundamentalsRowProps {
  trailingPe: number | null;
  trailingEps: number | null;
  currentFyEps: number | null;
  forwardPe: number | null;
  forwardEps: number | null;
  currentPrice: number | null;
  consensus: number | null;
  highTarget: number | null;
  currency: string;
  language: ReportLanguage;
}

type FundamentalMetric = {
  label: string;
  value: string;
};

interface FundamentalsGroupProps {
  title: string;
  items: FundamentalMetric[];
  help: string;
  wide?: boolean;
}

function compactMetrics(items: Array<FundamentalMetric | null>): FundamentalMetric[] {
  return items.filter((item): item is FundamentalMetric => item !== null);
}

function FundamentalsGroup({ title, items, help, wide = false }: FundamentalsGroupProps) {
  if (items.length === 0) return null;
  return (
    <div className={[
      'rounded-lg border border-border/40 bg-card/60 px-3 py-2',
      wide ? 'min-w-[190px]' : 'min-w-[150px]',
    ].join(' ')}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
        {title}
        <span
          className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-white/20 text-[9px] font-bold text-white/70"
          title={help}
          aria-label={help}
        >!</span>
      </div>
      <div className="space-y-1">
        {items.map(item => (
          <div key={item.label} className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-foreground/65">{item.label}</span>
            <span className="font-mono text-sm font-semibold text-white">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FundamentalsRow({
  trailingPe,
  trailingEps,
  currentFyEps,
  forwardPe,
  forwardEps,
  currentPrice,
  consensus,
  highTarget,
  currency,
  language,
}: FundamentalsRowProps) {
  const currentFyPe =
    currentPrice != null && currentFyEps != null && currentFyEps > 0
      ? currentPrice / currentFyEps
      : null;
  const ttmItems = compactMetrics([
    trailingEps != null ? { label: t('pcpEpsTtm', language), value: formatMoney(trailingEps, currency) } : null,
    trailingPe != null ? { label: t('pcpPerTtm', language), value: `${trailingPe.toFixed(1)}×` } : null,
  ]);
  const currentFyItems = compactMetrics([
    currentFyEps != null ? { label: t('pcpEpsCurFy', language), value: formatMoney(currentFyEps, currency) } : null,
    currentFyPe != null ? { label: t('pcpPerCurFy', language), value: `${currentFyPe.toFixed(1)}×` } : null,
  ]);
  const forwardItems = compactMetrics([
    forwardEps != null ? { label: t('pcpFwdEps', language), value: formatMoney(forwardEps, currency) } : null,
    forwardPe != null ? { label: t('pcpBrokerFwdPer', language), value: `${forwardPe.toFixed(1)}×` } : null,
  ]);
  const priceItems = compactMetrics([
    currentPrice != null ? { label: t('pcpLegendCurrent', language), value: formatMoney(currentPrice, currency) } : null,
    consensus != null ? { label: t('pcpLegendConsensus', language), value: formatMoney(consensus, currency, { maximumFractionDigits: 0 }) } : null,
    highTarget != null ? { label: t('pcpHighTarget', language), value: formatMoney(highTarget, currency, { maximumFractionDigits: 0 }) } : null,
  ]);

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <FundamentalsGroup title="TTM" items={ttmItems} help={t('pcpTtmHelp', language)} />
      <FundamentalsGroup title={t('pcpGroupCurrentFy', language)} items={currentFyItems} help={t('pcpCurFyHelp', language)} />
      <FundamentalsGroup title="Forward" items={forwardItems} help={t('pcpFwdHelp', language)} />
      <FundamentalsGroup title={t('pcpGroupTargets', language)} items={priceItems} help={t('pcpTargetsHelp', language)} wide />
    </div>
  );
}

export function PriceCompassPanel({
  ticker,
  metrics,
  language,
  marketSigma = MARKET_SIGMA_DEFAULT,
  mosBuffer = MOS_BUFFER_DEFAULT,
}: PriceCompassPanelProps) {
  const [target, setTarget] = useState<AnalystTarget | null>(null);
  const [hoveredBroker, setHoveredBroker] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    analystTargetService.fetch(ticker).then(r => {
      if (!cancelled) setTarget(r);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  // ── Resolved values: agent > API ──────────────────────────────────────────
  const currentPrice =
    metrics.currentPrice?.value ??
    target?.current_price ??
    null;

  const intrinsic = metrics.intrinsicValue?.value ?? null;
  const mos = intrinsic != null ? intrinsic * (1 - mosBuffer) : null;

  const beta = metrics.beta?.value ?? target?.beta ?? null;
  const sigmaAnnual = target?.sigma_annual ?? (beta != null ? beta * marketSigma : null);

  const forwardEps =
    target?.forward_eps ??
    metrics.forwardEpsTtm?.value ??
    metrics.forwardEpsFy1?.value ??
    metrics.forwardEpsFy0?.value ??
    null;

  // forward_pe 폴백: yfinance가 forward_pe/forward_eps 없는 종목(신생 일본 alphanumeric 등)에서도
  // consensus와 current_fy_eps가 있으면 분석가 컨센서스 멀티플을 표시.
  const forwardPe =
    target?.forward_pe ??
    metrics.forwardPe?.value ??
    (target?.consensus != null && target?.current_fy_eps != null && target.current_fy_eps > 0
      ? target.consensus / target.current_fy_eps
      : null);
  const trailingPe = target?.trailing_pe ?? null;
  const trailingEps = target?.trailing_eps ?? null;
  const currentFyEps = target?.current_fy_eps ?? null;
  const currency = target?.currency ?? (ticker.toUpperCase().endsWith('.KS') || ticker.toUpperCase().endsWith('.KQ') ? 'KRW' : 'USD');

  const consensus = target?.consensus ?? null;
  const highTarget = target?.high ?? null;
  const brokers = target?.brokers ?? [];
  const distribution = target?.distribution ?? null;

  // ── Slider state (simulated beta) ─────────────────────────────────────────
  const [simBeta, setSimBeta] = useState<number>(beta ?? 1.0);
  // Re-sync when real beta loads
  useEffect(() => {
    if (beta != null) setSimBeta(beta);
  }, [beta]);

  // ── Sigma marks ───────────────────────────────────────────────────────────
  const sigmaMarks = useMemo<SigmaMark[]>(() => {
    if (!currentPrice || !beta) return [];
    const sigma = beta * marketSigma;
    return [
      { label: '-2σ', value: currentPrice * (1 - 2 * sigma) },
      { label: '-1σ', value: currentPrice * (1 - sigma) },
      { label: '+1σ', value: currentPrice * (1 + sigma) },
      { label: '+2σ', value: currentPrice * (1 + 2 * sigma) },
    ];
  }, [currentPrice, beta, marketSigma]);

  // ── Price range ───────────────────────────────────────────────────────────
  const range = useMemo(() => {
    const candidates: number[] = [];
    if (currentPrice) candidates.push(currentPrice);
    if (intrinsic) candidates.push(intrinsic);
    if (mos) candidates.push(mos);
    if (consensus) candidates.push(consensus);
    brokers.forEach(b => candidates.push(b.target_price));
    sigmaMarks.forEach(s => candidates.push(s.value));

    if (candidates.length === 0) return null;
    const lo = Math.min(...candidates);
    const hi = Math.max(...candidates);
    const span = hi - lo || (hi * 0.2);
    const pad = span * 0.04;
    // ensure min not below 0
    return { min: Math.max(0, lo - pad), max: hi + pad };
  }, [currentPrice, intrinsic, mos, consensus, brokers, sigmaMarks]);

  // ── Hide panel if no useful data ─────────────────────────────────────────
  if (!range || (!currentPrice && !consensus && brokers.length === 0)) return null;

  // ── Help text ─────────────────────────────────────────────────────────────
  const helpText = t('pcpHelp', language)
    .replace('{beta}', beta?.toFixed(2) ?? '—')
    .replace('{n}', `${brokers.length}`);

  return (
    <section className="mt-3 space-y-4 rounded-2xl border border-border/60 bg-background p-4 shadow-sm">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-bold text-foreground">{t('pcpTitle', language)}</h3>
            <span className="text-sm text-foreground/40">·</span>
            <span className="text-sm text-foreground/70">{t('pcpSubtitle', language)}</span>
          </div>
          {(beta != null || brokers.length > 0) && (
            <p className="mt-0.5 text-[11px] text-foreground/65">{helpText}</p>
          )}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-foreground/70">
          <span className="flex items-center gap-1">
            {/* Vertical line icon matches the actual current-price marker */}
            <span className="h-3 w-[2px] rounded-sm bg-white/90" />
            {t('pcpLegendCurrent', language)}
          </span>
          {consensus && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-amber-400 bg-amber-400/20" />
              {t('pcpLegendConsensus', language)}
            </span>
          )}
          {intrinsic && (
            <span className="flex items-center gap-1">
              <span className="text-emerald-400">▲</span>
              {t('pcpDcf', language)}
            </span>
          )}
        </div>
      </div>

      {/* ── Fundamentals chips row ── */}
      <FundamentalsRow
        trailingPe={trailingPe}
        trailingEps={trailingEps}
        currentFyEps={currentFyEps}
        forwardPe={forwardPe}
        forwardEps={forwardEps}
        currentPrice={currentPrice}
        consensus={consensus}
        highTarget={highTarget}
        currency={currency}
        language={language}
      />

      {/* ── Price gradient bar ── */}
      <BrokerTargetBar
        range={range}
        currentPrice={currentPrice}
        consensus={consensus}
        intrinsic={intrinsic}
        mos={mos}
        brokers={brokers}
        sigmaMarks={sigmaMarks}
        hoveredBroker={hoveredBroker}
        currency={currency}
        language={language}
      />

      {/* ── No-broker notice OR callout rows ── */}
      {brokers.length === 0 ? (
        <p className="text-xs text-foreground/60">{t('pcpNoBrokers', language)}</p>
      ) : (
        <BrokerCalloutsRow
          brokers={brokers}
          range={range}
          currentPrice={currentPrice}
          hoveredBroker={hoveredBroker}
          currency={currency}
          onHoverChange={setHoveredBroker}
        />
      )}

      {/* ── Detail panels (beta + opinion + grid) ── */}
      {(beta != null || distribution != null || brokers.length > 0) && (
        <div className="space-y-3 border-t border-border/40 pt-3">
          {/* Beta frame + Opinion distribution side by side */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BetaVolatilityFrame
              beta={beta}
              sigmaAnnual={sigmaAnnual}
              currentPrice={currentPrice}
              ticker={ticker}
              simBeta={simBeta}
              onSimBetaChange={setSimBeta}
              currency={currency}
              language={language}
            />
            <OpinionDistribution
              distribution={distribution}
              currentPrice={currentPrice}
              currency={currency}
              language={language}
            />
          </div>

          {/* Broker detail grid */}
          <BrokerDetailGrid
            brokers={brokers}
            currentPrice={currentPrice}
            hoveredBroker={hoveredBroker}
            currency={currency}
            onHoverChange={setHoveredBroker}
            language={language}
          />
        </div>
      )}
    </section>
  );
}
