import { AlertCircle } from 'lucide-react';
import { t } from '@/lib/language-preferences';

interface MetricsGridProps {
  metrics: Record<string, any>;
  overrides: Record<string, string>;
  onOverrideChange: (field: string, value: string) => void;
  language: 'ko' | 'en';
  lineItems?: Record<string, any>[];
  lineItemsOverrides?: Record<string, any>[];
}

export const FINANCIAL_FIELD_LABEL_KEYS: Record<string, string> = {
  capital_expenditure: 'financialFieldCapitalExpenditure',
  cash_and_equivalents: 'financialFieldCashAndEquivalents',
  debt_to_equity: 'financialFieldDebtToEquity',
  depreciation_and_amortization: 'financialFieldDepreciationAndAmortization',
  earnings_per_share: 'financialFieldEarningsPerShare',
  ebitda: 'financialFieldEbitda',
  free_cash_flow: 'financialFieldFreeCashFlow',
  gross_margin: 'financialFieldGrossMargin',
  gross_profit: 'financialFieldGrossProfit',
  interest_expense: 'financialFieldInterestExpense',
  net_income: 'financialFieldNetIncome',
  net_margin: 'financialFieldNetMargin',
  operating_cash_flow: 'financialFieldOperatingCashFlow',
  operating_income: 'financialFieldOperatingIncome',
  operating_margin: 'financialFieldOperatingMargin',
  price_to_book_ratio: 'financialFieldPriceToBookRatio',
  price_to_earnings_ratio: 'financialFieldPriceToEarningsRatio',
  price_to_sales_ratio: 'financialFieldPriceToSalesRatio',
  research_and_development: 'financialFieldResearchAndDevelopment',
  return_on_assets: 'financialFieldReturnOnAssets',
  return_on_equity: 'financialFieldReturnOnEquity',
  return_on_invested_capital: 'financialFieldReturnOnInvestedCapital',
  revenue: 'financialFieldRevenue',
  shareholders_equity: 'financialFieldShareholdersEquity',
  total_assets: 'financialFieldTotalAssets',
  total_debt: 'financialFieldTotalDebt',
  total_liabilities: 'financialFieldTotalLiabilities',
};

export function getFinancialFieldLabel(field: string, language: 'ko' | 'en'): string {
  const labelKey = FINANCIAL_FIELD_LABEL_KEYS[field];
  return labelKey ? t(labelKey, language) : field.replace(/_/g, ' ');
}

const METRICS_FIELDS = [
  { key: 'revenue', isPercent: false },
  { key: 'gross_profit', isPercent: false },
  { key: 'operating_income', isPercent: false },
  { key: 'net_income', isPercent: false },
  { key: 'ebitda', isPercent: false },
  { key: 'earnings_per_share', isPercent: false },
  { key: 'free_cash_flow', isPercent: false },
  { key: 'operating_cash_flow', isPercent: false },
  { key: 'capital_expenditure', isPercent: false },
  { key: 'total_assets', isPercent: false },
  { key: 'total_liabilities', isPercent: false },
  { key: 'shareholders_equity', isPercent: false },
  { key: 'cash_and_equivalents', isPercent: false },
  { key: 'total_debt', isPercent: false },
  { key: 'gross_margin', isPercent: true },
  { key: 'operating_margin', isPercent: true },
  { key: 'net_margin', isPercent: true },
  { key: 'return_on_equity', isPercent: true },
  { key: 'return_on_assets', isPercent: true },
  { key: 'return_on_invested_capital', isPercent: true },
  { key: 'price_to_earnings_ratio', isPercent: false },
  { key: 'price_to_book_ratio', isPercent: false },
  { key: 'price_to_sales_ratio', isPercent: false },
  { key: 'debt_to_equity', isPercent: false },
];

function _safeNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** metrics override 값과 line_items[0] 값을 비교해 불일치 여부를 반환. */
export function compareOverrideVsLineItem0(
  overrideRaw: string,
  lineItem0Val: number | null | undefined,
  originalMetric: number | null | undefined,
): { mismatch: boolean; effectiveMetric: number | null; effectiveLineItem: number | null } {
  const parsedOverride = overrideRaw !== '' ? parseOverrideInput(overrideRaw) : null;
  const effectiveMetric = parsedOverride !== null ? parsedOverride : _safeNum(originalMetric);
  const effectiveLineItem = _safeNum(lineItem0Val);

  let mismatch = false;
  if (effectiveMetric !== null && effectiveLineItem !== null) {
    const maxAbs = Math.max(Math.abs(effectiveMetric), Math.abs(effectiveLineItem));
    mismatch = maxAbs > 0
      ? Math.abs(effectiveMetric - effectiveLineItem) / maxAbs > 1e-6
      : effectiveMetric !== effectiveLineItem;
  }

  return { mismatch, effectiveMetric, effectiveLineItem };
}

