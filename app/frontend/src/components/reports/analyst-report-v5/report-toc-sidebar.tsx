import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { t } from '@/lib/language-preferences';
import { PeriodicFilingsPanel } from './periodic-filings-panel';
import type { Citation, ReportLanguage, SectionDef } from './types';

interface ReportTocSidebarProps {
  sections: SectionDef[];
  activeSectionId: string;
  citations: Citation[];
  /** 사업보고서 메뉴가 최근 1년 정기공시를 받아올 종목 */
  ticker: string;
  language: ReportLanguage;
  activeCitationLetter?: string | null;
  onCitationUnavailable?: (message: string, toastId: string) => void;
  className?: string;
}

/** 사이드바를 감싼 스크롤 컨테이너를 찾는다. */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * sticky 사이드바가 실제로 쓸 수 있는 높이.
 *
 * 리포트는 화면(window)이 아니라 앱 안쪽의 `overflow-y-auto` 영역에서 스크롤된다.
 * 그 영역의 보이는 높이는 화면 높이보다 한참 작다 — 위쪽을 탭 바·종목 리본이
 * 차지하기 때문이다. 그래서 높이를 100vh 기준으로 잡으면 sticky 로 고정된
 * 사이드바의 아래쪽이 화면 밖으로 밀려, 마지막 카드(사업보고서)에는 어떻게
 * 스크롤해도 닿을 수 없다. 실제 스크롤 영역의 높이를 재서 그만큼만 차지하게 한다.
 */
function useScrollAreaHeight(
  ref: RefObject<HTMLElement>,
  gapPx: number,
): number | null {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const scroller = findScrollParent(element);
    const measure = () => {
      const visible = scroller ? scroller.clientHeight : window.innerHeight;
      if (visible > 0) setMaxHeight(Math.max(200, visible - gapPx));
    };

    measure();
    // 탭이 막 열려 컨테이너 높이가 아직 0 인 순간에 잡히면 값이 그대로 굳는다.
    // 다음 프레임에 한 번 더 잰다.
    const raf = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller ?? document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, gapPx]);

  return maxHeight;
}

function citationLabel(citation: Citation, language: ReportLanguage) {
  return language === 'ko'
    ? citation.labelKo || citation.label
    : citation.labelEn || citation.label;
}

function citationType(citation: Citation, language: ReportLanguage) {
  return language === 'ko'
    ? citation.typeKo || citation.type
    : citation.typeEn || citation.type;
}

function scrollToSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openCitation(
  citation: Citation,
  language: ReportLanguage,
  onCitationUnavailable?: (message: string, toastId: string) => void,
) {
  if (citation.hrefAvailable && citation.href) {
    window.open(citation.href, '_blank', 'noopener,noreferrer');
    return;
  }

  onCitationUnavailable?.(
    `${t('sourceLinkUnavailable', language)}: ${citationLabel(citation, language)}`,
    `citation-${citation.letter}-unavailable`,
  );
}

function SourceButton({
  citation,
  active,
  language,
  onCitationUnavailable,
}: {
  citation: Citation;
  active: boolean;
  language: ReportLanguage;
  onCitationUnavailable?: (message: string, toastId: string) => void;
}) {
  return (
    <button
      type="button"
      data-citation-letter={citation.letter}
      data-citation-active={active ? 'true' : undefined}
      onClick={() => openCitation(citation, language, onCitationUnavailable)}
      className={`flex min-h-[44px] w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition-colors ${
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/30 hover:text-foreground'
      }`}
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-bold text-foreground">
        {citation.letter}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{citationLabel(citation, language)}</span>
        <span className="font-mono text-[10px] uppercase">{citationType(citation, language)}</span>
      </span>
    </button>
  );
}

export function ReportTocSidebar({
  sections,
  activeSectionId,
  citations,
  ticker,
  language,
  activeCitationLetter,
  onCitationUnavailable,
  className = '',
}: ReportTocSidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  // 컨테이너 패딩 16px + sticky top-4 16px + 아래 숨 쉴 틈 16px.
  const maxHeight = useScrollAreaHeight(asideRef, 48);

  return (
    <aside
      ref={asideRef}
      style={maxHeight != null ? { maxHeight: `${maxHeight}px` } : undefined}
      className={`sticky top-4 w-[200px] flex-shrink-0 self-start overflow-y-auto max-h-[calc(100vh-6rem)] ${className}`}
    >
      <div className="rounded-xl border border-border/60 bg-background p-3 shadow-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('reportTocTitle', language)}
        </h3>
        <nav className="space-y-1">
          {sections.map(section => {
            const active = section.id === activeSectionId;
            const title = language === 'ko' ? section.titleKo : section.titleEn;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? 'location' : undefined}
                onClick={() => scrollToSection(section.id)}
                className={`flex min-h-[44px] w-full items-center gap-2 rounded-md border-l-2 px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? 'border-primary bg-muted/30 font-medium text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                }`}
              >
                <span className="font-mono text-xs">{section.number}</span>
                <span className="line-clamp-2">{title}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-3 rounded-xl border border-border/60 bg-background p-3 shadow-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('reportSourcesTitle', language)}
        </h3>
        <div className="space-y-1.5">
          {citations.map(citation => (
            <SourceButton
              key={citation.letter}
              citation={citation}
              active={citation.letter === activeCitationLetter}
              language={language}
              onCitationUnavailable={onCitationUnavailable}
            />
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          {t('citationAutoNote', language)}
        </p>
      </div>

      <PeriodicFilingsPanel ticker={ticker} language={language} className="mt-3" />
    </aside>
  );
}

export function MobileToc({
  sections,
  activeSectionId,
  citations,
  ticker,
  language,
  activeCitationLetter,
  onCitationUnavailable,
  className = '',
}: ReportTocSidebarProps) {
  return (
    <div className={`lg:hidden ${className}`}>
      <div className="rounded-xl border border-border/60 bg-background p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('mobileTocLabel', language)}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {t('citationAutoNote', language)}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sections.map(section => {
            const active = section.id === activeSectionId;
            const title = language === 'ko' ? section.titleKo : section.titleEn;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? 'location' : undefined}
                onClick={() => scrollToSection(section.id)}
                className={`flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border/60 bg-muted/20 text-muted-foreground'
                }`}
              >
                <span className="font-mono">{section.number}</span>
                <span>{title}</span>
              </button>
            );
          })}
        </div>
        {citations.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {citations.map(citation => (
              <button
                key={citation.letter}
                type="button"
                data-citation-letter={citation.letter}
                onClick={() => openCitation(citation, language, onCitationUnavailable)}
                className={`flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-full border px-3 text-xs ${
                  citation.letter === activeCitationLetter
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground'
                }`}
              >
                <span className="font-mono font-bold">{citation.letter}</span>
                <span>{citationLabel(citation, language)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <PeriodicFilingsPanel ticker={ticker} language={language} className="mt-3" />
    </div>
  );
}
