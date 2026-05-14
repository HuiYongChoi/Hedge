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
  language: ReportLanguage;
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
  language,
}: FundamentalsRowProps) {
  const chip = (label: string, value: string) => (
    <div className="flex items-baseline gap-1 rounded-md border border-border/40 bg-card/60 px-2 py-1">
      <span className="text-[11px] text-foreground/65">{label}</span>
      <span className="font-mono text-sm font-semibold text-white">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {trailingPe != null && chip(t('pcpPerTtm', language), `${trailingPe.toFixed(1)}×`)}
      {trailingEps != null && chip(t('pcpEpsTtm', language), `$${trailingEps.toFixed(2)}`)}
      {currentFyEps != null && chip(t('pcpEpsCurFy', language), `$${currentFyEps.toFixed(2)}`)}
      {forwardEps != null && chip(t('pcpFwdEps', language), `$${forwardEps.toFixed(2)}`)}
      {forwardPe != null && chip(t('pcpBrokerFwdPer', language), `${forwardPe.toFixed(1)}×`)}
      {currentPrice != null && chip(t('pcpLegendCurrent', language), `$${currentPrice.toFixed(2)}`)}
      {consensus != null && chip(t('pcpLegendConsensus', language), `$${consensus.toFixed(0)}`)}
      {highTarget != null && chip(t('pcpHighTarget', language), `$${highTarget.toFixed(0)}`)}
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
    metrics.forwardEpsFy0?.value ??
    metrics.forwardEpsTtm?.value ??
    target?.forward_eps ??
    null;

  const forwardPe = target?.forward_pe ?? metrics.forwardPe?.value ?? null;
  const trailingPe = target?.trailing_pe ?? null;
  const trailingEps = target?.trailing_eps ?? null;
  const currentFyEps = target?.current_fy_eps ?? null;

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
              language={language}
            />
            <OpinionDistribution
              distribution={distribution}
              currentPrice={currentPrice}
              language={language}
            />
          </div>

          {/* Broker detail grid */}
          <BrokerDetailGrid
            brokers={brokers}
            currentPrice={currentPrice}
            hoveredBroker={hoveredBroker}
            onHoverChange={setHoveredBroker}
            language={language}
          />
        </div>
      )}
    </section>
  );
}
