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

function splitReadableChunk(block: string): string[] {
  if (block.length <= 460) return [block];

  const sentences = block.match(/[^.!?。？！]+[.!?。？！]?/gu) ?? [block];
  const chunks: string[] = [];
  let current = '';

  sentences.forEach(sentence => {
    const clean = sentence.trim();
    if (!clean) return;
    const next = current ? `${current} ${clean}` : clean;
    if (current && next.length > 380) {
      chunks.push(current);
      current = clean;
      return;
    }
    current = next;
  });

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [block];
}

function isMarkerOnlyBodyBlock(block: string) {
  const clean = block
    .replace(/^\s*\[[+\-~?]\]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:\d+[.)]?|[.)]+)$/u.test(clean);
}

function splitEvidenceBodyBlocks(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/\s+(?=(?:\d+[.)]\s+)?\[[+\-~?]\])/gu, '\n\n')
    .split(/\n{2,}|\n(?=\s*(?:#{2,3}\s+|\d+[.)]|[-*•]\s+|\[[+\-~?]\]))/u)
    .map(block => block
      .replace(/^\s*(?:#{2,3}\s+|[-*•]\s+|\d+[.)]\s*|\[[+\-~?]\]\s*)/u, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(block => Boolean(block) && !isMarkerOnlyBodyBlock(block))
    .flatMap(splitReadableChunk);
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
  const bodyBlocks = splitEvidenceBodyBlocks(item.body);
  const fallbackBodyBlocks = [item.body.trim()].filter(block => Boolean(block) && !isMarkerOnlyBodyBlock(block));
  const visibleBodyBlocks = bodyBlocks.length > 0 ? bodyBlocks : fallbackBodyBlocks;

  return (
    <article className={`rounded-lg border ${classes.border} ${classes.bg} p-4 sm:p-5`}>
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
          <div className="space-y-2.5 text-sm leading-7 text-foreground/90">
            {visibleBodyBlocks.map((block, blockIndex) => (
              <p key={`${item.id}-body-${blockIndex}`} className="leading-7">
                <TextWithDataChips
                  text={block}
                  tone={item.tone}
                  sectionId={sectionId}
                  citations={citations}
                  inlineCitations={false}
                  language={language}
                  onCitationHover={onCitationHover}
                  onCitationClick={onCitationClick}
                />
              </p>
            ))}
          </div>
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
