// 매수 후보 판정을 쉬운 말로 풀어 보여 준다.
//  · VerdictBreakdown — 종목 하나: 우량 판정의 실제 수치와 기준, 가치평가 모델별 주당 적정가·반영 비중·계산 과정
//  · MethodGuide — 판정 방법 전체: 두 질문, 모델별 산식, 합치는 방법, 판정 문턱
// 수치 기준은 백엔드와 같아야 한다: src/agents/fundamentals.py(우량 기준), src/agents/valuation.py(모델·가중치·이상치),
// src/screener/quality_buy.py(판정 문턱 +15% / −10%).

import { cn } from '@/lib/utils';
import type { ScreenerResult, ScreenerVerdict } from '@/services/screener-api';
import { Check, ChevronDown, Info, Minus, X } from 'lucide-react';

type Lang = 'ko' | 'en';

export interface ModelInfo {
  ko: string;
  en: string;
  /** 한 줄 설명 */
  koWhat: string;
  enWhat: string;
  /** 산식(쉬운 표기) */
  formula: string;
}

export const MODEL_INFO: Record<string, ModelInfo> = {
  dcf: {
    ko: '현금흐름 할인 (DCF)',
    en: 'Discounted cash flow (DCF)',
    koWhat: '회사가 앞으로 벌어들일 잉여현금흐름(FCF)을 추정하고, 미래의 돈을 오늘 가치로 깎아(할인) 더한 값',
    enWhat: 'Estimate future free cash flow and discount it back to today',
    formula: 'Σ 5년 FCF × (1+성장률)ᵗ ÷ (1+할인율)ᵗ + 그 이후 가치(영구성장)',
  },
  owner_earnings: {
    ko: '오너 어닝 (버핏식)',
    en: 'Owner earnings (Buffett)',
    koWhat: '주주가 실제로 가져갈 수 있는 돈을 5년 키워 요구수익률 15%로 할인하고, 안전마진 25%를 뺀 값',
    enWhat: 'Cash owners can actually take out, grown 5 years, discounted at 15%, less a 25% margin of safety',
    formula: '(순이익 + 감가상각 − 설비투자 − 운전자본 증가) → 5년 할인 합 × 0.75',
  },
  ev_ebitda: {
    ko: 'EV/EBITDA 배수',
    en: 'EV/EBITDA multiple',
    koWhat: '이 회사가 과거에 받던 "기업가치 ÷ 영업현금이익" 배수를 지금 이익에 곱하고 순부채를 뺀 값',
    enWhat: "This company's historical EV/EBITDA multiple applied to current EBITDA, less net debt",
    formula: '현재 EBITDA × 과거 배수(중앙값) − 순부채',
  },
  ev_ebit: {
    ko: 'EV/EBIT 배수',
    en: 'EV/EBIT multiple',
    koWhat: 'EV/EBITDA와 같지만 감가상각을 비용으로 보는 영업이익 기준 — 설비가 많은 회사에 더 보수적',
    enWhat: 'Like EV/EBITDA but on operating profit (after depreciation) — more conservative for capital-heavy firms',
    formula: '현재 영업이익 × 과거 배수 − 순부채',
  },
  residual_income: {
    ko: '잔여이익 (RIM)',
    en: 'Residual income (RIM)',
    koWhat: '장부가치에, 자기자본 비용을 넘어 벌어들이는 초과이익의 미래 합을 더한 값(안전마진 20%)',
    enWhat: 'Book value plus the present value of profits above the cost of equity (20% margin of safety)',
    formula: '(자기자본 + Σ (순이익 − 자본비용 × 자기자본) 할인 합) × 0.8',
  },
  pbr_band: {
    ko: 'PBR 밴드',
    en: 'P/B band',
    koWhat: '과거에 주가가 순자산의 몇 배에 거래됐는지(가운데 값)를 지금 순자산에 곱한 값',
    enWhat: 'Historical median price-to-book applied to current book value',
    formula: '주당순자산 × 과거 PBR 중앙값',
  },
  ebitda_valuation: {
    ko: '정상화 EBITDA',
    en: 'Normalized EBITDA',
    koWhat: '여러 해 이익을 평균 내 경기 영향을 줄이고 1년 성장을 반영한 뒤 목표 배수를 곱한 값',
    enWhat: 'Multi-year average EBITDA (cycle-smoothed) plus one year of growth, times a target multiple',
    formula: '평균 EBITDA × (1+성장률) × 목표 배수 − 순부채',
  },
  roic_wacc_valuation: {
    ko: 'ROIC − WACC (경제적 부가가치)',
    en: 'ROIC − WACC (EVA)',
    koWhat: '투자한 자본에, 투자수익률이 자본비용을 넘는 만큼의 초과이익을 더한 값(안전마진 20%)',
    enWhat: 'Invested capital plus the value of returns above the cost of capital (20% margin of safety)',
    formula: '(투자자본 + Σ (ROIC − WACC) × 투자자본 할인 합 − 순부채) × 0.8',
  },
};

