import { normalizeAgentReport } from './helpers';
import { ReportSection } from './report-section';
import type { AgentReport, Citation, NormalizedReport, ReportLanguage, SectionDef, SectionId, ValuationDeepDive } from './types';

interface ReportBodyProps {
  sections: SectionDef[];
  activeReport: AgentReport | null;
  activeAgentKey: string;
  ticker: string;
  citations: Citation[];
  language: ReportLanguage;
  className?: string;
  onCitationHover?: (letter: string | null) => void;
  onCitationClick?: (citation: Citation) => void;
  valuationDeepDive?: ValuationDeepDive | null;
  currentPrice?: number | null;
  currency?: string;
}

function sectionText(report: NormalizedReport, sectionId: SectionId) {
  if (sectionId === 'section-01') return report.conclusion;
  if (sectionId === 'section-02') return report.valuationDcf;
  if (sectionId === 'section-03') return report.multiples;
  if (sectionId === 'section-04') return report.risks;
  if (sectionId === 'section-05') return report.crossCheck;
  return report.sources;
}

export function ReportBody({
  sections,
  activeReport,
  activeAgentKey,
  ticker,
  citations,
  language,
  className = '',
  onCitationHover,
  onCitationClick,
  valuationDeepDive = null,
  currentPrice = null,
  currency = 'USD',
}: ReportBodyProps) {
  const normalizedReport = normalizeAgentReport(activeReport, ticker, language);

  return (
    <main className={`min-w-0 flex-1 space-y-6 ${className}`}>
      {sections.map(section => (
        <ReportSection
          key={section.id}
          section={section}
          sectionText={sectionText(normalizedReport, section.id)}
          activeReport={activeReport}
          activeAgentKey={activeAgentKey}
          citations={citations}
          language={language}
          onCitationHover={onCitationHover}
          onCitationClick={onCitationClick}
          valuationDeepDive={valuationDeepDive}
          currentPrice={currentPrice}
          currency={currency}
        />
      ))}
    </main>
  );
}
