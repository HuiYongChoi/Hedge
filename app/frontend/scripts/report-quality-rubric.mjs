/**
 * 보고서 품질 채점표.
 *
 * 사용자가 실제 배포본에서 지적한 결함을 그대로 규칙으로 옮겼다.
 * 각 항목은 배점을 갖고, 실패하면 해당 문장을 함께 보여 준다.
 * 목표는 100점 — 감점이 하나도 없는 상태.
 */
import { readFileSync } from 'node:fs';
import ts from '../node_modules/typescript/lib/typescript.js';

const toDataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const transpile = (path) => ts.transpileModule(readFileSync(path, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

// helpers.ts 는 '@/lib/...' 별칭으로 정규화기를 가져온다. Node 는 별칭을 모르므로
// 정규화기를 먼저 data URL 로 만들고 그 주소로 바꿔 끼운다.
const normalizerUrl = toDataUrl(transpile(new URL('../src/lib/financial-text-normalizer.ts', import.meta.url)));
const N = (await import(normalizerUrl)).normalizeFinancialDisplayText;
const H = await import(toDataUrl(
  transpile(new URL('../src/components/reports/analyst-report-v5/helpers.ts', import.meta.url))
    .replace(/from ['"]@\/lib\/financial-text-normalizer['"]/g, `from '${normalizerUrl}'`)
    .replace(/from ['"]@\/[^'"]+['"]/g, "from 'data:text/javascript,export default {};export const t=(k)=>k;'")
));

const RUBRIC = [
  { id: 'marker',      w: 12, label: '근거 마커 누출 ([#+], [+], [~])',
    bad: /\[#?[+\-~?]\]/g },
  { id: 'meta',        w: 12, label: '원시 메타데이터 누출 (period:, report period:)',
    bad: /\b(?:report\s+)?period\s*[:：]/gi },
  { id: 'rawfield',    w: 12, label: '원시 필드명 (base_fcff, gross_margin 등)',
    bad: /\b[a-z]{3,}(?:_[a-z]{2,})+\b/g },
  { id: 'bold',        w: 8,  label: '강조 기호(**) 노출',
    bad: /\*\*/g },
  { id: 'dangling',    w: 14, label: '문장이 끝나지 않음 (…지만 / …되지만, 으로 종료)',
    bad: /(?:지만|되지만|이지만|하지만|으나|는데)\s*[,，]?\s*$/gmu },
  { id: 'countonly',   w: 10, label: '점검 항목 수만 제시 (무엇을 점검했는지 없음)',
    bad: /점검한?\s*항목\s*수\s*=|항목\s*수\s*=\s*\d+\s*\/\s*전체/g },
  { id: 'englishhead', w: 8,  label: '제목의 불필요한 영어 (Alignment 등)',
    bad: /\b(?:Alignment|Story|Numbers|Value|Management)\b/g },
  { id: 'orphan',      w: 12, label: '괄호/조각으로 시작하거나 끝나는 줄',
    bad: /^\s*\(\s*\w+\s*$|^\s*[A-Za-z]+\s*[,，]\s*$/gmu },
  { id: 'longline',    w: 6,  label: '줄바꿈 없이 250자 넘는 문단',
    test: text => text.split('\n').filter(l => l.trim().length > 250).map(l => l.slice(0, 90) + '…') },
  { id: 'stubbody',    w: 10, label: '본문이 조각뿐 ("입니다." 만 남음)',
    test: text => text.split('\n').map(l => l.trim())
      .filter(l => /^(?:입니다|임|이다|합니다)\s*[.。]?$/u.test(l)) },
  { id: 'homework',    w: 12, label: '독자에게 남긴 숙제 (확인 필요 / 체크리스트)',
    bad: /(?:확인\s*필요|위치를?\s*확인|체크리스트|원문\s*대조)\s*[.。]?/g },
  { id: 'awkward',     w: 6,  label: '어색한 이음말 ("낮음 입니다")',
    bad: /(?:낮음|높음|없음|있음)\s+(?:입니다|이다|임)/g },
  { id: 'doubleend',   w: 6,  label: '종결어미 중첩 ("…했습니다 입니다")',
    bad: /(?:습니다|합니다|됩니다|입니다)\s+입니다/g },
  { id: 'dupclaim',    w: 6,  label: '카드 간 같은 주장 반복 (DCF 대비 %, 선행 PER vs TTM)',
    test: text => {
      const hits = [];
      const dcf = text.match(/DCF\s*(?:대비|기준)[^.\n]{0,60}?\d+\s*%/g) || [];
      const per = text.match(/선행\s*PER[^.\n]{0,60}?TTM/g) || [];
      if (dcf.length > 1) hits.push(`DCF 대비 % 서술 ${dcf.length}회`);
      if (per.length > 1) hits.push(`선행 PER vs TTM 서술 ${per.length}회`);
      return hits;
    } },
];

const raw = readFileSync(process.argv[2], 'utf8');
// report-body.tsx 와 같은 순서로 돌린다:
// 섹션별 중복 제거 → 반복 주장 제거 → 카드 파싱 → 제목/본문 표시.
const sections = raw.split(/\n\s*\n/).filter(b => b.trim());
const deduped = H.dedupePerGapComparisons(H.dedupeSentencesAcrossSections(sections));
const out = deduped
  .map(section => {
    const items = H.parseEvidenceItems(section);
    // 카드가 모두 걸러지면 화면에도 아무것도 안 나온다(빈 섹션 안내만).
    // 원문으로 되돌리면 실제 화면과 달라져 채점이 무의미해진다.
    // 화면은 본문을 읽기 좋은 덩어리로 나눠 문단마다 렌더한다. 채점도 같게 본다.
    return items
      .map(i => [i.heading, ...H.splitEvidenceBodyBlocks(i.body || '')].filter(Boolean).join('\n'))
      .join('\n');
  })
  .filter(Boolean)
  .join('\n\n');

let earned = 0, total = 0;
const failures = [];
for (const rule of RUBRIC) {
  total += rule.w;
  const hits = rule.test ? rule.test(out) : [...new Set((out.match(rule.bad) || []))];
  if (hits.length === 0) { earned += rule.w; console.log(`  ✓ [${String(rule.w).padStart(2)}점] ${rule.label}`); }
  else {
    failures.push(rule.id);
    console.log(`  ✗ [ 0/${String(rule.w).padStart(2)}점] ${rule.label}`);
    hits.slice(0, 4).forEach(h => console.log(`        → ${String(h).replace(/\n/g, ' ').slice(0, 110)}`));
  }
}
console.log(`\n  점수: ${earned} / ${total}` + (earned === total ? '  ★ 만점' : `  (미달: ${failures.join(', ')})`));
process.exit(earned === total ? 0 : 1);
