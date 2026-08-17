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

// 근거 주입용 마커가 본문으로 새어 나오는 경우를 제거한다.
// 실측: 보고서 본문 끝에 "[SEC FILING SOURCE TEXT — DART · … filed 20260317] URL:https://…"
// 가 그대로 인쇄됐다. 이건 모델에게 준 자료의 머리표지이지 독자가 읽을 문장이 아니다.
// 출처는 인용 칩으로 따로 렌더링되므로 본문의 맨 URL도 함께 걷어낸다.
export function stripLeakedSourceMarkers(text: string): string {
  return text
    .replace(/\[(?:SEC FILING SOURCE TEXT|MANAGEMENT SAID|SOURCE GROUNDING)[^\]]*\]\s*/gu, '')
    .replace(/\bURL\s*[:：]\s*\S+/gu, '')
    // 스킴이 잘려 문장에 박힌 주소 조각("…“6.3. fss.or.kr/dsaf001/main.do?rcpNo=…")
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)*(?:fss\.or\.kr|sec\.gov|edinet-fsa\.go\.jp)\/\S*/gu, '')
    .replace(/[ \t]{2,}/g, ' ');
}

//: 모델이 분석 데이터의 키 이름을 그대로 옮겨 적는다. 독자에게는 암호다.
const RAW_FIELD_GLOSSARY: Array<[RegExp, string]> = [
  [/\bmargin_of_safety\b/gi, '안전마진'],
  [/\binterest_coverage\b/gi, '이자보상배율'],
  [/\balignment_score\b/gi, '전략 이행도 점수'],
  [/\brelative_val(?:uation)?_analysis\b/gi, '상대가치 분석'],
  [/\bintrinsic_val(?:ue)?_analysis\b/gi, '내재가치 분석'],
  [/\bnarrative_check\b/gi, '서사 일관성 점검'],
  [/\bmanagement_assessment\s*axes\s*detail\b/gi, '경영진 평가 세부 항목'],
  [/\bmanagement_assessment\b/gi, '경영진 평가'],
  [/\bmanagement_said\b/gi, '경영진 발언'],
  [/\bforward[_\s]confidence\b/gi, '선행 추정 신뢰도'],
  [/\bDATA[_\s]INSUFFICIENT\b/gi, '데이터 부족'],
  [/\bFCFF\s+DCF\s+completed\b/gi, 'FCFF DCF 산출 완료'],
  [/\bPositive\s+FCFF\s+growth\b/gi, 'FCFF 성장 플러스'],
  [/\bRevenue\s+CAGR\b/gi, '매출 연평균성장률'],
  [/\bForward\s+outlook\b/gi, '선행 전망'],
  [/\binsufficient\s*[:：]\s*true\b/gi, '판정 불가'],
];

// "checked 2 / total 3" → "3개 항목 중 2개 점검"
function humanizeCheckedTotals(text: string): string {
  return text.replace(
    /\bchecked\s*(\d+)\s*\/\s*total\s*(\d+)\b/gi,
    (_full, checked: string, total: string) => `${total}개 항목 중 ${checked}개 점검`,
  );
}

/** 한글 음절의 받침 유무. 한글이 아니면 null. */
function hasFinalConsonant(syllable: string): boolean | null {
  const code = syllable.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

/** 받침이 'ㄹ'이면 '으로'가 아니라 '로'를 쓴다. */
function endsWithRieul(syllable: string): boolean {
  const code = syllable.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 8;
}

// 영문 필드명을 한국어로 바꾸면 앞뒤 조사가 어긋난다("상대가치 분석 는", "점검 으로").
// 한국어 산문에서 조사 앞 공백은 언제나 오류이므로, 공백을 붙이면서 받침에 맞는 조사로
// 교정한다. '이/가/의'는 관형사 '이'(이 회사)와 구분이 어려워 대상에서 제외한다.
function fixKoreanParticleSpacing(text: string): string {
  return text.replace(
    /([가-힣0-9%)\]])\s+(는|은|를|을|으로|로|와|과)(?=[\s,.)\]]|$)/gu,
    (_full, tail: string, particle: string) => {
      const batchim = hasFinalConsonant(tail);
      if (batchim === null) return `${tail}${particle}`;   // 숫자·기호 뒤는 원형 유지
      if (particle === '는' || particle === '은') return `${tail}${batchim ? '은' : '는'}`;
      if (particle === '를' || particle === '을') return `${tail}${batchim ? '을' : '를'}`;
      if (particle === '와' || particle === '과') return `${tail}${batchim ? '과' : '와'}`;
      return `${tail}${batchim && !endsWithRieul(tail) ? '으로' : '로'}`;
    },
  );
}

const GLOSSARY_TERMS = RAW_FIELD_GLOSSARY.map(([, korean]) => korean)
  .filter(term => /^[가-힣]/u.test(term))
  .sort((a, b) => b.length - a.length);

