import type { Citation, ReportLanguage, ReportTone, SectionId } from './types';
import { annotateTextWithCitations, splitTextIntoDataTokenParts, toneToClasses } from './helpers';
import { CitationChip, findCitation } from './citation-chip';
import { normalizeFinancialDisplayText } from '@/lib/financial-text-normalizer';

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
  inlineCitations?: boolean;
  language: ReportLanguage;
  onCitationHover?: (letter: string | null) => void;
  onCitationClick?: (citation: Citation) => void;
}

function TokenizedSegment({ segment, tone }: { segment: string; tone: ReportTone }) {
  return (
    <>
      {splitTextIntoDataTokenParts(segment).map((part, index) => (
        part.kind === 'token'
          ? <InlineDataChip key={`${part.value}-${index}`} value={part.value} tone={part.tone || tone} />
          : <span key={`${part.value}-${index}`}>{part.value}</span>
      ))}
    </>
  );
}

// 모델 출력의 **볼드** 마크다운을 실제 볼드로 렌더링한다(리터럴 ** 노출 방지).
// 짝이 없는 잔여 ** 는 제거해 화면에 남지 않게 한다.
function TokenizedSentence({ sentence, tone }: { sentence: string; tone: ReportTone }) {
  const segments = sentence.split(/\*\*([^*]+)\*\*/g);
  return (
    <>
      {segments.map((segment, index) => {
        const cleaned = index % 2 === 1 ? segment : segment.replace(/\*\*/g, '');
        if (!cleaned) return null;
        return index % 2 === 1
          ? (
            <strong key={`bold-${index}`} className="font-semibold text-foreground">
              <TokenizedSegment segment={cleaned} tone={tone} />
            </strong>
          )
          : <TokenizedSegment key={`plain-${index}`} segment={cleaned} tone={tone} />;
      })}
    </>
  );
}

export function TextWithDataChips({
  text,
  tone,
  sectionId,
  citations = [],
  inlineCitations = true,
  language,
  onCitationHover,
  onCitationClick,
}: TextWithDataChipsProps) {
  void language;
  const normalizedText = normalizeFinancialDisplayText(text);
  if (!sectionId || !inlineCitations) return <TokenizedSentence sentence={normalizedText} tone={tone} />;

  const annotated = annotateTextWithCitations(normalizedText, sectionId);
  if (annotated.length === 0) return <TokenizedSentence sentence={normalizedText} tone={tone} />;

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
