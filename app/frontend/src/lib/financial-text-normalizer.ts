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

export function normalizeFinancialDisplayText(text: string) {
  if (typeof text !== 'string' || text.length === 0) return text;

  return normalizeDebtPercentSequences(text)
    .replace(/부채비율\s+10000%0%0%5%/g, '부채비율 5%')
    .replace(/Debt-To-Equity\(부채비율\)\s+10000%0%0%5%/g, 'Debt-To-Equity(부채비율) 5%')
    .replace(/(이자보상배율\s*)×\s*(\d)/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
