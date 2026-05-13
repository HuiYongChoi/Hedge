import type { Citation, ReportLanguage, ReportTone, SectionId } from './types';
import { annotateTextWithCitations, splitTextIntoDataTokenParts, toneToClasses } from './helpers';
import { CitationChip, findCitation } from './citation-chip';

export function InlineDataChip({ value, tone }: { value: string; tone: ReportTone }) {
  const classes = toneToClasses(tone);
  return (
    <span className={`mx-0.5 inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold sm:text-[11px] ${classes.border} ${classes.bg} ${classes.text}`}>
      {value}
    </span>
  );
}

interface TextWithDataChipsProps {
  text: string;
  tone: ReportTone;
  sectionId?: SectionId;
  citations?: Citation[];
  language: ReportLanguage;
  onCitationHover?: (letter: string | null) => void;
  onCitationClick?: (citation: Citation) => void;
}

function TokenizedSentence({ sentence, tone }: { sentence: string; tone: ReportTone }) {
  return (
    <>
      {splitTextIntoDataTokenParts(sentence).map((part, index) => (
        part.kind === 'token'
          ? <InlineDataChip key={`${part.value}-${index}`} value={part.value} tone={part.tone || tone} />
          : <span key={`${part.value}-${index}`}>{part.value}</span>
      ))}
    </>
  );
}

export function TextWithDataChips({
  text,
  tone,
  sectionId,
  citations = [],
  language,
  onCitationHover,
  onCitationClick,
}: TextWithDataChipsProps) {
  void language;
  if (!sectionId) return <TokenizedSentence sentence={text} tone={tone} />;

  const annotated = annotateTextWithCitations(text, sectionId);
  if (annotated.length === 0) return <TokenizedSentence sentence={text} tone={tone} />;

  return (
    <>
      {annotated.map(({ sentence, inferences }, sentenceIndex) => (
        <span key={`${sentence}-${sentenceIndex}`}>
          <TokenizedSentence sentence={sentence} tone={tone} />
          {inferences.map(inference => {
            const citation = findCitation(citations, inference.letter);
            return (
              <CitationChip
                key={`${sentenceIndex}-${inference.letter}`}
                letter={inference.letter}
                label={citation?.label}
                type={citation?.type}
                confidence={inference.confidence}
                hrefAvailable={citation?.hrefAvailable ?? false}
                onHover={onCitationHover}
                onClick={() => citation && onCitationClick?.(citation)}
              />
            );
          })}
          {sentenceIndex < annotated.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}
