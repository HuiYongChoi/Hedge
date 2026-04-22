interface MetricsGridProps {
  metrics: Record<string, any>;
  overrides: Record<string, string>;
  onOverrideChange: (field: string, value: string) => void;
  language: 'ko' | 'en';
}

const METRICS_FIELDS = [
  { key: 'revenue', labelKo: '매출액', labelEn: 'Revenue', isPercent: false },
  { key: 'gross_profit', labelKo: '매출총이익', labelEn: 'Gross Profit', isPercent: false },
  { key: 'operating_income', labelKo: '영업이익', labelEn: 'Operating Income', isPercent: false },
  { key: 'net_income', labelKo: '순이익', labelEn: 'Net Income', isPercent: false },
  { key: 'ebitda', labelKo: 'EBITDA', labelEn: 'EBITDA', isPercent: false },
  { key: 'earnings_per_share', labelKo: '주당순이익 (EPS)', labelEn: 'EPS', isPercent: false },
  { key: 'free_cash_flow', labelKo: '잉여현금흐름', labelEn: 'Free Cash Flow', isPercent: false },
  { key: 'operating_cash_flow', labelKo: '영업현금흐름', labelEn: 'Operating Cash Flow', isPercent: false },
  { key: 'capital_expenditure', labelKo: '설비투자', labelEn: 'CapEx', isPercent: false },
  { key: 'total_assets', labelKo: '총자산', labelEn: 'Total Assets', isPercent: false },
  { key: 'total_liabilities', labelKo: '총부채', labelEn: 'Total Liabilities', isPercent: false },
  { key: 'shareholders_equity', labelKo: '자기자본', labelEn: "Shareholders' Equity", isPercent: false },
  { key: 'cash_and_equivalents', labelKo: '현금성자산', labelEn: 'Cash & Equivalents', isPercent: false },
  { key: 'total_debt', labelKo: '총차입금', labelEn: 'Total Debt', isPercent: false },
  { key: 'gross_margin', labelKo: '매출총이익률', labelEn: 'Gross Margin', isPercent: true },
  { key: 'operating_margin', labelKo: '영업이익률', labelEn: 'Operating Margin', isPercent: true },
  { key: 'net_margin', labelKo: '순이익률', labelEn: 'Net Margin', isPercent: true },
  { key: 'return_on_equity', labelKo: 'ROE', labelEn: 'Return on Equity', isPercent: true },
  { key: 'return_on_assets', labelKo: 'ROA', labelEn: 'Return on Assets', isPercent: true },
  { key: 'return_on_invested_capital', labelKo: 'ROIC', labelEn: 'ROIC', isPercent: true },
  { key: 'price_to_earnings_ratio', labelKo: 'PER', labelEn: 'P/E Ratio', isPercent: false },
  { key: 'price_to_book_ratio', labelKo: 'PBR', labelEn: 'P/B Ratio', isPercent: false },
  { key: 'price_to_sales_ratio', labelKo: 'PSR', labelEn: 'P/S Ratio', isPercent: false },
  { key: 'debt_to_equity', labelKo: '부채비율', labelEn: 'Debt to Equity', isPercent: false },
];

function formatOriginal(value: any, isPercent: boolean): string {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (isPercent) {
    const pct = Math.abs(num) <= 1 ? num * 100 : num;
    return `${pct.toFixed(2)}%`;
  }
  if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(4);
}

export function MetricsGrid({ metrics, overrides, onOverrideChange, language }: MetricsGridProps) {
  const hasMetrics = metrics && Object.keys(metrics).length > 0;

  if (!hasMetrics) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {language === 'ko' ? '표시할 지표가 없습니다.' : 'No metrics to display.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-48">
              {language === 'ko' ? '항목' : 'Field'}
            </th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground w-40">
              {language === 'ko' ? '원본값' : 'Original'}
            </th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground w-44">
              {language === 'ko' ? '수정값' : 'Override'}
            </th>
          </tr>
        </thead>
        <tbody>
          {METRICS_FIELDS.map(({ key, labelKo, labelEn, isPercent }) => {
            const originalVal = metrics[key];
            const overrideVal = overrides[key] ?? '';
            const hasOverride = overrideVal !== '';

            return (
              <tr key={key} className="border-b border-dashed hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-3 text-foreground">
                  {language === 'ko' ? labelKo : labelEn}
                  <span className="ml-1 text-[10px] text-muted-foreground/60">{key}</span>
                </td>
                <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">
                  {formatOriginal(originalVal, isPercent)}
                </td>
                <td className="py-1.5 px-3 text-right">
                  <input
                    type="number"
                    step="any"
                    value={overrideVal}
                    onChange={e => onOverrideChange(key, e.target.value)}
                    placeholder={language === 'ko' ? '수정 안 함' : 'unchanged'}
                    className={`w-36 text-right text-sm bg-transparent border rounded px-2 py-0.5 font-mono
                      focus:outline-none focus:ring-1 focus:ring-blue-500
                      placeholder:text-muted-foreground/40
                      ${hasOverride
                        ? 'border-blue-500/60 text-blue-400'
                        : 'border-border text-foreground'}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
