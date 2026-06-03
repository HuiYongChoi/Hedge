import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import { formatValue } from './helpers';

interface Props {
  detail: SavedAnalysis;
  language: ReportLanguage;
}

function formatSignal(signal: any): string {
  if (!signal) return '—';
  const label = String(signal.signal || '—').toUpperCase();
  const confidence = signal.confidence ?? signal.score;
  return confidence !== undefined && confidence !== null
    ? `${label} · ${confidence}`
    : label;
}

export function SavedCompareDetail({ detail, language }: Props) {
  const result = detail.result_data ?? {};
  const slots: any[] = Array.isArray(result.slots) ? result.slots : [];
  const modelKeys: string[] = Array.isArray(result.model_keys) ? result.model_keys : [];
  const financialRows: any[] = Array.isArray(result.financial_rows) ? result.financial_rows : [];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-xs font-semibold">
            {language === 'ko' ? '비교 요약' : 'Comparison Summary'}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-4 pb-3">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-left">{language === 'ko' ? '종목' : 'Ticker'}</th>
                <th className="py-1 text-right">{language === 'ko' ? '상태' : 'Status'}</th>
                <th className="py-1 text-right">{language === 'ko' ? '신호' : 'Signal'}</th>
                <th className="py-1 text-right">{language === 'ko' ? '현재가' : 'Price'}</th>
              </tr>
            </thead>
            <tbody>
              {slots.map(slot => (
                <tr key={slot.id || slot.ticker} className="border-t">
                  <td className="py-1 font-semibold text-primary">{slot.ticker}</td>
                  <td className="py-1 text-right">{slot.status || '—'}</td>
                  <td className="py-1 text-right font-mono">{formatSignal(slot.signal)}</td>
                  <td className="py-1 text-right font-mono">{formatValue(slot.currentPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-xs font-semibold">
            {language === 'ko' ? '가치평가 모델' : 'Valuation Models'}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-4 pb-3">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-left">Model</th>
                {slots.map(slot => (
                  <th key={slot.id || slot.ticker} className="py-1 text-right">{slot.ticker}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelKeys.map(key => (
                <tr key={key} className="border-t">
                  <td className="py-1">{key}</td>
                  {slots.map(slot => {
                    const model = slot.valuation?.models?.find((item: any) => item.key === key);
                    return (
                      <td key={slot.id || slot.ticker} className="py-1 text-right font-mono">
                        {formatValue(model?.intrinsicPerShare)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2 px-4">
          <CardTitle className="text-xs font-semibold">
            {language === 'ko' ? '저장 원본' : 'Raw Snapshot'}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] font-mono">
            {JSON.stringify({ request: detail.request_data, financial_rows: financialRows, result }, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