// 일반 기업 / 설비투자가 매출에 비해 큰 기업(반도체·소재 등) — src/agents/valuation.py base_weights
const WEIGHTS: { key: string; normal: number; capexHeavy: number }[] = [
  { key: 'dcf', normal: 23, capexHeavy: 15 },
  { key: 'owner_earnings', normal: 22, capexHeavy: 18 },
  { key: 'pbr_band', normal: 11, capexHeavy: 10 },
  { key: 'ebitda_valuation', normal: 10, capexHeavy: 10 },
  { key: 'roic_wacc_valuation', normal: 10, capexHeavy: 10 },
  { key: 'ev_ebitda', normal: 9, capexHeavy: 12 },
  { key: 'ev_ebit', normal: 8, capexHeavy: 10 },
  { key: 'residual_income', normal: 7, capexHeavy: 15 },
];

type AxisKey = 'profitability' | 'growth' | 'financial_health';

interface Criterion {
  label: string;
  ko: string;
  en: string;
  /** 기준 표기 */
  rule: string;
  pass: (v: number) => boolean;
  percent: boolean;
}

// src/agents/fundamentals.py 의 문턱. 항목마다 기준을 넘는 수치가 2개 이상이면 '강함', 0개면 '약함'.
const AXIS_CRITERIA: Record<AxisKey, { ko: string; en: string; criteria: Criterion[]; koNote?: string; enNote?: string }> = {
  profitability: {
    ko: '수익성',
    en: 'Profitability',
    criteria: [
      { label: 'ROE', ko: 'ROE(자기자본이익률)', en: 'ROE', rule: '> 15%', pass: v => v > 0.15, percent: true },
      { label: 'Net Margin', ko: '순이익률', en: 'Net margin', rule: '> 20%', pass: v => v > 0.2, percent: true },
      { label: 'Op Margin', ko: '영업이익률', en: 'Operating margin', rule: '> 15%', pass: v => v > 0.15, percent: true },
    ],
  },
  growth: {
    ko: '성장',
    en: 'Growth',
    criteria: [
      { label: 'Revenue Growth', ko: '매출 성장률', en: 'Revenue growth', rule: '> 10%', pass: v => v > 0.1, percent: true },
      { label: 'Earnings Growth', ko: '이익 성장률', en: 'Earnings growth', rule: '> 10%', pass: v => v > 0.1, percent: true },
    ],
    koNote: '자기자본 성장률 > 10% 도 함께 셉니다(화면에는 수치가 나오지 않음).',
    enNote: 'Book-value growth > 10% also counts (value not shown).',
  },
  financial_health: {
    ko: '재무건전성',
    en: 'Balance sheet',
    criteria: [
      { label: 'Current Ratio', ko: '유동비율', en: 'Current ratio', rule: '> 1.5', pass: v => v > 1.5, percent: false },
      { label: 'D/E', ko: '부채비율(부채÷자본)', en: 'Debt / equity', rule: '< 0.5', pass: v => v < 0.5, percent: false },
    ],
    koNote: '잉여현금흐름이 주당순이익의 80%를 넘는지도 함께 셉니다.',
    enNote: 'Free cash flow above 80% of EPS also counts.',
  },
};

