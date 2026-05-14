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

  const trailingPe = target?.trailing_pe ?? metrics.forwardPe?.value ?? null;
  const trailingEps = target?.trailing_eps ?? null;

  const consensus = target?.consensus ?? null;
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
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{t('pcpSubtitle', language)}</span>
          </div>
          {(beta != null || brokers.length > 0) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">{helpText}</p>
          )}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
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
        <p className="text-xs text-muted-foreground/60">{t('pcpNoBrokers', language)}</p>
      ) : (
        <BrokerCalloutsRow
          brokers={brokers}
          range={range}
          currentPrice={currentPrice}
          forwardEps={forwardEps}
          trailingPe={trailingPe}
          trailingEps={trailingEps}
          hoveredBroker={hoveredBroker}
          onHoverChange={setHoveredBroker}
          language={language}
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
            forwardEps={forwardEps}
            hoveredBroker={hoveredBroker}
            onHoverChange={setHoveredBroker}
            language={language}
          />
        </div>
      )}
    </section>
  );
}
