import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/language-preferences';
import {
  extractKeyNumbers,
  findDataTokenReferences,
  inferCitationLetters,
  toneToClasses,
} from './helpers';
import { CitationChip, findCitation } from './citation-chip';
import { KeyNumbersStrip } from './key-numbers-strip';
import { TextWithDataChips } from './inline-data-chip';
import type { Citation, EvidenceItem as EvidenceItemType, ReportLanguage, SectionId } from './types';

interface EvidenceItemProps {
  item: EvidenceItemType;
  index: number;
  sectionId: SectionId;
  citations: Citation[];
  language: ReportLanguage;
  onCitationHover?: (letter: string | null) => void;
  onCitationClick?: (citation: Citation) => void;
}

function toneLabel(tone: EvidenceItemType['tone'], language: ReportLanguage) {
  if (tone === 'bullish') return t('reportEvidenceBull', language);
  if (tone === 'bearish') return t('reportEvidenceBear', language);
  return t('reportEvidenceNeutral', language);
}

function ToneMark({ tone }: { tone: EvidenceItemType['tone'] }) {
  if (tone === 'bullish') return <span className="font-mono">✓</span>;
  if (tone === 'bearish') return <span className="font-mono">✕</span>;
  return <span className="font-mono">-</span>;
}

export function EvidenceItem({
  item,
  index,
  sectionId,
  citations,
  language,
  onCitationHover,
  onCitationClick,
}: EvidenceItemProps) {
  const classes = toneToClasses(item.tone);
  const citationLetters = item.citationLetters.length > 0
    ? item.citationLetters
    : inferCitationLetters(item.rawText, sectionId);
  const keyNumbers = extractKeyNumbers(item.rawText, language);

  return (
    <article className={`rounded-lg border ${classes.border} ${classes.bg} p-4`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border bg-background font-mono text-xs font-bold ${classes.border} ${classes.text}`}>
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`gap-1 px-2 py-0.5 text-[10px] font-semibold ${classes.badge}`} aria-label={toneLabel(item.tone, language)}>
              <ToneMark tone={item.tone} />
              {toneLabel(item.tone, language)}
            </Badge>
            {item.heading && (
              <h4 className="text-sm font-semibold text-foreground">{item.heading}</h4>
            )}
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            <TextWithDataChips
              text={item.body}
              tone={item.tone}
              sectionId={sectionId}
              citations={citations}
              language={language}
              onCitationHover={onCitationHover}
              onCitationClick={onCitationClick}
            />
          </p>
          <KeyNumbersStrip keyNumbers={keyNumbers} language={language} />
          {citationLetters.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">{t('reportSourcesLabel', language)}</span>
              {citationLetters.map(letter => {
                const source = findCitation(citations, letter);
                return (
                  <CitationChip
                    key={letter}
                    letter={letter}
                    label={source?.label}
                    type={source?.type}
                    size="md"
                    confidence="medium"
                    hrefAvailable={source?.hrefAvailable ?? false}
                    onHover={onCitationHover}
                    onClick={() => source && onCitationClick?.(source)}
                  />
                );
              })}
            </div>
          )}
          {findDataTokenReferences(item.rawText).length > 4 && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {language === 'ko' ? '핵심 숫자 4개만 강조 표시했습니다.' : 'Only the first four key numbers are highlighted.'}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
