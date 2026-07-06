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

  // 첫 번째 값이 비현실적으로 크면(>500), 원본 비율이 자릿수 깨짐으로 정수처럼 보이는 것이
  // 가능성 높다. 예) D/E ratio 1.3269 → "132.7%"가 "1326000%0%0%9%"로 깨진 경우
  // 십진수 위치를 슬라이드해 0–500% 범위로 복원한다.
  // 단, 10의 거듭제곱(예: 10000)은 단순 스케일 노이즈 패턴이므로 마지막 정상 후보를 우선한다.
  const first = values[0];
  if (first > 500) {
    const isPowerOfTen = /^10+$/.test(String(Math.round(first)));
    if (!isPowerOfTen) {
      let val = first;
      while (val > 500) val /= 10;
      if (val > 0 && val <= 500) {
        return `${val.toFixed(1)}%`;
      }
    }
  }

  const normalCandidates = values.filter(value => value > 0 && value <= 500);
  const picked = normalCandidates.at(-1) ?? values.at(-1) ?? 0;
  return `${Number.isInteger(picked) ? picked.toFixed(0) : picked.toFixed(1)}%`;
}

function normalizeDebtPercentSequences(text: string) {
  return text.replace(BROKEN_DEBT_PERCENT_SEQUENCE, (full, label: string, sequence: string) => {
    const picked = pickDebtPercent(sequence);
    if (/Debt|D\/E/i.test(label)) {
      return `Debt-To-Equity(이자부채비율) ${picked}`;
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

function trimPercentText(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(2).replace(/\.?0+$/u, '');
}

function normalizeDuplicateFinancialNumbers(text: string): string {
  return text
    .replace(
      /(\d[\d,]*(?:\.\d+)?\s*억\s*달러)\s*\(=\s*[-+]?\d+(?:\.\d+)?e[+-]?\d+\s*\)/giu,
      '$1',
    )
    .replace(
      /[-+]?\d[\d,]*(?:\.\d+)?\s*달러\s*\(\s*약\s*([\d,]+(?:\.\d+)?\s*억\s*달러)\s*\)/giu,
      '$1',
    )
    .replace(
      /((?:잉여현금흐름|FCFF?|FCF|수익률|yield)[^.\n]{0,80}?)\b[-+]?0?\.\d+\s*\(\s*(-?\d+(?:\.\d+)?)%\s*\)/giu,
      (_full, prefix: string, pct: string) => `${prefix}${trimPercentText(pct)}%`,
    )
    .replace(
      /safety\s*\(\s*안전마진\s*\)\s*지표가\s*[-+]?0?\.\d+\s*\(\s*약\s*(-?\d+(?:\.\d+)?)%\s*\)/giu,
      (_full, pct: string) => `안전마진 지표가 ${trimPercentText(pct)}%`,
    )
    .replace(
      /((?:안전마진|margin\s*of\s*safety)[^.\n]{0,80}?)\b[-+]?0?\.\d+\s*\(\s*약\s*(-?\d+(?:\.\d+)?)%\s*\)/giu,
      (_full, prefix: string, pct: string) => `${prefix}${trimPercentText(pct)}%`,
    );
}

// 한국어 판정 뒤 중복 영어 병기('관망(Neutral)')와 영어+조사 혼용('low로'),
// 숫자와 vs가 붙는 간격 문제('6.2vs')를 사람이 읽는 형태로 정리한다.
function normalizeKoreanEnglishRedundancy(text: string): string {
  return text
    .replace(/(관망|중립|보유|매수|매도|강세|약세)\s*\(\s*(?:neutral|hold|buy|sell|watch|bullish|bearish)\s*\)/giu, '$1')
    .replace(/신뢰도\s*\(\s*confidence\s*\)/giu, '신뢰도')
    .replace(/["'“”]?\bfresh\s+high\b["'“”]?/giu, '신고점')
    // 볼드 마커(**)가 조사 앞에 끼는 경우("low**로")까지 처리하고, 조사도 '으로'로 교정
    .replace(/\blow(\*\*)?로/giu, '낮음$1으로')
    .replace(/\bhigh(\*\*)?로/giu, '높음$1으로')
    // 주의: '라' 뒤 공백에는 \b가 성립하지 않아(비ASCII) lookahead로 경계를 잡는다
    .replace(/\blow(\*\*)?라(?![가-힣])/giu, '낮아$1')
    .replace(/\bhigh(\*\*)?라(?![가-힣])/giu, '높아$1')
    .replace(/\blow(?=(?:\*\*)?(?:입니다|이라|이므로))/giu, '낮음')
    .replace(/\bhigh(?=(?:\*\*)?(?:입니다|이라|이므로))/giu, '높음')
    // 한글 조사가 바로 붙은 영어 용어("confidence가")는 한국어 용어로 교체
    .replace(/\bconfidence(?=[가는를도은이의와])/giu, '신뢰도')
    // 조사 없이 이어지는 "신뢰도 low/high" (괄호 안 표기 등)
    .replace(/신뢰도\s+low\b/giu, '신뢰도 낮음')
    .replace(/신뢰도\s+high\b/giu, '신뢰도 높음')
    .replace(/\bforward\s+consensus\s+EPS\b/giu, '선행 컨센서스 EPS')
    .replace(/\bearnings\s*\/\s*operating[\s-]?income\b/giu, '순이익/영업이익')
    .replace(/(\d)\s*vs\s*(?=[A-Za-z가-힣\d])/gu, '$1 vs ');
}

// 모델이 소수점 뒤에 공백을 끼워 쓴 깨진 숫자("41. 1대비", "4. 9%/d")를 재결합한다.
// 앞뒤가 모두 숫자이고 뒤 조각이 1~3자리일 때만 — 목록 번호("1. 2026년")나
// 문장 경계("…하십시오. 3. 분기")는 앞이 숫자가 아니거나 뒤가 4자리라 매칭되지 않는다.
function rejoinBrokenDecimals(text: string): string {
  return text.replace(/(\d)\.\s+(\d{1,3})(?!\d)/gu, '$1.$2');
}

// LLM이 지시문(프롬프트)을 보고서 본문에 되뇌인 꼬리를 제거한다.
// 예: "핵심 타겟 데이터: 이 분석을 위해 당신이 전처리 데이터에서 … 확인하십시오."
// 근거 마커([+]/[-]/[~]/[?])나 헤딩(###)을 넘지 않는 범위에서 마지막 지시형 어미까지 삭제.
function stripPromptEcho(text: string): string {
  return text.replace(
    /(?:핵심 타겟 데이터:\s*)?이 분석을 위해 당신이(?:(?!\[[+\-~?]\]|###)[\s\S])*(?:하십시오|하세요)[.。]?/gu,
    '',
  );
}

export function normalizeFinancialDisplayText(text: string) {
  if (typeof text !== 'string' || text.length === 0) return text;

  return normalizeNestedDebtRatioLabels(
    normalizeBrokenKoreanDecimalSeparators(
      normalizeKoreanEnglishRedundancy(
        normalizeDuplicateFinancialNumbers(
          normalizeBnToKorean(normalizeDebtPercentSequences(stripPromptEcho(rejoinBrokenDecimals(text)))),
        ),
      ),
    ),
  )
    .replace(/(이자보상배율\s*)×\s*(\d)/g, '$1$2')
    .replace(/(Normalized\s+EBITDA|정규화\s+EBITDA)\s*×\s*/giu, '$1 ')
    .replace(/(?:배|x|X)\s*\/\s*(?:x|X)/g, '배')
    .replace(/(?:x|X)\s*\/\s*(?:X|x|배)/g, '배')
    .replace(/\b(?:x|X)[-\s]*(?:ratio|multiple)\b/gi, 'ratio')
    .replace(/\(\s*(?:x|X|×)\s*\)/g, '')
    .replace(/(?:x|X|×)\s*(?=의\s*비율)/g, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:x|×)\b/giu, '$1')
    .replace(/이자부채비율\s+10000%0%0%5%/g, '이자부채비율 5%')
    .replace(/Debt-To-Equity\((?:이자)?부채비율\)\s+10000%0%0%5%/g, 'Debt-To-Equity(이자부채비율) 5%')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
