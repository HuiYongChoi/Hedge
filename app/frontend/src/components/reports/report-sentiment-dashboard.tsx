import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type ReportSentimentTone = 'positive' | 'negative' | 'neutral' | 'unknown' | null;

export const REPORT_TONE_STYLES: Record<Exclude<ReportSentimentTone, null>, {
  border: string;
  bg: string;
  icon: string;
  iconClass: string;
}> = {
  positive: { border: 'border-l-green-500', bg: 'bg-green-500/5', icon: '✓', iconClass: 'text-green-500' },
  negative: { border: 'border-l-red-500', bg: 'bg-red-500/5', icon: '✗', iconClass: 'text-red-500' },
  neutral: { border: 'border-l-amber-500', bg: 'bg-amber-500/5', icon: '–', iconClass: 'text-amber-500' },
  unknown: { border: 'border-l-zinc-500', bg: 'bg-zinc-500/5', icon: '?', iconClass: 'text-zinc-400' },
};

const TONE_META: Array<{
  tone: Exclude<ReportSentimentTone, null>;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
}> = [
  {
    tone: 'positive',
    titleKo: '긍정 근거',
    titleEn: 'Positive evidence',
    summaryKo: '상승 요인과 강점',
    summaryEn: 'Upside drivers and strengths',
  },
  {
    tone: 'negative',
    titleKo: '부정 리스크',
    titleEn: 'Negative risks',
    summaryKo: '하방 요인과 경고',
    summaryEn: 'Downside drivers and warnings',
  },
  {
    tone: 'neutral',
    titleKo: '중립/보합',
    titleEn: 'Neutral / mixed',
    summaryKo: '상쇄되거나 조건부인 내용',
    summaryEn: 'Offsetting or conditional points',
  },
  {
    tone: 'unknown',
    titleKo: '데이터 공백',
    titleEn: 'Data gaps',
    summaryKo: '추가 확인이 필요한 부분',
    summaryEn: 'Items needing verification',
  },
];

function renderDefaultInlineMarkdown(text: string) {
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

export function parseReportSentimentMarker(text: string): { tone: ReportSentimentTone; rest: string } {
  const markerMatch = text.trim().match(/^\s*(?:[-*]\s+|\d+[.)]\s+)?(\[[+\-~?]\])\s*(.*)$/);
  if (!markerMatch) return { tone: null, rest: text };

  const marker = markerMatch[1];
  const rest = markerMatch[2] || '';
  if (marker === '[+]') return { tone: 'positive', rest };
  if (marker === '[-]') return { tone: 'negative', rest };
  if (marker === '[~]') return { tone: 'neutral', rest };
  if (marker === '[?]') return { tone: 'unknown', rest };
  return { tone: null, rest: text };
}

export function collectReportSentimentItems(markdown: string) {
  return markdown
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^#{1,6}\s+/.test(line))
    .map(line => parseReportSentimentMarker(line))
    .filter((item): item is { tone: Exclude<ReportSentimentTone, null>; rest: string } => (
      item.tone !== null && item.rest.trim().length > 0
    ));
}

export function renderReportTonedContent(
  text: string,
  renderInline: (value: string) => ReactNode = renderDefaultInlineMarkdown,
): ReactNode {
  const { tone, rest } = parseReportSentimentMarker(text);
  if (!tone) return renderInline(text);
  const style = REPORT_TONE_STYLES[tone];

  return (
    <span className={cn('flex items-start gap-2 rounded-sm border-l-2 py-0.5 pl-2', style.border, style.bg)}>
      <span className={cn('mt-0.5 flex-shrink-0 font-mono text-xs', style.iconClass)} aria-label={tone}>
        {style.icon}
      </span>
      <span className="min-w-0 flex-1">{renderInline(rest)}</span>
    </span>
  );
}

export function ReportToneLegend({ language }: { language: 'ko' | 'en' }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wider">
        {language === 'ko' ? '톤 표시' : 'Tone'}:
      </span>
      {TONE_META.map(({ tone, titleKo, titleEn }) => {
        const style = REPORT_TONE_STYLES[tone];
        return (
          <span key={tone} className="inline-flex items-center gap-1">
            <span className={cn('font-mono', style.iconClass)}>{style.icon}</span>
            {language === 'ko' ? titleKo : titleEn}
          </span>
        );
      })}
    </div>
  );
}

export function ReportSentimentDashboard({
  markdown,
  language,
  className,
  maxItemsPerTone = 3,
}: {
  markdown: string;
  language: 'ko' | 'en';
  className?: string;
  maxItemsPerTone?: number;
}) {
  const items = collectReportSentimentItems(markdown);
  if (items.length === 0) return null;

  return (
    <section className={cn('rounded-xl border border-border/70 bg-background/70 p-3 shadow-sm', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">
            {language === 'ko' ? '근거 대시보드' : 'Evidence dashboard'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {language === 'ko'
              ? '긍정/부정/중립 신호를 먼저 모아서 보여줍니다.'
              : 'Groups positive, negative, and neutral signals before the raw report.'}
          </p>
        </div>
        <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
          {language === 'ko' ? `${items.length}개 신호` : `${items.length} signals`}
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-4">
        {TONE_META.map(({ tone, titleKo, titleEn, summaryKo, summaryEn }) => {
          const toneItems = items.filter(item => item.tone === tone);
          const style = REPORT_TONE_STYLES[tone];

          return (
            <article key={tone} className={cn('rounded-lg border border-border/60 bg-muted/10 p-3', toneItems.length > 0 && style.bg)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn('font-mono text-sm', style.iconClass)}>{style.icon}</span>
                  <span className="text-xs font-semibold text-foreground">
                    {language === 'ko' ? titleKo : titleEn}
                  </span>
                </div>
                <span className="rounded-full bg-background/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {toneItems.length}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {language === 'ko' ? summaryKo : summaryEn}
              </p>
              {toneItems.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {toneItems.slice(0, maxItemsPerTone).map((item, index) => (
                    <li key={`${tone}-${index}`} className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {renderDefaultInlineMarkdown(item.rest)}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
