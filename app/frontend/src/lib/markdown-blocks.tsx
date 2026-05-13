import {
  REPORT_TONE_STYLES,
  normalizeReportOrderedMarkers,
  parseReportSentimentMarker,
  sortReportSentimentLines,
  type ReportSentimentTone,
} from '@/components/reports/report-sentiment-dashboard';
import type { ReactNode } from 'react';

type SentimentTone = ReportSentimentTone;

const TONE_STYLES: Record<NonNullable<SentimentTone>, {
  border: string;
  bg: string;
  icon: string;
  iconClass: string;
}> = REPORT_TONE_STYLES;

export function normalizeCrossCheckGuideHeading(markdown: string) {
  return markdown.replace(
    /#{1,6}\s*🔍\s*(?:[^\n#]*?의\s*)?원문 대조 체크리스트/gu,
    '### 🔍 원문 대조 체크리스트',
  );
}

export function formatDecisionReasoning(value: unknown) {
  if (!value) return '';

  return normalizeCrossCheckGuideHeading(String(value))
    .replace(/\r\n?/g, '\n')
    .replace(/([^\n])\s*(###\s*🔍\s*원문 대조 체크리스트)/gu, '$1\n\n$2')
    .replace(/(###\s*🔍\s*원문 대조 체크리스트)\s*/gu, '$1\n\n')
    .replace(/\s*(\d+)[).]\s+\*\*(핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증):\*\*/gu, '\n$1. **$2:**')
    .replace(/\s*[-–]\s+\*\*(핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증):\*\*/gu, '\n- **$1:**')
    .replace(/\s+\*\*(핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증):\*\*/gu, '\n\n**$1:**')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ensureParagraphBreaks(markdown: string): string {
  return markdown
    .replace(/([.다])\s+(\[[+\-~?]\])/g, '$1\n\n$2')
    .replace(/([^\n])\n(#{2,3}\s)/g, '$1\n\n$2')
    .replace(/([^\n])\n(\d+[.)]\s|-\s|\*\s)/g, '$1\n\n$2');
}

export function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+?\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

export function renderTonedContent(text: string): ReactNode {
  const { tone, rest } = parseReportSentimentMarker(text);
  if (!tone) return renderInlineMarkdown(text);
  const style = TONE_STYLES[tone];
  return (
    <span className={`flex items-start gap-2 rounded-sm border-l-2 py-0.5 pl-2 ${style.border} ${style.bg}`}>
      <span className={`mt-0.5 flex-shrink-0 font-mono text-xs ${style.iconClass}`} aria-label={tone}>{style.icon}</span>
      <span className="min-w-0 flex-1">{renderInlineMarkdown(rest)}</span>
    </span>
  );
}

export function renderMarkdownBlocks(markdown: string): ReactNode {
  const elements: ReactNode[] = [];
  let orderedItems: string[] = [];
  let unorderedItems: string[] = [];

  const flushLists = () => {
    if (orderedItems.length > 0) {
      const items = orderedItems;
      orderedItems = [];
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-5 list-decimal space-y-3 pl-6">
          {items.map((item, index) => (
            <li key={index} className="pl-1 leading-relaxed text-zinc-300">
              {renderTonedContent(item)}
            </li>
          ))}
        </ol>,
      );
    }

    if (unorderedItems.length > 0) {
      const items = unorderedItems;
      unorderedItems = [];
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-5 list-disc space-y-2 pl-6">
          {items.map((item, index) => (
            <li key={index} className="pl-1 leading-relaxed text-zinc-300">
              {renderTonedContent(item)}
            </li>
          ))}
        </ul>,
      );
    }
  };

  normalizeReportOrderedMarkers(sortReportSentimentLines(markdown)).split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushLists();
      return;
    }

    if (trimmed.startsWith('### ')) {
      flushLists();
      elements.push(
        <h3 key={`h3-${index}`} className="mb-5 mt-1 text-xl font-semibold leading-relaxed text-foreground">
          {trimmed.replace(/^###\s+/, '')}
        </h3>,
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      flushLists();
      elements.push(
        <h2 key={`h2-${index}`} className="mb-5 mt-2 text-2xl font-semibold leading-relaxed text-foreground">
          {trimmed.replace(/^##\s+/, '')}
        </h2>,
      );
      return;
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (orderedMatch) {
      orderedItems.push(orderedMatch[1]);
      return;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      unorderedItems.push(unorderedMatch[1]);
      return;
    }

    flushLists();
    elements.push(
      <p key={`p-${index}`} className="my-4 whitespace-pre-wrap leading-relaxed text-zinc-300">
        {renderTonedContent(trimmed)}
      </p>,
    );
  });

  flushLists();
  return <>{elements}</>;
}
