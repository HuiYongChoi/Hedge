import { extractReasoningText, normalizeAgentReport, sanitizeForwardPeNarrative } from './helpers';
import { ReportSection } from './report-section';
import type { AgentReport, CanonicalForwardSnapshot, Citation, NormalizedReport, ReportLanguage, SectionDef, SectionId } from './types';

interface ReportBodyProps {
  sections: SectionDef[];
  activeReport: AgentReport | null;
  activeAgentKey: string;
  ticker: string;
  citations: Citation[];
  language: ReportLanguage;
  canonicalForwardSnapshot?: CanonicalForwardSnapshot | null;
  className?: string;
  onCitationHover?: (letter: string | null) => void;
  onCitationClick?: (citation: Citation) => void;
}

function sectionText(report: NormalizedReport, sectionId: SectionId) {
  if (sectionId === 'section-01') return report.conclusion;
  if (sectionId === 'section-02') return report.valuationDcf;
  if (sectionId === 'section-03') return report.multiples;
  if (sectionId === 'section-04') return report.risks;
  if (sectionId === 'section-05') return report.crossCheck;
  return report.sources;
}

function fallbackSectionText(report: AgentReport | null, normalizedReport: NormalizedReport, sectionId: SectionId) {
  const reasoning = extractReasoningText(report?.reasoning || report).trim();
  if (!reasoning) return '';
  if (sectionId === 'section-01') return normalizedReport.conclusion || reasoning;
  if (sectionId === 'section-05') return normalizedReport.crossCheck || normalizedReport.sources || reasoning;
  if (sectionId === 'section-06') return normalizedReport.sources || reasoning;
  return reasoning;
}

export function ReportBody({
  sections,
  activeReport,
  activeAgentKey,
  ticker,
  citations,
  language,
  canonicalForwardSnapshot,
  className = '',
  onCitationHover,
  onCitationClick,
}: ReportBodyProps) {
  const normalizedReport = normalizeAgentReport(activeReport, ticker, language);

  return (
    <main className={`min-w-0 flex-1 space-y-6 ${className}`}>
      {sections.map(section => (
        <ReportSection
          key={section.id}
          section={section}
          sectionText={sanitizeForwardPeNarrative(
            sectionText(normalizedReport, section.id) || fallbackSectionText(activeReport, normalizedReport, section.id),
            canonicalForwardSnapshot,
            language,
          )}
          activeReport={activeReport}
          activeAgentKey={activeAgentKey}
          citations={citations}
          language={language}
          onCitationHover={onCitationHover}
          onCitationClick={onCitationClick}
        />
      ))}
    </main>
  );
}
