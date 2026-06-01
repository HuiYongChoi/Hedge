import { Button } from '@/components/ui/button';
import { useToastManager } from '@/hooks/use-toast-manager';
import {
  ensureParagraphBreaks,
  formatDecisionReasoning,
  renderMarkdownBlocks,
} from '@/lib/markdown-blocks';
import { t } from '@/lib/language-preferences';
import { analystTargetService } from '@/services/analyst-target-service';
import type { AnalystTarget } from '@/services/analyst-target-service';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  SECTION_DEFS,
  buildCanonicalMetrics,
  buildCitations,
  buildValuationDeepDive,
  calcMarginOfSafety,
  chooseIntrinsicReferencePrice,
  extractMetricValue,
  extractReasoningMetricValue,
  extractTargetTiles,
  extractValuationHeadlinePerShare,
  findFirstRenderableAgentKey,
  getAgentMeta,
  getAgentReport,
  getDetailReportMarkdown,
  getDisplayTickerLabel,
  isJapaneseTicker,
  isKoreanTicker,
  listOtherAgents,
  pickDefaultAgent,
  resolveMarginOfSafetySnapshot,
} from './helpers';
import { PriceCompassPanel } from './price-compass-panel';
import { ReportBody } from './report-body';
import { ReportHeaderRibbon } from './report-header-ribbon';
import { MobileToc, ReportTocSidebar } from './report-toc-sidebar';
import { StickyAnalysisHeader } from './sticky-analysis-header';
import { TargetDataSidebar } from './target-data-sidebar';
import type { AgentMeta, AnalystReportDashboardProps, CanonicalMetric, Citation, SectionId } from './types';

interface DetailReportState {
  agentName: string;
  markdown: string;
}

function DetailReportModal({
  detail,
  language,
  onClose,
}: {
  detail: DetailReportState;
  language: AnalystReportDashboardProps['language'];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-0 backdrop-blur-sm lg:items-center lg:p-4">
      <div className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-xl lg:max-w-4xl lg:rounded-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{detail.agentName}</h3>
            <p className="text-xs text-muted-foreground">
              {language === 'ko' ? '원문 대조 리포트' : 'Source comparison report'}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-11 w-11" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="overflow-y-auto p-4">
          {renderMarkdownBlocks(ensureParagraphBreaks(formatDecisionReasoning(detail.markdown)))}
        </div>
      </div>
    </div>
  );
}

