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
        {language === 'ko' ? '표시할 지표가 없습니다.' : 'No metrics to display.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {/* 입력 형식 안내 */}
      <div className="mb-3 px-1 text-xs text-muted-foreground space-y-0.5">
        <p>
          {language === 'ko'
            ? '수정값을 입력하면 에이전트 분석 시 원본 대신 사용됩니다. 빈칸은 원본 유지.'
            : 'Override values replace originals during agent analysis. Leave blank to keep original.'}
        </p>
        <p className="text-muted-foreground/70">
          {language === 'ko'
            ? '입력 형식: 약식(3.77B · 1.2M · 500K) 또는 전체 숫자(3770000000) 모두 가능. 비율은 소수(0.35) 또는 퍼센트(35) 둘 다 가능.'
            : 'Format: shorthand (3.77B · 1.2M · 500K) or full number (3770000000). Ratios: decimal (0.35) or percent (35).'}
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
          {METRICS_FIELDS.map(({ key, labelKo, labelEn, isPercent }) => {
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
                    {language === 'ko' ? labelKo : labelEn}
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