/** "3.77B", "1.2M", "500K", "0.35", "-2.1B" 등을 숫자로 파싱. 파싱 불가 시 null 반환. */
export function parseOverrideInput(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.trim().toUpperCase();
  const match = s.match(/^(-?\d+\.?\d*)([BMK]?)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;
  switch (match[2]) {
    case 'B': return num * 1e9;
    case 'M': return num * 1e6;
    case 'K': return num * 1e3;
    default:  return num;
  }
}

/** 숫자를 약식(B/M/K) 문자열로 표시. null/undefined면 '—' */
function formatOriginal(value: any, isPercent: boolean): { short: string; raw: string } {
  if (value === null || value === undefined) return { short: '—', raw: '' };
  const num = Number(value);
  if (!Number.isFinite(num)) return { short: String(value), raw: '' };

  if (isPercent) {
    const pct = Math.abs(num) <= 1 ? num * 100 : num;
    return { short: `${pct.toFixed(2)}%`, raw: String(num) };
  }

  const rawStr = Number.isInteger(num)
    ? num.toLocaleString('en-US')
    : num.toFixed(4);

  if (Math.abs(num) >= 1e9) return { short: `${(num / 1e9).toFixed(2)}B`, raw: rawStr };
  if (Math.abs(num) >= 1e6) return { short: `${(num / 1e6).toFixed(2)}M`, raw: rawStr };
  if (Math.abs(num) >= 1e3) return { short: `${(num / 1e3).toFixed(2)}K`, raw: rawStr };
  return { short: rawStr, raw: '' };
}

/** 입력값이 유효한 숫자/약식인지 검증 */
function isValidInput(raw: string): boolean {
  if (raw === '' || raw === '-') return true; // 입력 중 허용
  return parseOverrideInput(raw) !== null;
}

export function MetricsGrid({ metrics, overrides, onOverrideChange, language, lineItems, lineItemsOverrides }: MetricsGridProps) {
  const hasMetrics = metrics && Object.keys(metrics).length > 0;

  if (!hasMetrics) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {t('noMetricsToDisplay', language)}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 px-1 text-xs text-muted-foreground space-y-0.5">
        <p>
          {t('overrideInstruction', language)}
        </p>
        <p className="text-muted-foreground/70">
          {t('overrideFormatHelp', language)}
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-48">
              {t('metricsField', language)}
            </th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground w-44">
              {t('originalValue', language)}
            </th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground w-44">
              {t('overrideValue', language)}
            </th>
          </tr>
        </thead>
        <tbody>
          {METRICS_FIELDS.map(({ key, isPercent }) => {
            const originalVal = metrics[key];
            const { short, raw } = formatOriginal(originalVal, isPercent);
            const overrideVal = overrides[key] ?? '';
            const hasOverride = overrideVal !== '';
            const isInvalid = hasOverride && !isValidInput(overrideVal);
            const li0Current = lineItemsOverrides?.[0]?.[key];
            const { mismatch } = !isPercent
              ? compareOverrideVsLineItem0(overrideVal, li0Current, originalVal)
              : { mismatch: false };

            return (
              <tr key={key} className="border-b border-dashed hover:bg-muted/30 transition-colors">
                <td className="py-1.5 px-3 text-foreground">
                  <span className="inline-flex items-center gap-1">
                    {getFinancialFieldLabel(key, language)}
                    <span className="text-[10px] text-muted-foreground/50">{key}</span>
                    {mismatch && (
                      <AlertCircle
                        size={12}
                        className="text-yellow-500 flex-shrink-0"
                        title={t('mismatchBadgeTitle', language)}
                      />
                    )}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-right">
                  {short === '—' ? (
                    <span className="font-mono text-muted-foreground/40">—</span>
                  ) : (
                    <span className="font-mono text-muted-foreground">
                      {short}
                      {raw && raw !== short && (
                        <span className="block text-[10px] text-muted-foreground/40">
                          {raw}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-3 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={overrideVal}
                    onChange={e => onOverrideChange(key, e.target.value)}
                    placeholder={
                      short === '—'
                        ? t('exampleMetricOverride', language)
                        : short
                    }
                    className={`w-36 text-right text-sm bg-transparent border rounded px-2 py-0.5 font-mono
                      focus:outline-none focus:ring-1
                      placeholder:text-muted-foreground/30
                      ${isInvalid
                        ? 'border-red-500/60 text-red-400 focus:ring-red-500'
                        : hasOverride
                          ? 'border-blue-500/60 text-blue-400 focus:ring-blue-500'
                          : 'border-border text-foreground focus:ring-blue-500'
                      }`}
                  />
                  {isInvalid && (
                    <p className="text-[10px] text-red-400 mt-0.5 text-right">
                      {t('exampleInvalidOverride', language)}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