function TickerSwitcher({
  tickers,
  activeTicker,
  language,
  onChange,
}: {
  tickers: string[];
  activeTicker: string;
  language: AnalystReportDashboardProps['language'];
  onChange: (ticker: string) => void;
}) {
  if (tickers.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-background/80 p-1 shadow-sm">
      <span className="px-3 text-xs font-medium text-muted-foreground">
        {t('tickerSwitcherLabel', language)}
      </span>
      {tickers.map(option => {
        const active = option === activeTicker;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`min-h-[44px] rounded-full px-4 py-2 font-mono text-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function resolveTickers(ticker: string, completeResult: AnalystReportDashboardProps['completeResult']) {
  const decisionTickers = Object.keys(completeResult.decisions ?? {}).map(key => key.trim()).filter(Boolean);
  if (decisionTickers.length > 0) return decisionTickers;
  return [ticker].filter(Boolean);
}

function marketDataMetric(value: number, fallback?: CanonicalMetric): CanonicalMetric {
  return {
    value,
    sourceAgentKey: fallback?.sourceAgentKey ?? 'market_data',
    sourceAgentNameKo: fallback?.sourceAgentNameKo ?? '시장 데이터',
    sourceAgentNameEn: fallback?.sourceAgentNameEn ?? 'Market Data',
    isFromActiveAgent: fallback?.isFromActiveAgent ?? false,
  };
}

function countryFromTicker(ticker: string) {
  if (isKoreanTicker(ticker)) return 'KR';
  if (isJapaneseTicker(ticker)) return 'JP';
  return 'US';
}

function stickyVerdictFromSignal(signal: unknown): 'buy' | 'sell' | 'hold' | 'on_hold' {
  const normalized = String(signal ?? '').toLowerCase();
  if (['bullish', 'buy', 'long'].includes(normalized)) return 'buy';
  if (['bearish', 'sell', 'short'].includes(normalized)) return 'sell';
  if (['neutral', 'hold'].includes(normalized)) return 'hold';
  return 'on_hold';
}

function numericConfidence(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ReportLayout({
  ticker,
  completeResult,
  agentResults,
  language,
  compositeScore,
  analysisGeneratedAt,
  onSave,
  isSaving,
}: AnalystReportDashboardProps) {
  const tickers = useMemo(() => resolveTickers(ticker, completeResult), [ticker, completeResult]);
  const [activeTicker, setActiveTicker] = useState(() => tickers[0] || ticker);
  const [activeAgentKey, setActiveAgentKey] = useState(() => pickDefaultAgent(agentResults, tickers[0] || ticker));
  const [activeSectionId, setActiveSectionId] = useState<SectionId>(SECTION_DEFS[0].id);
  const [activeCitationLetter, setActiveCitationLetter] = useState<string | null>(null);
  const [selectedDetailReport, setSelectedDetailReport] = useState<DetailReportState | null>(null);
  const [liveTarget, setLiveTarget] = useState<AnalystTarget | null>(null);
  const [marketDataUpdatedAt, setMarketDataUpdatedAt] = useState<string | null>(null);
  const [isRefreshingMarketData, setIsRefreshingMarketData] = useState(false);
  const [stickyHeaderHost, setStickyHeaderHost] = useState<HTMLElement | null>(null);
  const { info } = useToastManager();

  useEffect(() => {
    setStickyHeaderHost(document.getElementById('stock-analysis-sticky-summary-slot'));
  }, []);

  useEffect(() => {
    if (!tickers.includes(activeTicker)) {
      const nextTicker = tickers[0] || ticker;
      setActiveTicker(nextTicker);
      setActiveAgentKey(pickDefaultAgent(agentResults, nextTicker));
      setActiveSectionId(SECTION_DEFS[0].id);
      setSelectedDetailReport(null);
    }
  }, [activeTicker, agentResults, ticker, tickers]);

  useEffect(() => {
    if (!agentResults.has(activeAgentKey)) {
      setActiveAgentKey(pickDefaultAgent(agentResults, activeTicker));
    }
  }, [activeAgentKey, activeTicker, agentResults]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target?.id) setActiveSectionId(visible.target.id as SectionId);
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );

    SECTION_DEFS.forEach(section => {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [activeAgentKey, activeTicker]);

  const agentMetaMap = useMemo(() => {
    const map = new Map<string, AgentMeta>();
    agentResults.forEach((result, key) => map.set(key, getAgentMeta(key, result)));
    return map;
  }, [agentResults]);

  const activeAgentResult = agentResults.get(activeAgentKey);
  const activeReport = getAgentReport(
    completeResult.analyst_signals,
    activeAgentKey,
    activeTicker,
    activeAgentResult,
  );
  const displayAgentKey = findFirstRenderableAgentKey(
    completeResult,
    activeAgentKey,
    activeTicker,
    agentResults,
  );
  const displayAgentResult = agentResults.get(displayAgentKey);
  const displayAgent = agentMetaMap.get(displayAgentKey) || getAgentMeta(displayAgentKey, displayAgentResult);
  const displayReport = getAgentReport(
    completeResult.analyst_signals,
    displayAgentKey,
    activeTicker,
    displayAgentResult,
  ) || activeReport;

  useEffect(() => {
    if (displayAgentKey !== activeAgentKey) {
      setActiveAgentKey(displayAgentKey);
    }
  }, [activeAgentKey, displayAgentKey]);

  const citations = useMemo(() => buildCitations(activeTicker, isKoreanTicker(activeTicker), language), [activeTicker, language]);
  const canonicalMetrics = useMemo(
    () => buildCanonicalMetrics(displayAgentKey, completeResult, activeTicker),
    [activeTicker, completeResult, displayAgentKey],
  );
  const refreshMarketData = useCallback(async (forceRefresh = false) => {
    if (!activeTicker) return;
    setIsRefreshingMarketData(true);
    try {
      const target = await analystTargetService.fetch(activeTicker, { refresh: forceRefresh });
      if (target) {
        setLiveTarget(target);
        setMarketDataUpdatedAt(new Date().toISOString());
      }
    } finally {
      setIsRefreshingMarketData(false);
    }
  }, [activeTicker]);

  useEffect(() => {
    setLiveTarget(null);
    setMarketDataUpdatedAt(null);
    refreshMarketData(false);
  }, [refreshMarketData]);

  const reportCurrentPrice = canonicalMetrics.currentPrice?.value
    ?? completeResult.current_prices?.[activeTicker]
    ?? completeResult.current_prices?.[activeTicker.toUpperCase()]
    ?? extractMetricValue(displayReport, ['current_price', 'price', 'close_price', 'market_price']);
  const effectiveCurrentPrice = liveTarget?.current_price ?? reportCurrentPrice;
  const effectiveCurrency = liveTarget?.currency ?? (isKoreanTicker(activeTicker) ? 'KRW' : 'USD');
  const valuationReport = getAgentReport(
    completeResult.analyst_signals,
    'valuation_analyst',
    activeTicker,
    agentResults.get('valuation_analyst'),
  );
  // For the valuation_analyst report, anchor the headline 1주당 내재가치 to the
  // backend headline per-share. It tracks DCF normally but falls back to the
  // blended value when DCF is a low-confidence outlier, so the headline and
  // margin of safety stop being dominated by a model the signal already excludes.
  const dcfHeadlineIntrinsic = displayAgentKey === 'valuation_analyst'
    ? extractValuationHeadlinePerShare(valuationReport)
    : null;
  const reportPerShareIntrinsicValue = extractMetricValue(displayReport, [
    'intrinsic_value_per_share',
    'fair_value_per_share',
    'dcf_value_per_share',
    'per_share_intrinsic_value',
  ]) ?? extractReasoningMetricValue(displayReport, ['intrinsic_value', 'fair_value', 'dcf_value']);
  const reportedIntrinsicValue = canonicalMetrics.intrinsicValue?.value
    ?? extractMetricValue(displayReport, ['intrinsic_value', 'fair_value', 'dcf_value']);
  const intrinsicValue = chooseIntrinsicReferencePrice(
    [dcfHeadlineIntrinsic, reportPerShareIntrinsicValue, reportedIntrinsicValue],
    effectiveCurrentPrice,
  );
  const calculatedMarginOfSafety = calcMarginOfSafety(intrinsicValue, effectiveCurrentPrice);
  const reasoningMarginOfSafety = extractReasoningMetricValue(displayReport, ['margin_of_safety', 'safety_margin']);
  const reportedMarginOfSafety = canonicalMetrics.marginOfSafety?.value
    ?? extractMetricValue(displayReport, ['margin_of_safety']);
  const marginSnapshot = resolveMarginOfSafetySnapshot({
    currentPrice: effectiveCurrentPrice,
    intrinsicValue,
    reportedMargin: reportedMarginOfSafety,
    reasoningMargin: reasoningMarginOfSafety,
    calculatedMarginOfSafety,
  });
  const effectiveMarginOfSafety = marginSnapshot.margin;
  const displayTickerLabel = getDisplayTickerLabel(activeTicker, displayReport);
  const stickyCompanyName = displayTickerLabel && displayTickerLabel !== activeTicker ? displayTickerLabel : null;
  const stickyVerdict = stickyVerdictFromSignal(displayReport?.signal ?? completeResult.decisions?.[activeTicker]?.action);
  const stickyConfidence = numericConfidence(displayReport?.confidence ?? completeResult.decisions?.[activeTicker]?.confidence);
  const effectiveMetrics = useMemo(() => {
    const nextMetrics = { ...canonicalMetrics };
    if (effectiveCurrentPrice !== null) {
      nextMetrics.currentPrice = marketDataMetric(effectiveCurrentPrice, canonicalMetrics.currentPrice);
    }
    if (liveTarget?.forward_eps !== null && liveTarget?.forward_eps !== undefined && Number.isFinite(liveTarget.forward_eps)) {
      nextMetrics.forwardEpsTtm = marketDataMetric(liveTarget.forward_eps, canonicalMetrics.forwardEpsTtm);
    }
    if (liveTarget?.forward_pe !== null && liveTarget?.forward_pe !== undefined && Number.isFinite(liveTarget.forward_pe)) {
      nextMetrics.forwardPe = marketDataMetric(liveTarget.forward_pe, canonicalMetrics.forwardPe);
    }
    if (intrinsicValue !== null) {
      nextMetrics.intrinsicValue = marketDataMetric(intrinsicValue, canonicalMetrics.intrinsicValue);
    }
    if (effectiveMarginOfSafety !== null) {
      nextMetrics.marginOfSafety = marketDataMetric(
        effectiveMarginOfSafety,
        canonicalMetrics.intrinsicValue ?? canonicalMetrics.marginOfSafety,
      );
    }
    return nextMetrics;
  }, [canonicalMetrics, effectiveCurrentPrice, effectiveMarginOfSafety, intrinsicValue, liveTarget]);
  const canonicalForwardSnapshot = useMemo(() => {
    const currentPrice = effectiveCurrentPrice ?? null;
    const targetForwardEps = liveTarget?.forward_eps ?? null;
    const currentFyEps = liveTarget?.current_fy_eps ?? effectiveMetrics.forwardEpsFy0?.value ?? null;
    const forwardEps = targetForwardEps
      ?? effectiveMetrics.forwardEpsTtm?.value
      ?? effectiveMetrics.forwardEpsFy1?.value
      ?? null;
    const fwdPer = liveTarget?.forward_pe
      ?? (currentPrice !== null && forwardEps !== null && forwardEps > 0 ? currentPrice / forwardEps : null)
      ?? effectiveMetrics.forwardPe?.value
      ?? null;
    const currentFyPer = currentPrice !== null && currentFyEps !== null && currentFyEps > 0
      ? currentPrice / currentFyEps
      : effectiveMetrics.forwardPeFy0?.value ?? null;
    return {
      ttmPer: liveTarget?.trailing_pe ?? null,
      currentFyPer,
      fwdPer,
      fwdEps: forwardEps,
      currentFyEps,
    };
  }, [effectiveCurrentPrice, effectiveMetrics, liveTarget]);
  const brokerConsensus = useMemo(() => {
    const consensus = liveTarget?.consensus ?? liveTarget?.median ?? liveTarget?.distribution?.average ?? null;
    const brokerCount = liveTarget?.analyst_count
      ?? liveTarget?.brokers?.length
      ?? liveTarget?.distribution?.total
      ?? 0;
    return {
      consensus,
      brokerCount,
      forwardEps: canonicalForwardSnapshot.fwdEps ?? canonicalForwardSnapshot.currentFyEps ?? null,
      forwardPer: canonicalForwardSnapshot.fwdPer ?? null,
    };
  }, [canonicalForwardSnapshot, liveTarget]);
  const valuationDeepDive = useMemo(
    () => buildValuationDeepDive(valuationReport, effectiveCurrentPrice),
    [effectiveCurrentPrice, valuationReport],
  );
  const tiles = extractTargetTiles(effectiveMetrics, displayAgentKey, language, effectiveCurrency);
  const otherAgents = listOtherAgents(completeResult, displayAgentKey, activeTicker, agentMetaMap, language);

  const handleTickerChange = (nextTicker: string) => {
    if (nextTicker === activeTicker) return;
    setActiveTicker(nextTicker);
    setActiveAgentKey(pickDefaultAgent(agentResults, nextTicker));
    setActiveSectionId(SECTION_DEFS[0].id);
    setActiveCitationLetter(null);
    setSelectedDetailReport(null);
  };

  const handleCitationUnavailable = (message: string, toastId: string) => {
    info(message, toastId);
  };

  const handleCitationClick = (citation: Citation) => {
    if (citation.hrefAvailable && citation.href) {
      window.open(citation.href, '_blank', 'noopener,noreferrer');
      return;
    }
    handleCitationUnavailable(
      `${t('sourceLinkUnavailable', language)}: ${language === 'ko' ? citation.labelKo : citation.labelEn}`,
      `citation-${citation.letter}-unavailable`,
    );
  };

  const openDetailReport = () => {
    setSelectedDetailReport({
      agentName: displayAgent.name,
      markdown: getDetailReportMarkdown(displayReport, displayAgent, activeTicker),
    });
  };
  const stickyHeaderNode = (
    <StickyAnalysisHeader
      ticker={activeTicker}
      companyName={stickyCompanyName}
      country={countryFromTicker(activeTicker)}
      currentPrice={effectiveCurrentPrice}
      currency={effectiveCurrency}
      priceChangePct={null}
      verdict={stickyVerdict}
      verdictConfidence={stickyConfidence}
      marginOfSafetyPct={effectiveMarginOfSafety}
      wacc={effectiveMetrics.wacc?.value ?? null}
      language={language}
      placement={stickyHeaderHost ? 'tabHeader' : 'report'}
    />
  );

  return (
    <div id="analyst-report-root" className="space-y-4">
      {stickyHeaderHost ? createPortal(stickyHeaderNode, stickyHeaderHost) : stickyHeaderNode}

      <TickerSwitcher
        tickers={tickers}
        activeTicker={activeTicker}
        language={language}
        onChange={handleTickerChange}
      />

      <ReportHeaderRibbon
        ticker={activeTicker}
        displayTicker={displayTickerLabel}
        activeAgent={displayAgent}
        activeReport={displayReport}
        compositeScore={compositeScore}
        currentPrice={effectiveCurrentPrice}
        marginOfSafety={effectiveMarginOfSafety}
        marginReferencePrice={marginSnapshot.referencePrice}
        currency={effectiveCurrency}
        analysisGeneratedAt={analysisGeneratedAt}
        marketDataUpdatedAt={marketDataUpdatedAt}
        extendedPrice={liveTarget?.extended_price ?? null}
        extendedChangePercent={liveTarget?.extended_change_percent ?? null}
        extendedSession={liveTarget?.extended_session ?? null}
        language={language}
        onRefreshMarketData={() => refreshMarketData(true)}
        isRefreshingMarketData={isRefreshingMarketData}
        onCompareSourceClick={openDetailReport}
        onSave={onSave}
        isSaving={isSaving}
      />

      <PriceCompassPanel
        ticker={activeTicker}
        metrics={effectiveMetrics}
        language={language}
      />

      <div className="report-print-stack flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_280px] md:gap-5 lg:flex lg:flex-row lg:items-start lg:gap-6">
        <ReportTocSidebar
          sections={SECTION_DEFS}
          activeSectionId={activeSectionId}
          citations={citations}
          language={language}
          activeCitationLetter={activeCitationLetter}
          onCitationUnavailable={handleCitationUnavailable}
          className="hidden lg:block no-print"
        />
        <div className="min-w-0 flex-1 space-y-4">
          <MobileToc
            sections={SECTION_DEFS}
            activeSectionId={activeSectionId}
            citations={citations}
            language={language}
            activeCitationLetter={activeCitationLetter}
            onCitationUnavailable={handleCitationUnavailable}
            className="lg:hidden no-print"
          />
          <ReportBody
            sections={SECTION_DEFS}
            activeReport={displayReport}
            activeAgentKey={displayAgentKey}
            ticker={activeTicker}
            citations={citations}
            language={language}
            canonicalForwardSnapshot={canonicalForwardSnapshot}
            onCitationHover={setActiveCitationLetter}
            onCitationClick={handleCitationClick}
          />
        </div>
        <TargetDataSidebar
          tiles={tiles}
          otherAgents={otherAgents}
          language={language}
          onSwitchAgent={setActiveAgentKey}
          report={displayReport}
          valuationDeepDive={valuationDeepDive}
          currency={effectiveCurrency}
          brokerConsensus={brokerConsensus}
          currentPrice={effectiveCurrentPrice}
        />
      </div>

      {selectedDetailReport && (
        <DetailReportModal
          detail={selectedDetailReport}
          language={language}
          onClose={() => setSelectedDetailReport(null)}
        />
      )}
    </div>
  );
}
