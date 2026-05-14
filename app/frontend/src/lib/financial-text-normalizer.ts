const DEBT_RATIO_LABEL = String.raw`(?:최근\s*)?(?:부채\s*질\s*\(\s*)?(?:부채\s*비율|Debt[-\s_/]*To[-\s_/]*Equity|D\/E)(?:\s*\(debt-to-equity\)|\s*\(부채비율\))?`;

export const BROKEN_DEBT_PERCENT_SEQUENCE = new RegExp(
  String.raw`(?<label>${DEBT_RATIO_LABEL}\s*[:=]?\s*)(?<sequence>(?:\d+(?:\.\d+)?%+){2,})`,
  'giu',
);

function pickDebtPercent(sequence: string) {
  const values = Array.from(sequence.matchAll(/(\d+(?:\.\d+)?)%+/g))
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
  if (values.length === 0) return sequence;

  const normalCandidates = values.filter(value => value > 0 && value <= 500);
  const picked = normalCandidates.at(-1) ?? values.at(-1) ?? 0;
  return `${Number.isInteger(picked) ? picked.toFixed(0) : picked.toFixed(1)}%`;
}

function normalizeDebtPercentSequences(text: string) {
  return text.replace(BROKEN_DEBT_PERCENT_SEQUENCE, (full, label: string, sequence: string) => {
    const picked = pickDebtPercent(sequence);
    if (/Debt|D\/E/i.test(label)) {
      return `Debt-To-Equity(부채비율) ${picked}`;
    }
    if (/부채\s*질/.test(label)) {
      return full.replace(sequence, picked);
    }
    return `${label.replace(/\s+/g, ' ').trimEnd()} ${picked}`;
  });
}

function normalizeBrokenKoreanDecimalSeparators(text: string) {
  return text.replace(/(?<=\d)다\s*(?=\d)/gu, '.');
}

function normalizeNestedDebtRatioLabels(text: string) {
  return text
    .replace(
      /부채비율\s*(?:\(\s*부채비율\s*)+\(\s*debt-to-equity\s*\)\s*\)+/giu,
      '부채비율 (debt-to-equity)',
    )
    .replace(/부채비율\s*\(\s*debt-to-equity\s*\)/giu, '부채비율 (debt-to-equity)');
}

/** 1 bn = 10억 변환 */
function bnToKorean(val: number): string {
  const eok = val * 10;
  if (eok >= 10000) {
    const jo = Math.floor(eok / 10000);
    const remEok = Math.round((eok - jo * 10000) / 100) * 100;
    return remEok > 0 ? `${jo}조 ${remEok}억` : `${jo}조`;
  }
  if (eok >= 100) return `${Math.round(eok)}억`;
  return `${Math.round(eok * 10) / 10}억`;
}

function normalizeBnToKorean(text: string): string {
  return text.replace(
    /([\d,]+(?:\.\d+)?)\s*bn\b/gi,
    (_, numStr: string) => {
      const val = parseFloat(numStr.replace(/,/g, ''));
      if (!Number.isFinite(val)) return _;
      return bnToKorean(val);
    },
  );
}

export function normalizeFinancialDisplayText(text: string) {
  if (typeof text !== 'string' || text.length === 0) return text;

  return normalizeNestedDebtRatioLabels(
    normalizeBrokenKoreanDecimalSeparators(
      normalizeBnToKorean(normalizeDebtPercentSequences(text)),
    ),
  )
    .replace(/부채비율\s+10000%0%0%5%/g, '부채비율 5%')
    .replace(/Debt-To-Equity\(부채비율\)\s+10000%0%0%5%/g, 'Debt-To-Equity(부채비율) 5%')
    .replace(/(이자보상배율\s*)×\s*(\d)/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