// 조사가 공백 없이 바로 붙은 경우("서사 일관성 점검는")의 교정.
// 붙은 조사를 무조건 고치면 동사 어미('먹는', '가는')를 망가뜨리므로,
// 우리가 방금 바꿔 넣은 용어 뒤에서만 적용한다.
function fixParticlesAfterGlossaryTerms(text: string): string {
  if (GLOSSARY_TERMS.length === 0) return text;
  const pattern = new RegExp(
    `(${GLOSSARY_TERMS.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(는|은|를|을|와|과)(?=[\\s,.)\\]]|$)`,
    'gu',
  );
  return text.replace(pattern, (_full, term: string, particle: string) => {
    const batchim = hasFinalConsonant(term.slice(-1));
    if (batchim === null) return `${term}${particle}`;
    if (particle === '는' || particle === '은') return `${term}${batchim ? '은' : '는'}`;
    if (particle === '를' || particle === '을') return `${term}${batchim ? '을' : '를'}`;
    return `${term}${batchim ? '과' : '와'}`;
  });
}

function humanizeRawFieldNames(text: string): string {
  let out = humanizeCheckedTotals(text);
  for (const [pattern, replacement] of RAW_FIELD_GLOSSARY) out = out.replace(pattern, replacement);
  return fixParticlesAfterGlossaryTerms(fixKoreanParticleSpacing(
    out
      // 치환 결과로 생기는 "안전마진(안전마진)" 같은 자기중복 괄호를 접는다.
      .replace(/([가-힣][가-힣\s]{1,14}?)\s*\(\s*\1\s*\)/gu, '$1')
      // "서사(서사 일관성 점검)"처럼 괄호 안이 앞 낱말을 포함해 더 자세하면 괄호 쪽만 남긴다.
      .replace(/([가-힣]{2,10})\s*\(\s*(\1[가-힣\s]{1,20})\s*\)/gu, '$2'),
  ));
}

// 모델이 원시 실수를 그대로 적고 말줄임표로 끊어("-0.166752…", "12.439…") 읽을 수 없게 만든다.
// 비율 라벨이 앞에 오고 절댓값이 1 미만이면 퍼센트로, 그 밖에는 소수 둘째 자리로 정리한다.
const RATIO_LABEL_RE = /(?:안전마진|마진|성장률|수익률|증가율|비율|margin|growth|rate|yield)\s*[^.\n]{0,20}$/iu;

function tidyDecimal(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/u, '');
}

export function normalizeTruncatedDecimals(text: string): string {
  return text
    // 1) 원시 비율 바로 뒤에 사람이 읽을 퍼센트가 병기된 경우 → 원시 값을 버린다.
    //    "매출 성장률 0.467628…(약 +46.76%)" → "매출 성장률 약 +46.76%"
    .replace(
      /-?\d+\.\d{3,}\s*(?:…|\.\.\.)?\s*\(\s*(약\s*)?([+-]?\d+(?:\.\d+)?\s*%)\s*\)/gu,
      (_full, approx: string | undefined, pct: string) => `${approx ? '약 ' : ''}${pct.replace(/\s+/g, '')}`,
    )
    // 2) 남은 긴 소수/말줄임표 숫자를 정리한다.
    .replace(/(-?\d+\.\d+)\s*(?:…|\.\.\.)/gu, (_full, num: string, offset: number, whole: string) => {
      const value = Number(num);
      if (!Number.isFinite(value)) return num;
      const before = whole.slice(Math.max(0, offset - 40), offset);
      if (Math.abs(value) < 1 && RATIO_LABEL_RE.test(before)) {
        return `${tidyDecimal(value * 100)}%`;
      }
      return tidyDecimal(value);
    })
    // 3) 말줄임표가 없더라도 소수 넷째 자리를 넘으면 읽기 어렵다.
    .replace(/(-?\d+\.\d{4,})(?!\d)/gu, (_full, num: string, offset: number, whole: string) => {
      const value = Number(num);
      if (!Number.isFinite(value)) return num;
      const before = whole.slice(Math.max(0, offset - 40), offset);
      if (Math.abs(value) < 1 && RATIO_LABEL_RE.test(before)) {
        return `${tidyDecimal(value * 100)}%`;
      }
      return tidyDecimal(value);
    });
}

// 자릿수가 큰 원화 총액은 자릿점만으로는 읽히지 않는다.
// 실측: "FCFF DCF 내재가치 972,992,820,105,704.6 (제공된 값)" → "약 973조 원".
export function normalizeOversizedAmounts(text: string): string {
  return text.replace(/(?<![\d.])\d{1,3}(?:,\d{3}){3,}(?:\.\d+)?/gu, raw => {
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value) || Math.abs(value) < 1e12) return raw;
    const jo = value / 1e12;
    return `약 ${jo >= 100 ? Math.round(jo) : Number(jo.toFixed(1))}조 원`;
  });
}

export function normalizeFinancialDisplayText(text: string) {
  if (typeof text !== 'string' || text.length === 0) return text;

  return normalizeNestedDebtRatioLabels(
    normalizeBrokenKoreanDecimalSeparators(
      normalizeKoreanEnglishRedundancy(
        normalizeDuplicateFinancialNumbers(
          normalizeBnToKorean(normalizeDebtPercentSequences(
            normalizeOversizedAmounts(normalizeTruncatedDecimals(humanizeRawFieldNames(
              stripLeakedSourceMarkers(stripPromptEcho(rejoinBrokenDecimals(text))),
            ))),
          )),
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
