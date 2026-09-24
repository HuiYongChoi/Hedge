import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, FileText } from 'lucide-react';
import { t } from '@/lib/language-preferences';
import { periodicFilingService } from '@/services/periodic-filing-service';
import type { PeriodicFiling, PeriodicFilingList } from '@/services/periodic-filing-service';
import type { ReportLanguage } from './types';

interface PeriodicFilingsPanelProps {
  ticker: string;
  language: ReportLanguage;
  /** 목록에 담을 기간(개월). 기본 최근 1년. */
  months?: number;
  className?: string;
}

/** 접히는 섹션 하나 — 사업보고서 / 분기·반기보고서 */
function FilingSection({
  title,
  description,
  filings,
  emptyLabel,
  defaultOpen,
}: {
  title: string;
  description: string;
  filings: PeriodicFiling[];
  emptyLabel: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-border/50 bg-muted/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-foreground">
            {title}
            <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
              {filings.length}
            </span>
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            {description}
          </span>
        </span>
        <ChevronDown
          className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-1 px-2 pb-2">
          {filings.length === 0 ? (
            <p className="px-0.5 text-[10px] text-muted-foreground">{emptyLabel}</p>
          ) : (
            filings.map(filing => (
              <a
                key={filing.id}
                href={filing.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1.5 text-left transition-colors hover:border-border/60 hover:bg-muted/30"
              >
                <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-foreground">
                    {filing.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{filing.date}</span>
                </span>
                <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              </a>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 사이드바 '출처' 아래에 붙는 사업보고서 메뉴.
 * 최근 1년의 정기공시(연간/분기)를 두 섹션으로 나눠 접었다 펼 수 있게 한다.
 * 링크는 원문(DART 뷰어 / SEC EDGAR)으로 바로 나간다.
 */
export function PeriodicFilingsPanel({
  ticker,
  language,
  months = 12,
  className = '',
}: PeriodicFilingsPanelProps) {
  const [listing, setListing] = useState<PeriodicFilingList | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setLoaded(false);
    periodicFilingService.fetch(ticker, months).then(r => {
      if (cancelled) return;
      setListing(r);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [ticker, months]);

  // 아직 로딩 중이거나, 이 시장에 목록 소스가 없거나, 받아온 게 아예 없으면 숨긴다.
  if (!loaded) return null;
  if (!listing || !listing.supported || listing.filings.length === 0) return null;

  const annual = listing.filings.filter(f => f.kind === 'annual');
  const quarterly = listing.filings.filter(f => f.kind === 'quarterly');

  return (
    <div className={`rounded-xl border border-border/60 bg-background p-3 shadow-sm ${className}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('filingsMenuTitle', language)}
      </h3>
      <div className="space-y-1.5">
        <FilingSection
          title={t('filingsAnnualTitle', language)}
          description={t('filingsAnnualCopy', language)}
          filings={annual}
          emptyLabel={t('filingsAnnualEmpty', language)}
          defaultOpen
        />
        <FilingSection
          title={t('filingsQuarterlyTitle', language)}
          description={t('filingsQuarterlyCopy', language)}
          filings={quarterly}
          emptyLabel={t('filingsQuarterlyEmpty', language)}
          defaultOpen={false}
        />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {t(listing.market === 'KR' ? 'filingsSourceDart' : 'filingsSourceSec', language)}
      </p>
    </div>
  );
}
