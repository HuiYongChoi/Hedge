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
import type { CSSProperties } from 'react';
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

const readableTextStyle: CSSProperties = {
  wordBreak: 'keep-all',
  overflowWrap: 'break-word',
};

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
  return /^(?:\d+[.)]?\s*)+$|^[.)[\]+~?\-–—·•]+$/u.test(clean)
    // 단위만 붙은 숫자 조각("2.0%/d.", "0%/d.")도 문장이 아니다 — 값은 핵심 숫자 스트립이 담당
    || /^[\d.,]+\s?(?:%|배|x|X|bp|bps)?(?:\/[a-zA-Z]+)?\.?$/u.test(clean);
}

const HEADING_ONLY_BODY_PATTERNS = [
  /^핵심\s*(판단|가치|결론|수치|숫자|타겟\s*데이터)$/u,
  /^결론(?:\s*요약)?$/u,
  /^포워드\s*아웃룩(?:\s*\([^)]*\))?$/iu,
  /^forward\s*outlook(?:\s*\([^)]*\))?$/iu,
  /^상대가치\s*sanity\s*check$/iu,
  /^sanity\s*check$/iu,
  /^원문\s*(?:대조\s*)?체크리스트$/u,
  /^원문\s*추적\s*섹션$/u,
  /^경영진\s*멘트\s*검증$/u,
  /^불확실성의\s*핵심$/u,
  /^제\s*가치\s*\([^)]*\)\s*와\s*해석$/u,
];

const HEADING_ONLY_BODY_LABELS = new Set([
  '핵심 판단',
  '핵심판단',
  '핵심 가치',
  '핵심가치',
  '핵심 결론',
  '핵심결론',
  '핵심 수치',
  '핵심수치',
  '핵심 숫자',
  '핵심숫자',
  '핵심 타겟 데이터',
  '핵심타겟데이터',
  '결론',
  '결론 요약',
  '포워드 아웃룩',
  '포워드아웃룩',
  '상대가치 sanity check',
  'sanity check',
  '원문 대조 체크리스트',
  '원문대조체크리스트',
  '원문 체크리스트',
  '원문체크리스트',
  '원문 추적 섹션',
  '원문추적섹션',
  '경영진 멘트 검증',
  '경영진멘트검증',
  '불확실성의 핵심',
  '불확실성의핵심',
]);

function isHeadingOnlyBodyBlock(block: string) {
  const clean = block
    .replace(/^\s*\[[+\-~?]\]\s*/u, '')
    .replace(/\*\*/g, '')
    .replace(/[:：.!?。？！]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return false;
  if (HEADING_ONLY_BODY_LABELS.has(clean)) return true;
  if (HEADING_ONLY_BODY_PATTERNS.some(pattern => pattern.test(clean))) return true;
  // \uC885\uACB0\uBD80\uD638\uB85C \uB05D\uB098\uB294 \uC9E7\uC740 \uBB38\uC7A5(\uC608: "\uB530\uB77C\uC11C \uC911\uB9BD.")\uC740 \uB77C\uBCA8\uC774 \uC544\uB2C8\uB77C \uBCF8\uBB38 \uBB38\uC7A5\uC774\uBBC0\uB85C
  // \uAE38\uC774 \uAE30\uBC18 heading-only \uD310\uC815\uC5D0\uC11C \uC81C\uC678\uD55C\uB2E4 \u2014 \uC720\uD6A8 \uBCF8\uBB38\uC774 \uD1B5\uC9F8\uB85C \uD544\uD130\uB9C1\uB3FC
  // fallback\uC774 \uC6D0\uBCF8("- \u00B7 \uB530\uB77C\uC11C \uC911\uB9BD. 2.")\uC744 \uADF8\uB300\uB85C \uB178\uCD9C\uD558\uB358 \uBB38\uC81C \uBC29\uC9C0.
  if (/[.!?\u3002\uFF1F\uFF01]\s*$/u.test(block.trim())) return false;
  return clean.length <= 24
    && /[\uAC00-\uD7A3]/u.test(clean)
    && !/[.!?。？！\d%$₩¥]/u.test(clean)
    && !/(다|요|임|함|됨|한다|했다|된다|이다|입니다|합니다|있습니다|없습니다|보입니다|낮습니다|높습니다)$/u.test(clean);
}

function splitEvidenceBodyBlocks(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    // [?](검증 조건)는 부모 문장의 목록이므로 새 블록으로 쪼개지 않고 '·' 목록으로 이어 붙인다.
    .replace(/\s*\[\?\]\s*/gu, ' · ')
    // "- [+] …" 하이픈 불릿 뒤 마커는 하이픈까지 삼켜 분리 (고아 "-" 블록 방지)
    .replace(/(?:\s+[-*•])?\s+(?=(?:\d+[.)]\s+)?\[[+\-~]\])/gu, '\n\n')
    .split(/\n{2,}|\n(?=\s*(?:#{2,3}\s+|\d+[.)]|[-*•]\s+|\[[+\-~]\]))/u)
    .map(block => block
      // 선두 목록 번호 제거 — "2.0%/d"의 "2."(소수점)는 번호가 아니므로 (?!\d) 가드
      .replace(/^\s*(?:#{2,3}\s+|[-*•]\s+|\d+\.(?!\d)\s*|\d+\)\s*|\[[+\-~?]\]\s*)/u, '')
      .replace(/^\s*·\s*/u, '')
      .replace(/\s+/g, ' ')
      // 완결 문장 뒤에 매달린 목록 번호 조각(" 2." 등, 다음 항목 enumerator 누출) 제거.
      // 종결부호 뒤 1~2자리 숫자여야만 잡아 실제 수치(예: "목표가 100.")는 보존.
      .replace(/(?<=[.!?。？！])\s+\d{1,2}[.)]\s*$/u, '')
      .trim())
    .filter(block => Boolean(block) && !isMarkerOnlyBodyBlock(block) && !isHeadingOnlyBodyBlock(block))
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
  const fallbackBodyBlocks = [item.body.trim()].filter(block => (
    Boolean(block) && !isMarkerOnlyBodyBlock(block) && !isHeadingOnlyBodyBlock(block)
  ));
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
              <h4 className="text-sm font-semibold text-foreground" style={readableTextStyle}>{item.heading}</h4>
            )}
          </div>
          <div className="space-y-2.5 text-sm leading-7 text-foreground/90" style={readableTextStyle}>
            {visibleBodyBlocks.map((block, blockIndex) => (
              <p key={`${item.id}-body-${blockIndex}`} className="leading-7" style={readableTextStyle}>
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
