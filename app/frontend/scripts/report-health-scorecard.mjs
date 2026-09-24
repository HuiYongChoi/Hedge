/**
 * 보고서 건전성 채점표.
 *
 * 기존 report-quality-rubric.mjs 는 '문장이 잘 쓰였는가'를 본다. 그런데
 * 2026-08-30 실측 사고는 문장 문제가 아니었다 — 모델이 signal 을 "중립" 이라고
 * 한국어로 돌려주는 바람에 스키마 검증이 3회 다 실패했고, 이미 완성돼 있던
 * 분석이 통째로 버려져 리포트의 절반이 "이 섹션에 적용할 데이터가 없습니다" 로
 * 나갔다. 문장 채점은 거기서 만점이 나온다. 볼 것이 없으니까.
 *
 * 그래서 이 채점표는 '보고서가 실제로 나왔는가'를 본다. 입력은 저장된 분석
 * 결과(result_data JSON) 그대로다.
 *
 *   node scripts/report-health-scorecard.mjs <result_data.json…>
 *
 * 섹션 분류는 화면이 쓰는 함수(splitReasoningIntoSections)를 그대로 불러 쓴다.
 * 여기에 따로 구현하면 화면과 채점이 갈라져, 채점 만점이 화면 품질을 뜻하지
 * 않게 된다.
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

// ── 실측 사고에서 나온 표식들 ────────────────────────────────────────────────
/** 분석이 버려졌을 때만 나오는 문장. 하나라도 보이면 그 보고서는 실패작이다. */
const FALLBACK_MARKERS = [
  '분석 중 오류가 발생하여',
  '모델 응답을 신뢰 가능한 구조로 파싱하지 못했습니다',
  '자동 fallback 결과이므로',
  '모델 응답 실패로',
  '구조화된 최종 주문 응답을 받지 못해',
];
/** 스키마가 정한 값. 여기에 없는 값이 오면 그 자리에서 분석이 버려진다. */
const SIGNAL_VALUES = new Set(['bullish', 'bearish', 'neutral']);
const ACTION_VALUES = new Set(['buy', 'sell', 'short', 'cover', 'hold']);

/**
 * 6개 섹션을 모두 채워야 하는 에이전트.
 *
 * v5 리포트는 선택된 분석가의 보고서를 '문서'로 렌더한다. 그런데 모든 에이전트가
 * 6개 섹션짜리 문서를 쓰는 것은 아니다 — 뉴스 감성은 기사 집계 지표만 내고,
 * 리스크 관리는 한도 계산만 낸다. 그런 에이전트에 6개 섹션을 요구하면 매 라운드
 * 가짜 감점이 나고, 그 소음 속에 진짜 결함이 다시 묻힌다.
 *
 * 여기 적힌 에이전트가 '이 채점표가 보증하는 범위'다. 넓히려면 그 에이전트가
 * 실제로 6개 섹션을 채우게 만든 뒤 이 목록에 추가한다. (2026-08-30 기준 실측:
 * valuation_analyst 는 04 리스크가, news_sentiment 는 전 섹션이 비어 있다.)
 */
const DOCUMENT_AGENTS = new Set(['aswath_damodaran']);

function agentAnalyses(payload) {
  const out = [];
  for (const result of payload.agentResults || []) {
    const analysis = result.analysis;
    if (!analysis || typeof analysis !== 'object') continue;
    for (const [ticker, view] of Object.entries(analysis)) {
      if (view && typeof view === 'object') out.push({ agent: result.agentKey, ticker, view, result });
    }
  }
  return out;
}

function reasoningOf(view) {
  const r = view.reasoning;
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') return JSON.stringify(r);
  return '';
}

