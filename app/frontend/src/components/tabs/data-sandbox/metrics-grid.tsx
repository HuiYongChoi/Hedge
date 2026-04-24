import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { t } from '@/lib/language-preferences';

interface MetricsGridProps {
  metrics: Record<string, any>;
  overrides: Record<string, string>;
  onOverrideChange: (field: string, value: string) => void;
  language: 'ko' | 'en';
  lineItemsOverrides?: Record<string, any>[];
}

export const FINANCIAL_FIELD_LABEL_KEYS: Record<string, string> = {
  // 수익성
  capital_expenditure: 'financialFieldCapitalExpenditure',
  cash_and_equivalents: 'financialFieldCashAndEquivalents',
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
  research_and_development: 'financialFieldResearchAndDevelopment',
  return_on_assets: 'financialFieldReturnOnAssets',
  return_on_equity: 'financialFieldReturnOnEquity',
  return_on_invested_capital: 'financialFieldReturnOnInvestedCapital',
  revenue: 'financialFieldRevenue',
  shareholders_equity: 'financialFieldShareholdersEquity',
  total_assets: 'financialFieldTotalAssets',
  total_debt: 'financialFieldTotalDebt',
  total_liabilities: 'financialFieldTotalLiabilities',
  // 밸류에이션
  price_to_book_ratio: 'financialFieldPriceToBookRatio',
  price_to_earnings_ratio: 'financialFieldPriceToEarningsRatio',
  price_to_sales_ratio: 'financialFieldPriceToSalesRatio',
  enterprise_value: 'financialFieldEnterpriseValue',
  enterprise_value_to_ebitda_ratio: 'financialFieldEvToEbitda',
  enterprise_value_to_revenue_ratio: 'financialFieldEvToRevenue',
  peg_ratio: 'financialFieldPegRatio',
  free_cash_flow_yield: 'financialFieldFcfYield',
  // 성장률
  revenue_growth: 'financialFieldRevenueGrowth',
  earnings_growth: 'financialFieldEarningsGrowth',
  operating_income_growth: 'financialFieldOperatingIncomeGrowth',
  ebitda_growth: 'financialFieldEbitdaGrowth',
  free_cash_flow_growth: 'financialFieldFreeCashFlowGrowth',
  book_value_growth: 'financialFieldBookValueGrowth',
  earnings_per_share_growth: 'financialFieldEpsGrowth',
  // 재무안정성
  debt_to_equity: 'financialFieldDebtToEquity',
  current_ratio: 'financialFieldCurrentRatio',
  quick_ratio: 'financialFieldQuickRatio',
  interest_coverage: 'financialFieldInterestCoverage',
};

export function getFinancialFieldLabel(field: string, language: 'ko' | 'en'): string {
  const baseField = field.replace(/_(yoy|qoq|ttm)$/, '');
  const labelKey = FINANCIAL_FIELD_LABEL_KEYS[baseField];
  return labelKey ? t(labelKey, language) : field.replace(/_/g, ' ');
}

// ── 서브탭 정의 ──────────────────────────────────────────────────────────────
type SubTab = 'profitability' | 'valuation' | 'growth_yoy' | 'growth_ttm' | 'growth_qoq' | 'stability';

const PROFITABILITY_FIELDS = [
  { key: 'revenue', isPercent: false },
  { key: 'gross_profit', isPercent: false },
  { key: 'operating_income', isPercent: false },
  { key: 'net_income', isPercent: false },
  { key: 'ebitda', isPercent: false },
  { key: 'earnings_per_share', isPercent: false },
  { key: 'free_cash_flow', isPercent: false },
  { key: 'operating_cash_flow', isPercent: false },
  { key: 'capital_expenditure', isPercent: false },
  { key: 'research_and_development', isPercent: false },
  { key: 'interest_expense', isPercent: false },
  { key: 'depreciation_and_amortization', isPercent: false },
  { key: 'gross_margin', isPercent: true },
  { key: 'operating_margin', isPercent: true },
  { key: 'net_margin', isPercent: true },
  { key: 'return_on_equity', isPercent: true },
  { key: 'return_on_assets', isPercent: true },
  { key: 'return_on_invested_capital', isPercent: true },
];

