/**
 * 섹션 분류가 '작성자가 붙인 구획'을 실제로 읽는지 확인한다.
 *
 * 실측(2026-08-30, 10회): 모델은 "…합리적입니다. ### 핵심 판단" 처럼 마침표 뒤에
 * 바로 헤딩을 붙여 쓴다. 줄머리 앵커로 헤딩을 찾던 코드는 이걸 한 번도 못 봤고,
 * 그래서 문서 구조가 있는데도 없는 것처럼 문장 키워드 추측으로 넘어갔다. 그러면
 * "DCF 가정이 흔들리면 …" 같은 리스크 문장이 밸류에이션 섹션에 빨려 들어가
 * 04(리스크와 반대 근거)가 통째로 빈다 — 10회 중 3회.
 *
 *   node scripts/check-section-split.mjs
 */
import { readFileSync } from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';

const toDataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const transpile = (path) => ts.transpileModule(readFileSync(path, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const normalizerUrl = toDataUrl(transpile(new URL('../src/lib/financial-text-normalizer.ts', import.meta.url)));
const H = await import(toDataUrl(
  transpile(new URL('../src/components/reports/analyst-report-v5/helpers.ts', import.meta.url))
    .replace(/from ['"]@\/lib\/financial-text-normalizer['"]/g, `from '${normalizerUrl}'`)
    .replace(/from ['"]@\/[^'"]+['"]/g, "from 'data:text/javascript,export default {};export const t=(k)=>k;'")
));

const failures = [];
const check = (name, condition, detail = '') => {
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const split = (reasoning, report = {}) =>
  H.splitReasoningIntoSections(reasoning, { agentReport: { reasoning, ...report }, language: 'ko' });

// ── 1. 줄 가운데 붙은 헤딩도 구획으로 읽는다 ────────────────────────────────
{
  const reasoning = [
    '에스케이하이닉스는 이익 확장 국면으로 판단됩니다.',
    '### 핵심 판단',
    '- DCF 내재가치는 2,506조 원으로 시가총액 1,173조 원을 웃돕니다.',
    '### 재무 위험(레버리지/리스크 관리 관점)',
    '- 환율 10% 변동 시 순이익 영향이 1조 2,103억 원으로 제시됩니다.',
    '- 선행 이익 추정의 신뢰도가 낮아 밸류에이션이 흔들릴 수 있습니다.',
  ].join(' ');   // ← 일부러 줄바꿈 없이 이어 붙인다. 실제 모델 출력이 이렇다.
  const sections = split(reasoning);
  check('줄 가운데 헤딩: 04 리스크가 채워져야 한다', Boolean(sections['section-04'].trim()),
    `section-04="${sections['section-04'].slice(0, 60)}"`);
  check('줄 가운데 헤딩: 리스크 본문이 04 로 가야 한다',
    sections['section-04'].includes('환율') || sections['section-04'].includes('신뢰도'),
    `section-04="${sections['section-04'].slice(0, 80)}"`);
}

// ── 2. 헤딩이 하나뿐이면 나머지 섹션을 비우지 않는다 ────────────────────────
{
  const reasoning = [
    '### 핵심 판단',
    'DCF 내재가치는 시가총액을 웃돕니다.',
    '선행 PER 4.0 과 TTM PER 29.1 의 괴리가 큽니다.',
    '다만 선행 이익 추정의 신뢰도가 낮아 하방 위험이 있습니다.',
    '원문 대조로 MD&A 의 사업 모델을 확인해야 합니다.',
  ].join(' ');
  const sections = split(reasoning);
  const filled = Object.entries(sections).filter(([, text]) => String(text || '').trim()).length;
  check('헤딩 1개: 문장 분류가 나머지를 메워야 한다', filled >= 3,
    `채워진 섹션 ${filled}개`);
}

// ── 3. 헤딩이 없어도 예전처럼 동작한다(회귀 방지) ───────────────────────────
{
  const reasoning = [
    'DCF 내재가치는 2,506조 원입니다.',
    '선행 EPS 는 410,174 원으로 제시됩니다.',
    '다만 사이클 하방 위험이 존재합니다.',
  ].join(' ');
  const sections = split(reasoning);
  check('헤딩 없음: 02 밸류에이션이 채워져야 한다', Boolean(sections['section-02'].trim()));
  check('헤딩 없음: 04 리스크가 채워져야 한다', Boolean(sections['section-04'].trim()));
}

// ── 4. 같은 섹션 제목이 두 번 나오면 이어 붙인다 ────────────────────────────
{
  const reasoning = [
    '### 리스크와 반대 근거', '- 환율 민감도가 있습니다.',
    '### 핵심 판단', '- 강세로 판단합니다.',
    '### 주요 불확실성(가치에 미치는 방향)', '- 선행 이익 추정이 흔들릴 수 있습니다.',
  ].join(' ');
  const sections = split(reasoning);
  check('같은 섹션 제목 2회: 앞 내용이 사라지면 안 된다',
    sections['section-04'].includes('환율') && sections['section-04'].includes('선행 이익'),
    `section-04="${sections['section-04'].slice(0, 100)}"`);
}

if (failures.length) {
  console.error('✗ 섹션 분류 점검 미달:');
  for (const failure of failures) console.error(`   · ${failure}`);
  process.exit(1);
}
console.log(`✓ 섹션 분류 점검 통과 (${4}개 항목)`);
