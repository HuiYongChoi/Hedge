import { Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/language-preferences';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import { formatValue } from './helpers';

interface Props {
  detail: SavedAnalysis;
  language: ReportLanguage;
}

function KeyValueTable({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground truncate">{k}</dt>
          <dd className="font-mono text-foreground truncate">{formatValue(v)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function SavedSandboxDetail({ detail, language }: Props) {
  const rd = detail.result_data ?? {};

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {rd.forward_metrics && (
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs font-semibold">Forward Metrics</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <KeyValueTable data={rd.forward_metrics} />
          </CardContent>
        </Card>
      )}
      {rd.metrics && (
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs font-semibold">Metrics</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <KeyValueTable data={rd.metrics} />
          </CardContent>
        </Card>
      )}
      {rd.overrides && Object.keys(rd.overrides).length > 0 && (
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs font-semibold">Overrides</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <KeyValueTable data={rd.overrides} />
          </CardContent>
        </Card>
      )}
      <Card className="lg:col-span-2">
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-xs font-semibold">{t('savedRequestSnapshot', language)}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] font-mono max-h-60">
            {JSON.stringify(detail.request_data, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
