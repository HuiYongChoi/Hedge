import { t } from '@/lib/language-preferences';
import { extractSensitivityMatrix, parseEvidenceItems, shouldShowSensitivity } from './helpers';
import { EvidenceItem } from './evidence-item';
import { SensitivityHeatmap } from './sensitivity-heatmap';
import { ValuationDeepDivePanel } from './valuation-panel';
import type { AgentReport, Citation, ReportLanguage, SectionDef, ValuationDeepDive } from './types';


interface ReportSectionProps {
  section: SectionDef;
  sectionText: string;
  activeReport: AgentReport | null;
  activeAgentKey: string;
  citations: Citation[];
  language: ReportLanguage;
  onCitationHover?: (letter: string | null) => void;
  onCitationClick?: (citation: Citation) => void;
  valuationDeepDive?: ValuationDeepDive | null;
  currentPrice?: number | null;
  currency?: string;
}

export function ReportSection({
  section,
  sectionText,
  activeReport,
  activeAgentKey,
  citations,
  language,
  onCitationHover,
  onCitationClick,
  valuationDeepDive = null,
  currentPrice = null,
  currency = 'USD',
}: ReportSectionProps) {
  const title = language === 'ko' ? section.titleKo : section.titleEn;
  const items = parseEvidenceItems(sectionText);
  const headingId = `${section.id}-heading`;
  const matrix = extractSensitivityMatrix(activeReport);
  const showSensitivity = section.id === 'section-02' && shouldShowSensitivity(activeAgentKey, matrix);
  const centerRow = matrix?.[Math.floor(matrix.length / 2)];
  const centerCell = centerRow?.[Math.floor(centerRow.length / 2)];
  const showDeepDive =
    section.id === 'section-02' &&
    valuationDeepDive !== null;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className="scroll-mt-24 rounded-xl border border-border/60 bg-background p-4 shadow-sm"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="font-mono text-2xl font-bold text-muted-foreground">{section.number}</span>
        <div>
          <h3 id={headingId} className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">
            {language === 'ko' ? '근거를 문단 단위로 나누고 숫자와 출처를 함께 표시합니다.' : 'Evidence is grouped by paragraph with key numbers and citations.'}
          </p>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="space-y-4">
          {items.map((item, index) => (
            <EvidenceItem
              key={item.id}
              item={item}
              index={index}
              sectionId={section.id}
              citations={citations}
              language={language}
              onCitationHover={onCitationHover}
              onCitationClick={onCitationClick}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-5 text-sm text-muted-foreground">
          {t('reportEmptySection', language)}
        </div>
      )}

      {showSensitivity && (
        <SensitivityHeatmap
          matrix={matrix}
          currentWacc={centerCell?.wacc ?? 0}
          currentGrowth={centerCell?.growth ?? 0}
          language={language}
        />
      )}
      {showDeepDive && valuationDeepDive && (
        <ValuationDeepDivePanel
          dive={valuationDeepDive}
          currentPrice={currentPrice}
          currency={currency}
          language={language}
        />
      )}
    </section>
  );
}
