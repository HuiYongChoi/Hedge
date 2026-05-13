import { t } from '@/lib/language-preferences';
import type { Citation, ReportLanguage, SectionDef } from './types';

interface ReportTocSidebarProps {
  sections: SectionDef[];
  activeSectionId: string;
  citations: Citation[];
  language: ReportLanguage;
  activeCitationLetter?: string | null;
  onCitationUnavailable?: (message: string, toastId: string) => void;
  className?: string;
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
  language,
  activeCitationLetter,
  onCitationUnavailable,
  className = '',
}: ReportTocSidebarProps) {
  return (
    <aside className={`sticky top-4 w-[200px] flex-shrink-0 self-start overflow-y-auto max-h-[calc(100vh-6rem)] ${className}`}>
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
    </aside>
  );
}

export function MobileToc({
  sections,
  activeSectionId,
  citations,
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
    </div>
  );
}
