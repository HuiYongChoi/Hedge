/**
 * 본문에 영어·원시 필드명·중복 숫자가 남지 않는지 확인한다.
 *
 * 이건 반복해서 지적받은 결함이다. 그동안은 필드명을 하나씩 사전에 적어 왔고,
 * 그래서 에이전트가 새 지표를 하나 내보낼 때마다 그 이름이 그대로 화면에 샜다
 * (실측 2026-09-04: 한 보고서에 여섯 개가 동시에). 목록을 늘리는 방식으로는
 * 같은 일이 계속 반복되므로, 일반 규칙으로 바꾸고 그 규칙을 여기서 못 박는다.
 *
 *   node scripts/check-korean-prose.mjs
 */
import { readFileSync } from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';

const toDataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const transpile = (path) => ts.transpileModule(readFileSync(path, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const N = (await import(toDataUrl(
  transpile(new URL('../src/lib/financial-text-normalizer.ts', import.meta.url))
))).normalizeFinancialDisplayText;

// 실측 2026-09-04 보고서에서 그대로 뽑은 문장들.
const CASES = [
  ['원시 필드명(사전에 있음)', 'return_on_invested_capital 0.13(약 13.00%)', /ROIC/, /return_on/],
  ['원시 필드명(사전에 없음)', '재투자 수익성 축(unknown_new_metric)은 41.5점', null, /unknown_new_metric/],
  ['같은 수 두 번', 'TTM 영업 이익률 43%(약 42.75%), 순 이익률 35%(약 35.28%)', /43%/, /42\.75/],
  ['값이 붙은 필드명', 'TTM 매출 기준 revenue_growth_latest 10.88%', /매출 성장률/, /revenue_growth/],
  ['영어 낱말', '생애 주기의 long-run 관점', /장기/, /long-run/i],
  ['괄호가 영어로 되풀이', '선행 PER(선행 P/E)은 4.0이며', /선행 PER은/, /P\/E/],
  ['통화 코드', '62,656.6 KRW로 제시됩니다', /₩62,656/, /KRW/],
  ['마침표 뒤 붙은 문장', '참고 가능.다만 위험이', /가능\. 다만/, /능\.다/],
  ['숫자 뒤 붙은 문장', 'TTM PER 38.선행 PER 4.0는', /38\. 선행/, /38\.선/],
  ['같은 낱말 반복', '근거 근거는 AI를 강조합니다', /^근거는/, /근거 근거/],
  ['받침 안 맞는 조사', '서사 점검 판정가 "괴리"이며', /판정이/, /판정가/],
  ['받침 안 맞는 조사(로)', '단계 핵심 위험로 명시돼', /위험으로/, /위험로/],
];

const failures = [];
for (const [name, input, mustHave, mustNotHave] of CASES) {
  const out = N(input);
  if (mustHave && !mustHave.test(out)) failures.push(`${name}: 기대한 형태가 없음 → "${out}"`);
  if (mustNotHave && mustNotHave.test(out)) failures.push(`${name}: 결함이 남음 → "${out}"`);
}

if (failures.length) {
  console.error('✗ 본문 한국어 점검 미달:');
  for (const failure of failures) console.error(`   · ${failure}`);
  process.exit(1);
}
console.log(`✓ 본문 한국어 점검 통과 (${CASES.length}개 항목)`);