const VALUATION_FIELDS = [
  { key: 'price_to_earnings_ratio', isPercent: false },
  { key: 'price_to_book_ratio', isPercent: false },
  { key: 'price_to_sales_ratio', isPercent: false },
  { key: 'enterprise_value', isPercent: false },
  { key: 'enterprise_value_to_ebitda_ratio', isPercent: false },
  { key: 'enterprise_value_to_revenue_ratio', isPercent: false },
  { key: 'peg_ratio', isPercent: false },
  { key: 'free_cash_flow_yield', isPercent: true },
];

const GROWTH_YOY_FIELDS = [
  { key: 'revenue_growth_yoy', isPercent: true },
  { key: 'earnings_growth_yoy', isPercent: true },
  { key: 'operating_income_growth_yoy', isPercent: true },
  { key: 'ebitda_growth_yoy', isPercent: true },
  { key: 'free_cash_flow_growth_yoy', isPercent: true },
  { key: 'book_value_growth_yoy', isPercent: true },
  { key: 'earnings_per_share_growth_yoy', isPercent: true },
];

const GROWTH_TTM_FIELDS = [
  { key: 'revenue_growth_ttm', isPercent: true },
  { key: 'earnings_growth_ttm', isPercent: true },
  { key: 'operating_income_growth_ttm', isPercent: true },
  { key: 'ebitda_growth_ttm', isPercent: true },
  { key: 'free_cash_flow_growth_ttm', isPercent: true },
  { key: 'book_value_growth_ttm', isPercent: true },
  { key: 'earnings_per_share_growth_ttm', isPercent: true },
];

const GROWTH_QOQ_FIELDS = [
  { key: 'revenue_growth_qoq', isPercent: true },
  { key: 'earnings_growth_qoq', isPercent: true },
  { key: 'operating_income_growth_qoq', isPercent: true },
  { key: 'ebitda_growth_qoq', isPercent: true },
  { key: 'free_cash_flow_growth_qoq', isPercent: true },
  { key: 'book_value_growth_qoq', isPercent: true },
  { key: 'earnings_per_share_growth_qoq', isPercent: true },
];

const STABILITY_FIELDS = [
  { key: 'total_assets', isPercent: false },
  { key: 'total_liabilities', isPercent: false },
  { key: 'shareholders_equity', isPercent: false },
  { key: 'cash_and_equivalents', isPercent: false },
  { key: 'total_debt', isPercent: false },
  { key: 'debt_to_equity', isPercent: false },
  { key: 'current_ratio', isPercent: false },
  { key: 'quick_ratio', isPercent: false },
  { key: 'interest_coverage', isPercent: false },
];

const SUB_TABS: { id: SubTab; labelKey: string; fields: { key: string; isPercent: boolean }[] }[] = [
  { id: 'profitability', labelKey: 'metricsSubTabProfitability', fields: PROFITABILITY_FIELDS },
  { id: 'valuation',    labelKey: 'metricsSubTabValuation',    fields: VALUATION_FIELDS },
  { id: 'growth_yoy',   labelKey: 'metricsSubTabGrowthYoy',    fields: GROWTH_YOY_FIELDS },
  { id: 'growth_ttm',   labelKey: 'metricsSubTabGrowthTtm',    fields: GROWTH_TTM_FIELDS },
  { id: 'growth_qoq',   labelKey: 'metricsSubTabGrowthQoq',    fields: GROWTH_QOQ_FIELDS },
  { id: 'stability',    labelKey: 'metricsSubTabStability',    fields: STABILITY_FIELDS },
];

// ── 유틸 함수 ──────────────────────────────────────────────────────────────────
function _safeNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

