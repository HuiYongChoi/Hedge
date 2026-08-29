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

// 채점 대상 텍스트. 카드 파싱 뒤 채워진다.
const MISSING_HEADINGS = [];
const HEADINGS = [];
let BODY_ONLY = '';

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
  // 인용문이 문단의 40% 를 넘으면 쪼갤 수 없다(인용 안에서 끊으면 원문이 깨진다).
  { id: 'longline',    w: 6,  label: '줄바꿈 없이 250자 넘는 문단',
    test: text => text.split('\n')
      .filter(l => {
        if (l.trim().length <= 250) return false;
        const quoted = (l.match(/["“][^"”]*["”]/g) || []).join('').length;
        return quoted <= l.length * 0.4;
      })
      .map(l => l.slice(0, 90) + '…') },
  { id: 'stubbody',    w: 10, label: '본문이 조각뿐 ("입니다." 만 남음)',
    test: text => text.split('\n').map(l => l.trim())
      .filter(l => /^(?:입니다|임|이다|합니다)\s*[.。]?$/u.test(l)) },
  { id: 'homework',    w: 12, label: '독자에게 남긴 숙제 (확인 필요 / 체크리스트)',
    bad: /(?:확인\s*필요|위치를?\s*확인|체크리스트|원문\s*대조)\s*[.。]?/g },
  { id: 'awkward',     w: 6,  label: '어색한 이음말 ("낮음 입니다")',
    bad: /(?:낮음|높음|없음|있음)\s+(?:입니다|이다|임)/g },
  { id: 'doubleend',   w: 6,  label: '종결어미 중첩 ("…했습니다 입니다")',
    bad: /(?:습니다|합니다|됩니다|입니다)\s+입니다/g },
  { id: 'countany',    w: 12, label: '개수 표기 (라벨이 무엇이든 "= 2 / … = 3")',
    bad: /(?:점검|항목|checks?)[^=\n]{0,12}=\s*\d+\s*\/\s*[^=\n]{0,16}=\s*\d+/g },
  { id: 'repeatline',  w: 14, label: '같은 문장이 보고서에서 두 번 이상',
    test: text => {
      const seen = new Map();
      for (const line of text.split('\n')) {
        const key = line.replace(/[\s"'“”‘’.,·]/gu, '').trim();
        if (key.length < 12) continue;
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${n}회: ${k.slice(0, 50)}`);
    } },
  { id: 'noheading',   w: 12, label: '제목 없는 카드',
    test: () => MISSING_HEADINGS },
  { id: 'dottedfield', w: 12, label: '점으로 이어진 필드 경로 (life_cycle.key_risk_ko)',
    bad: /[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*|[가-힣]\.[가-힣]/g },
  { id: 'headcut',    w: 12, label: '제목이 기호·여는 괄호로 끝남 ("핵심 판단 - [")',
    // 콜론 종결은 라벨형 제목으로 정상이다. 여는 괄호·이음표만 결함으로 본다.
    test: () => HEADINGS.filter(h => /[-–—([{<,、／]\s*$/u.test(h)) },
  { id: 'listbreak',  w: 10, label: '번호 목록이 한 줄에 뭉쳐 있음 ("(1)… (2)… (3)…")',
    test: text => text.split('\n')
      .filter(l => (l.match(/\(\d\)/g) || []).length >= 2)
      .map(l => l.slice(0, 80) + '…') },
  { id: 'abbrev',     w: 8,  label: '한국어로 풀 수 있는 약어 (2H, YoY, QoQ)',
    bad: /(?<![A-Za-z])(?:[12]H|H[12]|YoY|QoQ|FY\d{0,2})(?![A-Za-z])/g },
  { id: 'decimalsplit', w: 12, label: '소수점에서 문장이 잘림 ("206." / "12로 …")',
    bad: /\d+\.\s*$|^\s*\d{1,3}(?:로|으로|이|가|은|는)\s/gm },
  { id: 'noisyratio', w: 6,  label: '배율의 불필요한 소수 둘째 자리 (206.12)',
    bad: /(?:배율|비율)\s*\d+\.\d{2,}/g },
  { id: 'brokenmark', w: 8,  label: '깨진 마커 ("[!", "- [!")',
    bad: /\[!|\[\s*$/g },
  // 인용부호 안 영어는 원문(근거)이므로 세지 않는다 — 번역 병기 규칙이 따로 담당한다.
  // 서술 문장에 섞인 영어만 잡는다.
  { id: 'englishword', w: 8, label: '서술에 남은 영어 낱말 (playbook, low, figure)',
    test: text => {
      const outside = text.replace(/["“][^"”]*["”]/g, ' ');
      return [...new Set(outside.match(/\b(?:playbook|low|high|figure|terminal growth|confidence)\b/gi) || [])];
    } },
  // 결론(01)은 요약이라 요지를 한 번 되풀이하는 것이 정상이다. 본문끼리의 반복만 센다.
  { id: 'dupclaim',    w: 6,  label: '본문 카드 간 같은 주장 반복 (DCF 대비 %, 선행 PER vs TTM)',
    test: () => {
      const text = BODY_ONLY;
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
const parsedBySection = H.dedupeRepeatedClaimSentences(H.dedupeEvidenceItemsAcrossReport(
  deduped.map(section => H.parseEvidenceItems(section)),
));
const sectionsOut = parsedBySection
  .map(items => {
    // 카드가 모두 걸러지면 화면에도 아무것도 안 나온다(빈 섹션 안내만).
    // 원문으로 되돌리면 실제 화면과 달라져 채점이 무의미해진다.
    // 화면은 본문을 읽기 좋은 덩어리로 나눠 문단마다 렌더한다. 채점도 같게 본다.
    items.forEach(i => {
      if (i.heading && i.heading.trim()) HEADINGS.push(i.heading.trim());
      if (!i.heading || !i.heading.trim()) {
        MISSING_HEADINGS.push((i.body || i.rawText || '').slice(0, 60));
      }
    });
    return items
      .map(i => [i.heading, ...H.splitEvidenceBodyBlocks(i.body || '')].filter(Boolean).join('\n'))
      .join('\n');
  })
  .filter(Boolean);
BODY_ONLY = sectionsOut.slice(1).join('\n\n');

const out = sectionsOut.join('\n\n');
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
