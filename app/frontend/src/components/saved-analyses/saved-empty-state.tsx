import { Archive } from 'lucide-react';
import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';

interface SavedEmptyStateProps {
  language: ReportLanguage;
}

export function SavedEmptyState({ language }: SavedEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-center" role="status">
      <div className="space-y-2">
        <Archive className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {t('savedDetailEmpty', language)}
        </p>
      </div>
    </div>
  );
}