export function parseOverrideInput(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const s = raw.trim().toUpperCase();
  const match = s.match(/^(-?\d+\.?\d*)([BMK%]?)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;
  switch (match[2]) {
    case 'B': return num * 1e9;
    case 'M': return num * 1e6;
    case 'K': return num * 1e3;
    case '%': return num / 100;
    default:  return num;
  }
}

function formatOriginal(value: any, isPercent: boolean): { short: string; raw: string } {
  if (value === null || value === undefined) return { short: '—', raw: '' };
  const num = Number(value);
  if (!Number.isFinite(num)) return { short: String(value), raw: '' };

  if (isPercent) {
    const pct = Math.abs(num) <= 1 ? num * 100 : num;
    const sign = pct > 0 ? '+' : '';
    return { short: `${sign}${pct.toFixed(2)}%`, raw: String(num) };
  }

  const rawStr = Number.isInteger(num)
    ? num.toLocaleString('en-US')
    : num.toFixed(4);

  if (Math.abs(num) >= 1e9) return { short: `${(num / 1e9).toFixed(2)}B`, raw: rawStr };
  if (Math.abs(num) >= 1e6) return { short: `${(num / 1e6).toFixed(2)}M`, raw: rawStr };
  if (Math.abs(num) >= 1e3) return { short: `${(num / 1e3).toFixed(2)}K`, raw: rawStr };
  return { short: rawStr, raw: '' };
}

function isValidInput(raw: string): boolean {
  if (raw === '' || raw === '-') return true;
  return parseOverrideInput(raw) !== null;
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
export function MetricsGrid({ metrics, overrides, onOverrideChange, language, lineItemsOverrides }: MetricsGridProps) {
  const [activeTab, setActiveTab] = useState<SubTab>('profitability');

  const hasMetrics = metrics && Object.keys(metrics).length > 0;

  if (!hasMetrics) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {t('noMetricsToDisplay', language)}
      </div>
    );
  }

  const currentTabDef = SUB_TABS.find(s => s.id === activeTab)!;
  const overrideCount = Object.values(overrides).filter(v => v !== '').length;

  return (
    <div className="space-y-3">
      {/* 서브탭 네비게이션 */}
      <div className="flex items-center gap-1 border-b border-border/60 pb-0">
        {SUB_TABS.map(tab => {
          const isActive = tab.id === activeTab;
          // 탭별 데이터 유무 체크 (성장률 탭에서 몇 개나 채워졌는지)
          const filledCount = tab.fields.filter(f => metrics[f.key] != null || overrides[f.key]).length;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors relative
                ${isActive
                  ? 'text-foreground border-b-2 border-blue-500 -mb-px bg-transparent'
                  : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {t(tab.labelKey, language)}
              {filledCount > 0 && (
                <span className={`ml-1 text-[9px] px-1 py-0.5 rounded-full
                  ${isActive ? 'bg-blue-500/20 text-blue-400' : 'bg-muted text-muted-foreground/60'}`}>
                  {filledCount}
                </span>
              )}
            </button>
          );
        })}
        {overrideCount > 0 && (
          <span className="ml-auto text-[10px] text-blue-400 pr-1">
            {t('overrideCountLabel', language).replace('{count}', String(overrideCount))}
          </span>
        )}
      </div>

      {/* 안내문 */}
      <div className="px-1 text-xs text-muted-foreground space-y-0.5">
        <p>{t('overrideInstruction', language)}</p>
        <p className="text-muted-foreground/70">{t('overrideFormatHelp', language)}</p>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 px-3 font-medium text-muted-foreground w-52">
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
            {currentTabDef.fields.map(({ key, isPercent }) => {
              const originalVal = metrics[key];
              const { short, raw } = formatOriginal(originalVal, isPercent);
              const overrideVal = overrides[key] ?? '';
              const hasOverride = overrideVal !== '';
              const isInvalid = hasOverride && !isValidInput(overrideVal);
              const li0Current = lineItemsOverrides?.[0]?.[key];
              const { mismatch } = !isPercent
                ? compareOverrideVsLineItem0(overrideVal, li0Current, originalVal)
                : { mismatch: false };

              // 성장률 탭: 값이 양수면 초록, 음수면 빨강
              let valueColor = 'text-muted-foreground';
              if (isPercent && originalVal != null) {
                const n = Number(originalVal);
                if (Number.isFinite(n)) {
                  valueColor = n > 0 ? 'text-emerald-500' : n < 0 ? 'text-red-400' : 'text-muted-foreground';
                }
              }

              return (
                <tr key={key} className="border-b border-dashed hover:bg-muted/30 transition-colors">
                  <td className="py-1.5 px-3 text-foreground">
                    <span className="inline-flex items-center gap-1">
                      {getFinancialFieldLabel(key, language)}
                      <span className="text-[10px] text-muted-foreground/40">{key}</span>
                      {mismatch && (
                        <span title={t('mismatchBadgeTitle', language)} className="inline-flex">
                          <AlertCircle size={12} className="text-yellow-500 flex-shrink-0" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {short === '—' ? (
                      <span className="font-mono text-muted-foreground/40">—</span>
                    ) : (
                      <span className={`font-mono ${valueColor}`}>
                        {short}
                        {raw && raw !== short && (
                          <span className="block text-[10px] text-muted-foreground/40">{raw}</span>
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
                        isPercent
                          ? (short === '—' ? '예: 0.12 or 12%' : short)
                          : (short === '—' ? t('exampleMetricOverride', language) : short)
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
    </div>
  );
}