// ── 채점 항목 ────────────────────────────────────────────────────────────────
const RUBRIC = [
  {
    id: 'no-fallback', w: 22,
    label: '분석이 버려지지 않음 (fallback 본문 없음)',
    check(p) {
      return agentAnalyses(p)
        .filter(a => FALLBACK_MARKERS.some(m => reasoningOf(a.view).includes(m)))
        .map(a => `${a.agent}: 분석이 fallback 으로 대체됨`);
    },
  },
  {
    id: 'confidence', w: 14,
    label: '완료된 에이전트의 신뢰도가 0 이 아님',
    check(p) {
      // 판단을 내는 에이전트만 본다. 리스크 관리 노드는 신뢰도를 내지 않는다.
      return agentAnalyses(p)
        .filter(a => a.result.status === 'complete' && a.view.signal !== undefined
          && (a.view.confidence === 0 || a.view.confidence === null || a.view.confidence === undefined))
        .map(a => `${a.agent}: 신뢰도 ${a.view.confidence}`);
    },
  },
  {
    id: 'enum', w: 10,
    label: '판단 값이 스키마 값 (한국어 열거형 누출 없음)',
    check(p) {
      const bad = agentAnalyses(p)
        .filter(a => a.view.signal !== undefined && !SIGNAL_VALUES.has(String(a.view.signal)))
        .map(a => `${a.agent}: signal="${a.view.signal}"`);
      for (const [ticker, d] of Object.entries(p.completeResult?.decisions || {})) {
        if (d && d.action !== undefined && !ACTION_VALUES.has(String(d.action))) {
          bad.push(`decision ${ticker}: action="${d.action}"`);
        }
      }
      return bad;
    },
  },
  {
    id: 'sections', w: 14,
    label: '보고서 6개 섹션이 비지 않음',
    check(p) {
      const misses = [];
      for (const a of agentAnalyses(p)) {
        if (!DOCUMENT_AGENTS.has(a.agent)) continue;
        const sections = H.splitReasoningIntoSections(reasoningOf(a.view), {
          agentReport: a.view, language: 'ko',
        });
        const empty = Object.entries(sections)
          .filter(([, text]) => !String(text || '').trim())
          .map(([id]) => id);
        if (empty.length) misses.push(`${a.agent}: 빈 섹션 ${empty.join(', ')}`);
      }
      return misses;
    },
  },
  {
    id: 'agents-complete', w: 12,
    label: '모든 에이전트가 오류 없이 완료',
    check(p) {
      return (p.agentResults || [])
        .filter(r => r.status && r.status !== 'complete')
        .map(r => `${r.agentKey}: status=${r.status}${r.message ? ` (${r.message})` : ''}`);
    },
  },
  {
    id: 'intrinsic', w: 8,
    label: '내재가치가 산출됨',
    check(p) {
      const damo = agentAnalyses(p).find(a => a.agent === 'aswath_damodaran');
      if (!damo) return [];
      const iv = damo.view.intrinsic_value_per_share;
      return typeof iv === 'number' && isFinite(iv) && iv > 0 ? [] : ['다모다란: 내재가치 없음'];
    },
  },
  {
    id: 'margin-basis', w: 8,
    label: '안전마진에 분자·분모가 함께 실림',
    check(p) {
      const damo = agentAnalyses(p).find(a => a.agent === 'aswath_damodaran');
      if (!damo) return [];
      // '값이 없으면 통과'로 두면 아무것도 안 내보낸 보고서가 만점을 받는다.
      // 안 내보낸 것이야말로 이 채점표가 잡아야 할 상태다.
      if (typeof damo.view.margin_of_safety !== 'number') {
        return ['다모다란: 안전마진이 아예 없음'];
      }
      const basis = damo.view.margin_of_safety_basis;
      return basis && typeof basis.intrinsic_value === 'number' && typeof basis.market_cap === 'number'
        ? []
        : ['다모다란: 안전마진의 분자(내재가치)·분모(시가총액)가 없어 화면에서 검산 불가'];
    },
  },
  {
    id: 'forward-dcf', w: 12,
    label: '선행 컨센서스가 있으면 선행 DCF 도 나옴',
    check(p) {
      const damo = agentAnalyses(p).find(a => a.agent === 'aswath_damodaran');
      if (!damo) return [];
      const fwd = damo.view.forward_intrinsic_value_per_share;
      if (typeof fwd === 'number' && isFinite(fwd) && fwd > 0) {
        return typeof damo.view.forward_margin_of_safety === 'number'
          ? []
          : ['다모다란: 선행 내재가치는 있는데 선행 안전마진이 없음'];
      }
      // 못 냈으면 왜 못 냈는지가 화면까지 가야 한다. 빈칸만 남기면 독자는
      // '값이 0인지, 계산을 안 한 건지'를 구분할 방법이 없다.
      return damo.view.forward_intrinsic_value_note
        ? []
        : ['다모다란: 선행 DCF 값도, 미산출 사유도 없음'];
    },
  },
];

const TOTAL = RUBRIC.reduce((sum, item) => sum + item.w, 0);

let allClean = true;
for (const file of process.argv.slice(2)) {
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  let score = 0;
  const lines = [];
  for (const item of RUBRIC) {
    const misses = item.check(payload) || [];
    if (misses.length === 0) {
      score += item.w;
      lines.push(`  ✓ ${item.label} (${item.w})`);
    } else {
      allClean = false;
      lines.push(`  ✗ ${item.label} (0/${item.w})`);
      for (const miss of misses.slice(0, 5)) lines.push(`      · ${miss}`);
      if (misses.length > 5) lines.push(`      · … 외 ${misses.length - 5}건`);
    }
  }
  const verdict = score === TOTAL ? '★ 만점' : `미달: ${score}/${TOTAL}`;
  console.log(`${file}\n${lines.join('\n')}\n  → ${score}/${TOTAL}  ${verdict}\n`);
}
process.exit(allClean ? 0 : 1);
