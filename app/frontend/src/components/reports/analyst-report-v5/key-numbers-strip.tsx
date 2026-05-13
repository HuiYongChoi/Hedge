import { t } from '@/lib/language-preferences';
import type { KeyNumber, ReportLanguage } from './types';

interface KeyNumbersStripProps {
  keyNumbers: KeyNumber[];
  language: ReportLanguage;
}

export function KeyNumbersStrip({ keyNumbers, language }: KeyNumbersStripProps) {
  if (keyNumbers.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-xs">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('reportKeyNumbers', language)}
      </span>
      {keyNumbers.map(({ label, value }) => (
        <div key={label} className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono font-medium text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}
