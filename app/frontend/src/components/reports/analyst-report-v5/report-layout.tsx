import { Button } from '@/components/ui/button';
import { useToastManager } from '@/hooks/use-toast-manager';
import {
  ensureParagraphBreaks,
  formatDecisionReasoning,
  renderMarkdownBlocks,
} from '@/lib/markdown-blocks';
import { t } from '@/lib/language-preferences';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  SECTION_DEFS,
  buildCanonicalMetrics,
  buildCitations,
  extractMetricValue,
  extractTargetTiles,
  getAgentMeta,
  getAgentReport,
  getDetailReportMarkdown,
  isKoreanTicker,
  listOtherAgents,
  pickDefaultAgent,
} from './helpers';
import { ReportBody } from './report-body';
import { ReportHeaderRibbon } from './report-header-ribbon';
import { MobileToc, ReportTocSidebar } from './report-toc-sidebar';
import { TargetDataSidebar } from './target-data-sidebar';
import type { AgentMeta, AnalystReportDashboardProps, Citation, SectionId } from './types';

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

export function ReportLayout({
  ticker,
  completeResult,
  agentResults,
  language,
  compositeScore,
  onSave,
  isSaving,
}: AnalystReportDashboardProps) {
  const tickers = useMemo(() => resolveTickers(ticker, completeResult), [ticker, completeResult]);
  const [activeTicker, setActiveTicker] = useState(() => tickers[0] || ticker);
  const [activeAgentKey, setActiveAgentKey] = useState(() => pickDefaultAgent(agentResults, tickers[0] || ticker));
  const [activeSectionId, setActiveSectionId] = useState<SectionId>(SECTION_DEFS[0].id);
  const [activeCitationLetter, setActiveCitationLetter] = useState<string | null>(null);
  const [selectedDetailReport, setSelectedDetailReport] = useState<DetailReportState | null>(null);
  const { info } = useToastManager();

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
  const activeAgent = agentMetaMap.get(activeAgentKey) || getAgentMeta(activeAgentKey, activeAgentResult);
  const activeReport = getAgentReport(
    completeResult.analyst_signals,
    activeAgentKey,
    activeTicker,
    activeAgentResult,
  );
  const citations = useMemo(() => buildCitations(activeTicker, isKoreanTicker(activeTicker), language), [activeTicker, language]);
  const canonicalMetrics = useMemo(
    () => buildCanonicalMetrics(activeAgentKey, completeResult, activeTicker),
    [activeAgentKey, activeTicker, completeResult],
  );
  const currentPrice = canonicalMetrics.currentPrice?.value
    ?? extractMetricValue(activeReport, ['current_price', 'price', 'close_price', 'market_price']);
  const marginOfSafety = canonicalMetrics.marginOfSafety?.value
    ?? extractMetricValue(activeReport, ['margin_of_safety']);
  const tiles = extractTargetTiles(canonicalMetrics, activeAgentKey, language);
  const otherAgents = listOtherAgents(completeResult, activeAgentKey, activeTicker, agentMetaMap, language);

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
      agentName: activeAgent.name,
      markdown: getDetailReportMarkdown(activeReport, activeAgent, activeTicker),
    });
  };

  return (
    <div className="space-y-4">
      <TickerSwitcher
        tickers={tickers}
        activeTicker={activeTicker}
        language={language}
        onChange={handleTickerChange}
      />

      <ReportHeaderRibbon
        ticker={activeTicker}
        activeAgent={activeAgent}
        activeReport={activeReport}
        compositeScore={compositeScore}
        currentPrice={currentPrice}
        marginOfSafety={marginOfSafety}
        language={language}
        onCompareSourceClick={openDetailReport}
        onSave={onSave}
        isSaving={isSaving}
      />

      <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_280px] md:gap-5 lg:flex lg:flex-row lg:items-start lg:gap-6">
        <ReportTocSidebar
          sections={SECTION_DEFS}
          activeSectionId={activeSectionId}
          citations={citations}
          language={language}
          activeCitationLetter={activeCitationLetter}
          onCitationUnavailable={handleCitationUnavailable}
          className="hidden lg:block"
        />
        <div className="min-w-0 flex-1 space-y-4">
          <MobileToc
            sections={SECTION_DEFS}
            activeSectionId={activeSectionId}
            citations={citations}
            language={language}
            activeCitationLetter={activeCitationLetter}
            onCitationUnavailable={handleCitationUnavailable}
            className="lg:hidden"
          />
          <ReportBody
            sections={SECTION_DEFS}
            activeReport={activeReport}
            activeAgentKey={activeAgentKey}
            ticker={activeTicker}
            citations={citations}
            language={language}
            onCitationHover={setActiveCitationLetter}
            onCitationClick={handleCitationClick}
          />
        </div>
        <TargetDataSidebar
          tiles={tiles}
          otherAgents={otherAgents}
          language={language}
          onSwitchAgent={setActiveAgentKey}
          report={activeReport}
          ticker={activeTicker}
          metrics={canonicalMetrics}
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