function parseDetails(details: string | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!details) return out;
  for (const part of details.split(',')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (raw === 'N/A') {
      out[key] = null;
      continue;
    }
    const n = parseFloat(raw.replace('%', ''));
    out[key] = Number.isFinite(n) ? (raw.endsWith('%') ? n / 100 : n) : null;
  }
  return out;
}

function money(v: number | null | undefined, market: 'KR' | 'US'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return market === 'KR'
    ? `₩${Math.round(v).toLocaleString('ko-KR')}`
    : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(v: number | null | undefined, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const p = v * 100;
  return `${signed && p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function signalText(signal: string | null | undefined, lang: Lang): { text: string; cls: string } {
  if (signal === 'bullish') return { text: lang === 'ko' ? '강함' : 'Strong', cls: 'text-emerald-600 dark:text-emerald-400' };
  if (signal === 'bearish') return { text: lang === 'ko' ? '약함' : 'Weak', cls: 'text-rose-600 dark:text-rose-400' };
  if (signal === 'neutral') return { text: lang === 'ko' ? '보통' : 'Neutral', cls: 'text-amber-600 dark:text-amber-400' };
  return { text: lang === 'ko' ? '데이터 없음' : 'No data', cls: 'text-muted-foreground' };
}

function verdictRule(verdict: ScreenerVerdict, lang: Lang): string {
  const ko = lang === 'ko';
  switch (verdict) {
    case 'buy': return ko ? '우량 통과 + 괴리 +15% 초과 → 매수 후보' : 'Quality + gap above +15% → buy candidate';
    case 'watch': return ko ? '우량 통과 + 괴리 −10% ~ +15% → 관심 후보' : 'Quality + gap −10% to +15% → watchlist';
    case 'quality_expensive': return ko ? '우량 통과 + 괴리 −10% 미만 → 우량 · 비쌈' : 'Quality + gap below −10% → quality · expensive';
    case 'quality_no_value': return ko ? '우량 통과, 적정가 계산 불가' : 'Quality, but no fair value';
    case 'financial': return ko ? '금융업 — 이 모델들이 맞지 않아 따로 판단' : 'Financials — judged separately';
    case 'not_quality': return ko ? '우량 기준 미달(강함 2개 이상 · 약함 0개 필요)' : 'Below quality bar (needs 2 strong, 0 weak)';
    default: return ko ? '재무 데이터 부족' : 'Insufficient data';
  }
}

/** 종목 하나의 판정 근거. */
export function VerdictBreakdown({ result, lang }: { result: ScreenerResult; lang: Lang }) {
  const ko = lang === 'ko';
  const q = result.quality;
  const models = [...(result.value.models ?? [])].sort((a, b) => b.share - a.share || (a.excluded ? 1 : -1));
  const price = result.value.price_per_share ?? null;

  return (
    <div className="mt-1 space-y-3 rounded border border-border/60 bg-muted/10 p-3 text-[11px]">
      {/* ① 우량한가 */}
      <div>
        <div className="mb-1.5 font-semibold text-foreground">
          {ko ? '① 우량한가' : '① Quality'}
          <span className="ml-2 font-normal text-muted-foreground">
            {ko ? '세 항목 중 "강함" 2개 이상, "약함" 0개면 통과' : 'Pass with 2+ strong and no weak axes'}
            {q && (
              <span className={cn('ml-2 font-medium', q.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                {ko ? `강함 ${q.bullish} · 약함 ${q.bearish} → ${q.passed ? '통과' : '미달'}` : `${q.bullish} strong · ${q.bearish} weak → ${q.passed ? 'pass' : 'fail'}`}
              </span>
            )}
          </span>
        </div>
        {!q ? (
          <div className="text-muted-foreground">{ko ? '재무 데이터가 부족해 판정하지 못했습니다.' : 'Not enough financial data.'}</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {(Object.keys(AXIS_CRITERIA) as AxisKey[]).map(axis => {
              const spec = AXIS_CRITERIA[axis];
              const sig = signalText(q[axis], lang);
              const values = parseDetails(q.details?.[axis]);
              return (
                <div key={axis} className="rounded border border-border/60 bg-background/60 p-2">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="font-medium">{ko ? spec.ko : spec.en}</span>
                    <span className={cn('font-medium', sig.cls)}>{sig.text}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {spec.criteria.map(c => {
                      const v = values[c.label];
                      const has = v !== undefined && v !== null;
                      const ok = has && c.pass(v as number);
                      return (
                        <li key={c.label} className="flex items-center justify-between gap-2 tabular-nums">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {!has ? <Minus size={10} /> : ok ? <Check size={10} className="text-emerald-500" /> : <X size={10} className="text-rose-500" />}
                            {ko ? c.ko : c.en} <span className="opacity-70">{c.rule}</span>
                          </span>
                          <span>{has ? (c.percent ? pct(v as number, false) : (v as number).toFixed(2)) : (ko ? '없음' : 'n/a')}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {(ko ? spec.koNote : spec.enNote) && (
                    <div className="mt-1 text-[10px] text-muted-foreground">{ko ? spec.koNote : spec.enNote}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ② 지금 싼가 */}
      <div>
        <div className="mb-1.5 font-semibold text-foreground">
          {ko ? '② 지금 싼가 — 가치평가 모델별 적정가' : '② Cheap now — fair value by model'}
        </div>
        {models.length === 0 ? (
          <div className="text-muted-foreground">
            {q && !q.passed && result.verdict !== 'financial'
              ? (ko ? '우량 기준을 통과하지 못해 가치평가는 계산하지 않았습니다(판정이 바뀌지 않음).' : 'Valuation skipped — the quality bar was not met.')
              : (ko ? '모델별 내역이 없습니다. 이전 스캔 결과이거나 적정가를 계산하지 못했습니다 — 새로 스캔하면 표시됩니다.' : 'No per-model detail (older scan or no valuation). Rescan to see it.')}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full tabular-nums">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-normal">{ko ? '방법' : 'Method'}</th>
                    <th className="py-1 pr-3 text-right font-normal">{ko ? '주당 적정가' : 'Fair value / sh'}</th>
                    <th className="py-1 pr-3 text-right font-normal">{ko ? '현재가 대비' : 'vs price'}</th>
                    <th className="py-1 text-right font-normal">{ko ? '반영 비중' : 'Weight in blend'}</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map(m => {
                    const info = MODEL_INFO[m.key];
                    return (
                      <tr key={m.key} className={cn('border-t border-border/40', m.excluded && 'text-muted-foreground')}>
                        <td className="py-1 pr-3" title={info ? `${ko ? info.koWhat : info.enWhat}\n${info.formula}` : undefined}>
                          <span className={cn(!m.excluded && 'text-foreground', 'cursor-help underline decoration-dotted underline-offset-2')}>
                            {info ? (ko ? info.ko : info.en) : m.key}
                          </span>
                        </td>
                        <td className="py-1 pr-3 text-right">{money(m.per_share, result.market)}</td>
                        <td className={cn('py-1 pr-3 text-right', !m.excluded && (m.gap > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'))}>
                          {pct(m.gap)}
                        </td>
                        <td className="py-1 text-right">
                          {m.excluded
                            ? (ko ? '제외 — 다른 방법들과 3배 넘게 차이' : 'Excluded — 3×+ off the others')
                            : pct(m.share, false)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {result.warnings?.includes('tech_valuation') && (
              <div className="mt-2 flex gap-1.5 rounded border border-sky-500/40 bg-sky-500/5 p-2 leading-relaxed">
                <Info size={12} className="mt-0.5 shrink-0 text-sky-500" />
                <span>
                  {ko
                    ? '기술·커뮤니케이션 업종이라 아래 괴리는 참고만 하세요. S&P 500 과거 10년 검증에서 이 업종의 괴리는 이후 12개월 수익을 거의 맞히지 못했고, "우량 · 비쌈" 종목도 평균적으로 지수와 비슷하거나 높았습니다(판정 방법 안내의 "검증 결과" 참고).'
                    : 'Tech/communication: treat the gap below as reference only. In a 10-year S&P 500 test it barely predicted 12-month returns here, and "quality · expensive" names on average matched or beat the index (see "Validation" in the guide).'}
                </span>
              </div>
            )}
            <div className="mt-2 space-y-0.5 rounded bg-background/60 p-2 leading-relaxed">
              <div>
                {ko ? '가중평균 적정가 ' : 'Weighted fair value '}
                <b className="tabular-nums">{money(result.value.intrinsic_per_share, result.market)}</b>
                {' ÷ '}{ko ? '현재가 ' : 'price '}
                <b className="tabular-nums">{money(price, result.market)}</b>
                {' − 1 = '}{ko ? '괴리 ' : 'gap '}
                <b className={cn('tabular-nums', (result.value.gap ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                  {pct(result.value.gap)}
                </b>
              </div>
              <div className="text-muted-foreground">
                {ko ? '판정: ' : 'Verdict: '}<span className="text-foreground">{verdictRule(result.verdict, lang)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 판정 방법 전체 안내(접었다 펼치는 상자). */
export function MethodGuide({ lang }: { lang: Lang }) {
  const ko = lang === 'ko';
  return (
    <details className="group rounded-lg border border-border/70 bg-muted/10" data-print-hide>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        <span className="font-medium">{ko ? '판정 방법 한눈에 보기' : 'How verdicts are made'}</span>
        <span className="text-xs text-muted-foreground">
          {ko ? '— 우량 기준 · 가치평가 8가지 방법과 산식 · 합치는 방법' : '— quality rules · 8 valuation methods · how they are blended'}
        </span>
      </summary>
      <div className="space-y-4 border-t border-border/60 px-3 py-3 text-xs leading-relaxed">
        <section>
          <h4 className="mb-1 font-semibold">{ko ? '1단계 · 우량한가' : 'Step 1 · Quality'}</h4>
          <p className="mb-1.5 text-muted-foreground">
            {ko
              ? '세 항목을 각각 강함·보통·약함으로 매기고, 강함이 2개 이상이면서 약함이 없으면 통과합니다. 항목 안에서는 기준을 넘는 수치가 2개 이상이면 강함, 하나도 없으면 약함입니다. 가격(PER 등)은 여기서 보지 않습니다.'
              : 'Each axis is strong, neutral or weak; pass with 2+ strong and none weak. Within an axis, 2+ metrics over the bar = strong, none = weak. Price multiples are not used here.'}
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {(Object.keys(AXIS_CRITERIA) as AxisKey[]).map(axis => {
              const spec = AXIS_CRITERIA[axis];
              return (
                <div key={axis} className="rounded border border-border/60 bg-background/60 p-2">
                  <div className="font-medium">{ko ? spec.ko : spec.en}</div>
                  <ul className="mt-0.5 text-muted-foreground">
                    {spec.criteria.map(c => <li key={c.label}>{ko ? c.ko : c.en} {c.rule}</li>)}
                    {axis === 'growth' && <li>{ko ? '자기자본 성장률' : 'Book-value growth'} &gt; 10%</li>}
                    {axis === 'financial_health' && <li>{ko ? '잉여현금흐름 > 주당순이익 × 0.8' : 'FCF > EPS × 0.8'}</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="mb-1 font-semibold">{ko ? '2단계 · 지금 싼가 — 적정가를 구하는 8가지 방법' : 'Step 2 · Cheap now — 8 ways to estimate fair value'}</h4>
          <p className="mb-1.5 text-muted-foreground">
            {ko
              ? '한 가지 방법에 기대지 않도록 여러 방법으로 회사 전체의 적정 가치를 구합니다. 계산할 수 없는 방법(예: 현금흐름이 마이너스)은 빠집니다. 우량 기준을 통과한 종목과 금융업만 계산합니다.'
              : 'Several methods estimate the whole company’s value so no single one dominates. Methods that cannot be computed (e.g. negative cash flow) drop out. Only quality names and financials are valued.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-normal">{ko ? '방법' : 'Method'}</th>
                  <th className="py-1 pr-3 font-normal">{ko ? '쉽게 말하면' : 'In plain words'}</th>
                  <th className="py-1 pr-3 font-normal">{ko ? '산식' : 'Formula'}</th>
                  <th className="py-1 pr-3 text-right font-normal">{ko ? '비중(일반)' : 'Weight'}</th>
                  <th className="py-1 text-right font-normal">{ko ? '비중(설비 많은 기업)' : 'Capex-heavy'}</th>
                </tr>
              </thead>
              <tbody>
                {WEIGHTS.map(w => {
                  const info = MODEL_INFO[w.key];
                  return (
                    <tr key={w.key} className="border-t border-border/40 align-top">
                      <td className="py-1 pr-3 font-medium">{ko ? info.ko : info.en}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{ko ? info.koWhat : info.enWhat}</td>
                      <td className="py-1 pr-3 font-mono text-[10px] text-muted-foreground">{info.formula}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{w.normal}%</td>
                      <td className="py-1 text-right tabular-nums">{w.capexHeavy}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {ko
              ? '설비 많은 기업: 설비투자가 매출에 비해 크고 현금흐름이 들쭉날쭉한 회사(반도체·소재 등). 현금흐름 방법의 비중을 낮추고 장부가치 쪽 방법을 높입니다. 빠진 방법의 비중은 남은 방법에 나눠 줍니다.'
              : 'Capex-heavy: large capex relative to sales and volatile cash flow (chips, materials). Cash-flow methods get less weight, book-based ones more. Weights of missing methods are spread over the rest.'}
          </p>
        </section>

        <section>
          <h4 className="mb-1 font-semibold">{ko ? '3단계 · 합치고 판정하기' : 'Step 3 · Blend and decide'}</h4>
          <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
            <li>
              {ko
                ? '다른 방법들의 가운데 값보다 3배 넘게 크거나 1/3보다 작은 방법은 믿기 어려워 뺍니다(방법이 4개 이상일 때). 단, 지금 시가총액과 ±35% 안에 있는 방법은 빼지 않습니다.'
                : 'A method more than 3× above or below 1/3 of the others’ median is dropped (with 4+ methods) — unless it is within ±35% of the market cap.'}
            </li>
            <li>{ko ? '남은 방법을 비중대로 평균 내 적정가를 구합니다.' : 'The rest are averaged by weight into one fair value.'}</li>
            <li>
              {ko ? '괴리 = 적정가 ÷ 시가총액 − 1. ' : 'Gap = fair value ÷ market cap − 1. '}
              <b className="text-foreground">{ko ? '+15% 초과 매수 후보' : '> +15% buy'}</b>
              {' · '}
              <b className="text-foreground">{ko ? '−10% ~ +15% 관심 후보' : '−10% to +15% watch'}</b>
              {' · '}
              <b className="text-foreground">{ko ? '−10% 미만 우량 · 비쌈' : '< −10% expensive'}</b>
            </li>
            <li>
              {ko
                ? '괴리가 ±50%를 넘으면 실제로 그만큼 싸거나 비싸기보다 모델이 그 회사에 맞지 않을 가능성이 커 ⚠ 표시를 답니다. 은행·보험·증권은 예금·보험료가 부채와 현금흐름에 섞여 이 방법들이 맞지 않아 금융업으로 따로 모읍니다.'
                : 'Gaps beyond ±50% get a ⚠: the models likely do not fit that company. Banks, insurers and brokers do not fit these methods and are grouped as financials.'}
            </li>
          </ol>
        </section>

        <section>
          <h4 className="mb-1 font-semibold">{ko ? '검증 결과 — 이 판정은 실제로 맞았나' : 'Validation — did it work?'}</h4>
          <p className="mb-1.5 text-muted-foreground">
            {ko
              ? 'S&P 500 486종목을 2016~2025년 매년 4월 15일 시점으로 되돌려, 그때 공개된 재무제표(SEC)와 그날 주가로 괴리를 다시 계산하고 그 뒤 12개월 수익률을 S&P 500(SPY)과 비교했습니다(4,437건). "순위상관"은 괴리가 큰 종목일수록 이후 수익도 높았는지를 −1~+1로 나타냅니다.'
              : '486 S&P 500 names were rolled back to April 15 of each year 2016–2025; the gap was recomputed from filings (SEC) and prices of that day and compared with the next 12 months vs SPY (4,437 cases). Rank correlation (−1…+1) shows whether bigger gaps led to higher returns.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-normal">{ko ? '대상' : 'Group'}</th>
                  <th className="py-1 pr-3 font-normal">{ko ? '신호' : 'Signal'}</th>
                  <th className="py-1 pr-3 text-right font-normal">{ko ? '순위상관' : 'Rank corr.'}</th>
                  <th className="py-1 pr-3 text-right font-normal">{ko ? '맞은 해' : 'Years right'}</th>
                  <th className="py-1 text-right font-normal">{ko ? '싼 1/3 − 비싼 1/3 (연)' : 'Cheap − dear third (yr)'}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [ko ? '기술 외 업종' : 'Non-tech', ko ? '적정가 괴리(지금 방식)' : 'Fair-value gap (current)', '+0.08', '8/10', '+6.5%p', true],
                  [ko ? '기술·커뮤니케이션' : 'Tech & comm.', ko ? '적정가 괴리(지금 방식)' : 'Fair-value gap (current)', '+0.02', '6/10', '−1.2%p', false],
                  [ko ? '기술·커뮤니케이션' : 'Tech & comm.', ko ? '역산 DCF(기대 성장률 대비 실제)' : 'Reverse DCF (implied vs actual growth)', '−0.07', '3/10', '−11.1%p', false],
                  [ko ? '기술·커뮤니케이션' : 'Tech & comm.', ko ? '잉여현금흐름 수익률' : 'FCF yield', '−0.03', '5/10', '−23.8%p', false],
                  [ko ? '기술·커뮤니케이션' : 'Tech & comm.', ko ? '자기 과거 5년 대비 PSR 위치' : 'P/S vs own 5-yr history', '+0.03', '4/10', '+5.0%p', false],
                ].map(([group, signal, ic, years, spread, works]) => (
                  <tr key={`${group}-${signal}`} className="border-t border-border/40">
                    <td className="py-1 pr-3">{group}</td>
                    <td className="py-1 pr-3">{signal}</td>
                    <td className={cn('py-1 pr-3 text-right', works ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{ic}</td>
                    <td className="py-1 pr-3 text-right">{years}</td>
                    <td className="py-1 text-right">{spread}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>
              {ko
                ? '기술 외 업종에서는 괴리가 이후 수익을 꾸준히 맞혔습니다. 기술·커뮤니케이션에서는 거의 맞히지 못했고, 성장주용 대안 세 가지도 검증을 통과하지 못해 도입하지 않았습니다. 대신 이 업종에는 ⓘ 표시로 괴리를 참고만 하도록 알립니다.'
                : 'The gap worked steadily outside tech but barely within tech; three growth-stock alternatives also failed, so none was adopted. Tech rows get an ⓘ note to treat the gap as reference only.'}
            </li>
            <li>
              {ko
                ? '우량 기술주 중 "비쌈"이던 경우(156건)도 이후 12개월 지수 대비 평균 +8.9%, 지수를 이긴 비율 52%로, 비싸다고 뒤처지지 않았습니다.'
                : 'Quality tech names flagged expensive (156 cases) still averaged +8.9% vs SPY with a 52% beat rate.'}
            </li>
            <li>
              {ko
                ? '한계: 지금의 S&P 500 구성 종목으로 되돌려 봐서 살아남은 회사 위주입니다(특히 기술주 수익이 부풀려짐). 괴리는 과거 재무제표로 재현되는 두 방법(DCF·오너 어닝)만 썼고, 미국 종목만 검증했습니다. 재현: scripts/research/growth_signal_study.py'
                : 'Limits: survivorship bias (today’s members; inflates tech returns), gap uses only the two methods reproducible from past filings (DCF, owner earnings), US only. Reproduce: scripts/research/growth_signal_study.py'}
            </li>
          </ul>
        </section>

        <p className="text-[11px] text-muted-foreground">
          {ko
            ? '각 종목의 "판정 근거"를 펼치면 그 종목의 실제 수치, 방법별 주당 적정가, 빠진 방법, 계산 과정을 볼 수 있습니다.'
            : 'Open "Why" on any row for its actual figures, per-method fair values, excluded methods and the arithmetic.'}
        </p>
      </div>
    </details>
  );
}
