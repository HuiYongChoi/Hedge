import {
  dedupeEvidenceItemsAcrossReport,
  dedupeRepeatedClaimSentences,
  dedupePerGapComparisons,
  dedupeSentencesAcrossSections,
  extractReasoningText,
  normalizeAgentReport,
  parseEvidenceItems,
  sanitizeForwardPeNarrative,
} from './helpers';
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

  // 목차 간 중복 문장 제거: 섹션 순서대로 지문을 누적해 뒤 목차의 반복 서술을 걷어낸다.
  // 이어서, 선행/TTM PER 격차 비교처럼 여러 섹션에 재서술되는 근거는 가장 상세한 하나만 남긴다.
  const dedupedSectionTexts = dedupePerGapComparisons(dedupeSentencesAcrossSections(
    sections.map(section => sanitizeForwardPeNarrative(
      sectionText(normalizedReport, section.id) || fallbackSectionText(activeReport, normalizedReport, section.id),
      canonicalForwardSnapshot,
      language,
    )),
  ));

  // 카드를 여기서 한 번에 만들고 보고서 전체에서 되풀이되는 것을 걷어낸다.
  // 섹션마다 따로 파싱하면 같은 카드가 여러 섹션에 남는다(실측: 이행도 점검 카드).
  const itemsBySection = dedupeRepeatedClaimSentences(dedupeEvidenceItemsAcrossReport(
    // 크로스체크 가이드는 '다음에 무엇을 볼지' 안내가 본래 내용이므로
    // 지시문 필터를 적용하지 않는다. 적용하면 그 섹션이 통째로 비었다(실측).
    dedupedSectionTexts.map((text, index) => parseEvidenceItems(text, {
      allowDirectives: sections[index]?.id === 'section-05',
    })),
  ));

  return (
    <main className={`min-w-0 flex-1 space-y-6 ${className}`}>
      {sections.map((section, sectionIndex) => (
        <ReportSection
          key={section.id}
          section={section}
          sectionText={dedupedSectionTexts[sectionIndex]}
          items={itemsBySection[sectionIndex]}
          ticker={ticker}
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
