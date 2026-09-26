import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import { ExportTable, downloadXlsx, printElementAsPdf } from '@/lib/table-export';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import {
  ArchivedScan,
  AxisSignal,
  HistoryCheck,
  ScreenerMarket,
  ScreenerResult,
  ScreenerVerdict,
  ScreenerWarning,
  TrackRecord,
  screenerApi,
} from '@/services/screener-api';
import { TabService } from '@/services/tab-service';
import { PriceChartHover, ResearchLinksPanel } from '@/components/quality-buy/stock-extras';
import { MethodGuide, VerdictBreakdown } from '@/components/quality-buy/verdict-explainer';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Check,
  BadgeCheck,
  ChartLine,
  ChevronDown,
  Clock,
  Download,
  FileText,
  HelpCircle,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// 마지막 스캔 결과를 시장별로 기억한다 — 탭을 다시 열었을 때 바로 보이도록.
// v2: '우량·적정가'가 '관심 후보'로 바뀌어, 이전 판정 이름으로 저장된 결과는 버린다.
const STORAGE_KEY = 'quality-buy:last-scan:v2';

interface SavedScan {
  endDate: string | null;
  results: ScreenerResult[];
}

type Lang = 'ko' | 'en';

const MARKETS: { value: ScreenerMarket; ko: string; en: string }[] = [
  { value: 'ALL', ko: '대형주 전체', en: 'Large caps' },
  { value: 'KR', ko: '한국', en: 'Korea' },
  { value: 'US', ko: '미국', en: 'US' },
  { value: 'SP500', ko: 'S&P 500 전체', en: 'All S&P 500' },
  { value: 'KOSPI', ko: '코스피 전체', en: 'All KOSPI' },
];

// 지수 전체는 수백 종목이라 오래 걸린다 — 시작 전에 알린다.
const FULL_INDEX_MARKETS: ScreenerMarket[] = ['SP500', 'KOSPI'];

// 화면에 펼쳐 보이는 판정 묶음(순서대로). 품질 미달·데이터 부족은 아래 접힌 목록으로 간다.
const SECTIONS: { verdict: ScreenerVerdict; ko: string; en: string; koHint: string; enHint: string; tone: string }[] = [
  {
    verdict: 'buy',
    ko: '매수 후보',
    en: 'Buy candidates',
    koHint: '우량하고, 계산한 적정가가 시가총액보다 15% 넘게 높음',
    enHint: 'Quality, and fair value is more than 15% above market cap',
    tone: 'border-emerald-500/50 bg-emerald-500/5',
  },
  {
    verdict: 'watch',
    ko: '관심 후보',
    en: 'Watchlist',
    koHint: '우량하고 적정가 대비 −10% ~ +15% — 주가가 조정되면 먼저 매수 구간에 들어올 종목',
    enHint: 'Quality, within −10% to +15% of fair value — first to reach the buy zone on a pullback',
    tone: 'border-sky-500/40 bg-sky-500/5',
  },
  {
    verdict: 'quality_expensive',
    ko: '우량 · 비쌈',
    en: 'Quality · expensive',
    koHint: '우량하지만 계산한 적정가가 시가총액보다 10% 넘게 낮음',
    enHint: 'Quality, but fair value is more than 10% below market cap',
    tone: 'border-amber-500/40 bg-amber-500/5',
  },
  {
    verdict: 'quality_no_value',
    ko: '우량 · 가치 계산 불가',
    en: 'Quality · no valuation',
    koHint: '우량하지만 적정가를 계산할 데이터가 부족함',
    enHint: 'Quality, but not enough data to estimate fair value',
    tone: 'border-border bg-muted/10',
  },
  {
    verdict: 'financial',
    ko: '금융업 · 별도 판단',
    en: 'Financials · judge separately',
    koHint: '은행·보험·증권은 이 판정 모델이 맞지 않음 — 수치는 참고만',
    enHint: 'Banks, insurers and brokers do not fit these models — numbers are for reference only',
    tone: 'border-violet-500/40 bg-violet-500/5',
  },
];

// 모델 부적합 가능성 경고 — 아이콘에 마우스를 올리면 이유를 보여 준다.
const WARNING_TEXT: Record<ScreenerWarning, { ko: string; en: string }> = {
  extreme_gap: {
    ko: '괴리가 ±50%를 넘습니다. 실제로 이만큼 싸거나 비싸기보다, 현금흐름 중심 가치평가 모델이 이 회사에 맞지 않을 가능성이 큽니다(고성장·경기민감·일회성 이익 등). 종목 분석에서 방법별 적정가를 확인하세요.',
    en: 'The gap exceeds ±50%. Rather than being that cheap or expensive, the cash-flow-based valuation models likely do not fit this company (high growth, cyclical or one-off earnings). Check the per-method fair values in Stock Analysis.',
  },
  financial_sector: {
    ko: '은행·보험·증권사는 예금·보험료·고객 자산이 부채와 현금흐름에 섞여 있어, 현금흐름 할인(DCF)·EV 배수로 낸 적정가와 유동비율·부채비율 판정이 크게 틀어집니다. 수치는 참고만 하세요.',
    en: 'For banks, insurers and brokers, deposits, premiums and client assets are mixed into liabilities and cash flow, so DCF/EV-based fair values and liquidity/leverage checks are badly distorted. Treat the numbers as reference only.',
  },
};

function ModelFitWarning({ warnings, lang }: { warnings?: ScreenerWarning[]; lang: Lang }) {
  if (!warnings || warnings.length === 0) return null;
  const title = [
    lang === 'ko' ? '모델 부적합 가능성' : 'Possible model misfit',
    ...warnings.map(w => `· ${lang === 'ko' ? WARNING_TEXT[w].ko : WARNING_TEXT[w].en}`),
  ].join('\n');
  return (
    <span
      className="inline-flex cursor-help align-middle text-amber-500"
      title={title}
      aria-label={title}
      role="img"
    >
      <AlertTriangle size={12} />
    </span>
  );
}

// 섹터 이름(GICS·yfinance)을 짧은 한국어로.
const SECTOR_KO: Record<string, string> = {
  'Information Technology': 'IT',
  Technology: 'IT',
  'Health Care': '헬스케어',
  Healthcare: '헬스케어',
  Financials: '금융',
  'Financial Services': '금융',
  'Consumer Discretionary': '경기소비재',
  'Consumer Cyclical': '경기소비재',
  'Consumer Staples': '필수소비재',
  'Consumer Defensive': '필수소비재',
  'Communication Services': '커뮤니케이션',
  Industrials: '산업재',
  Energy: '에너지',
  Utilities: '유틸리티',
  'Real Estate': '부동산',
  Materials: '소재',
  'Basic Materials': '소재',
};

function sectorLabel(sector: string | null | undefined, lang: Lang): string | null {
  if (!sector) return null;
  return lang === 'ko' ? SECTOR_KO[sector] ?? sector : sector;
}

// 판정 이름 — 펼친 구역(SECTIONS)과 접힌 목록에 쓰는 이름을 한곳에서.
const OTHER_VERDICTS: Partial<Record<ScreenerVerdict, { ko: string; en: string }>> = {
  not_quality: { ko: '품질 미달', en: 'Below quality bar' },
  insufficient: { ko: '데이터 부족', en: 'Insufficient data' },
};

function verdictLabel(verdict: ScreenerVerdict | null, lang: Lang): string {
  if (!verdict) return '—';
  const found = SECTIONS.find(section => section.verdict === verdict) ?? OTHER_VERDICTS[verdict];
  return found ? (lang === 'ko' ? found.ko : found.en) : verdict;
}

// 내보내기·정렬에 쓰는 판정 순서.
const VERDICT_ORDER: ScreenerVerdict[] = ['buy', 'watch', 'quality_expensive', 'quality_no_value', 'financial', 'not_quality', 'insufficient'];

const AXES: { key: 'profitability' | 'growth' | 'financial_health'; ko: string; en: string }[] = [
  { key: 'profitability', ko: '수익성', en: 'Profit' },
  { key: 'growth', ko: '성장', en: 'Growth' },
  { key: 'financial_health', ko: '재무', en: 'Balance' },
];

// '저장 분석'에서 되살릴 때 — 탭이 아직 없으면 열릴 때 이 시장을 먼저 보여 주고, 이미 열려 있으면 이벤트로 알린다.
const RESTORE_MARKET_KEY = 'quality-buy:restore-market';
const RESTORE_EVENT = 'quality-buy:restore';
/** 아카이브에 새 스캔이 저장됐음을 '저장 분석' 탭에 알린다(열려 있으면 목록을 다시 받는다). */
export const SAVED_ANALYSES_CHANGED_EVENT = 'saved-analyses:changed';

/** 아카이브에 저장된 스캔을 매수 후보 탭에 다시 띄운다(탭 열기는 부르는 쪽이 한다). */
export function restoreQualityBuyScan(scan: ArchivedScan) {
  if (!scan?.market || !Array.isArray(scan.results)) return;
  persist(scan.market, { endDate: scan.end_date ?? null, results: scan.results });
  try {
    localStorage.setItem(RESTORE_MARKET_KEY, JSON.stringify({ market: scan.market, at: Date.now() }));
  } catch {
    // 저장 공간이 없어도 이벤트로는 전달된다.
  }
  window.dispatchEvent(new CustomEvent(RESTORE_EVENT, { detail: scan.market }));
}

// 되살리기 표시는 읽어도 지우지 않는다 — 탭을 여는 과정에서 화면이 다시 그려지면(개발 모드 이중 실행 포함)
// 두 번째로 읽을 때 사라져 있으면 안 된다. 대신 잠깐만 유효하게 해 나중에 탭을 열 때 끼어들지 않게 한다.
const RESTORE_TTL_MS = 10_000;

function readRestoreMarket(): ScreenerMarket | null {
  try {
    const raw = localStorage.getItem(RESTORE_MARKET_KEY);
    if (!raw) return null;
    const { market, at } = JSON.parse(raw) as { market?: ScreenerMarket; at?: number };
    if (!market || !at || Date.now() - at > RESTORE_TTL_MS) return null;
    return MARKETS.some(m => m.value === market) ? market : null;
  } catch {
    return null;
  }
}

function loadSaved(): Record<string, SavedScan> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(market: ScreenerMarket, scan: SavedScan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSaved(), [market]: scan }));
  } catch {
    // 저장 공간이 없어도 화면은 그대로 동작한다.
  }
}

function formatGap(gap: number | null): string {
  if (gap === null) return '—';
  const pct = gap * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatDrop(drop: number | null | undefined, lang: Lang): string {
  if (drop === null || drop === undefined) return '—';
  if (drop <= 0) return lang === 'ko' ? '지금 매수 구간' : 'In buy zone now';
  return lang === 'ko' ? `${(drop * 100).toFixed(0)}% 하락 시` : `after −${(drop * 100).toFixed(0)}%`;
}

// 펀더멘털 에이전트가 남긴 항목별 수치 문자열을 읽기 쉬운 말로 바꾼다.
const DETAIL_LABELS_KO: [RegExp, string][] = [
  [/Net Margin/g, '순이익률'],
  [/Op Margin/g, '영업이익률'],
  [/Revenue Growth/g, '매출 성장률'],
  [/Earnings Growth/g, '이익 성장률'],
  [/Current Ratio/g, '유동비율'],
  [/D\/E/g, '부채비율'],
  [/N\/A/g, '없음'],
];

function localizeDetails(details: string | null | undefined, lang: Lang): string | null {
  if (!details) return null;
  const text = details.replace(/: /g, ' ');
  return lang === 'ko' ? DETAIL_LABELS_KO.reduce((acc, [re, label]) => acc.replace(re, label), text) : text;
}

function formatPrice(value: number | null, market: 'KR' | 'US'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return market === 'KR'
    ? `₩${Math.round(value).toLocaleString('ko-KR')}`
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function axisClass(signal: AxisSignal): string {
  if (signal === 'bullish') return 'bg-emerald-500';
  if (signal === 'bearish') return 'bg-rose-500';
  if (signal === 'neutral') return 'bg-amber-400';
  return 'bg-muted-foreground/30';
}

function axisLabel(signal: AxisSignal, lang: Lang): string {
  if (signal === 'bullish') return lang === 'ko' ? '강함' : 'strong';
  if (signal === 'bearish') return lang === 'ko' ? '약함' : 'weak';
  if (signal === 'neutral') return lang === 'ko' ? '보통' : 'neutral';
  return lang === 'ko' ? '데이터 없음' : 'no data';
}

function failureReason(result: ScreenerResult, lang: Lang): string {
  if (result.verdict === 'insufficient' || !result.quality) {
    return lang === 'ko' ? '재무 데이터 부족' : 'Not enough financial data';
  }
  const weak = AXES.filter(a => result.quality?.[a.key] === 'bearish').map(a => {
    const name = lang === 'ko' ? a.ko : a.en;
    const details = localizeDetails(result.quality?.details?.[a.key], lang);
    return details ? `${name} (${details})` : name;
  });
  if (weak.length > 0) {
    return lang === 'ko' ? `약한 항목: ${weak.join(' · ')}` : `Weak: ${weak.join(' · ')}`;
  }
  return lang === 'ko'
    ? `강한 항목 ${result.quality.bullish}/3 — 둘 이상 필요`
    : `${result.quality.bullish}/3 strong — needs 2`;
}

function byGapDesc(a: ScreenerResult, b: ScreenerResult) {
  return (b.value.gap ?? -Infinity) - (a.value.gap ?? -Infinity);
}

function QualityDots({ result, lang }: { result: ScreenerResult; lang: Lang }) {
  return (
    <div className="flex items-center gap-2">
      {AXES.map(axis => {
        const signal = result.quality?.[axis.key] ?? null;
        const details = localizeDetails(result.quality?.details?.[axis.key], lang);
        return (
          <span
            key={axis.key}
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title={`${lang === 'ko' ? axis.ko : axis.en}: ${axisLabel(signal, lang)}${details ? ` — ${details}` : ''}`}
          >
            <span className={cn('inline-block h-2 w-2 rounded-full', axisClass(signal))} />
            {lang === 'ko' ? axis.ko : axis.en}
          </span>
        );
      })}
    </div>
  );
}

function ResultRow({ result, lang, onAnalyze }: { result: ScreenerResult; lang: Lang; onAnalyze: (ticker: string) => void }) {
  const gap = result.value.gap;
  const failed = result.verdict === 'not_quality' || result.verdict === 'insufficient';
  const [showHistory, setShowHistory] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const sector = sectorLabel(result.sector, lang);
  return (
    <div data-print-row className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 first:border-t-0">
      <div className="min-w-[9rem] flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{result.name}</span>
          <span className="text-xs text-muted-foreground">{result.ticker}</span>
          <span className="self-center" data-print-hide>
            <PriceChartHover result={result} lang={lang} />
          </span>
          {sector && (
            <span
              className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground"
              title={[result.sector, result.industry].filter(Boolean).join(' · ')}
            >
              {sector}
            </span>
          )}
        </div>
        <QualityDots result={result} lang={lang} />
      </div>
      {failed ? (
        <div className="max-w-[28rem] text-right text-xs text-muted-foreground">{failureReason(result, lang)}</div>
      ) : (
        <>
          <div
            className="w-28 text-right"
            title={lang === 'ko' ? '기준일 시가총액 ÷ 주식 수 — 적정가 괴리 계산에 쓴 주가' : 'Market cap ÷ shares on the as-of date — the price used for the fair-value gap'}
          >
            <div className="font-mono text-sm tabular-nums">{formatPrice(result.value.price_per_share ?? null, result.market)}</div>
            <div className="text-[11px] text-muted-foreground">{lang === 'ko' ? '현재가' : 'Price'}</div>
          </div>
          <div className="w-24 text-right">
            <div
              className={cn(
                'flex items-center justify-end gap-1 font-mono text-sm tabular-nums',
                gap === null ? 'text-muted-foreground' : gap > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}
            >
              <ModelFitWarning warnings={result.warnings} lang={lang} />
              {formatGap(gap)}
            </div>
            <div className="text-[11px] text-muted-foreground">{lang === 'ko' ? '적정가 괴리' : 'Fair-value gap'}</div>
          </div>
          <div className="w-28 text-right">
            <div className="font-mono text-sm tabular-nums">{formatPrice(result.value.intrinsic_per_share, result.market)}</div>
            <div className="text-[11px] text-muted-foreground">{lang === 'ko' ? '주당 적정가' : 'Fair value / sh'}</div>
          </div>
          <div className="w-40 text-right" title={lang === 'ko' ? '적정가 ÷ 1.15 — 이 가격 아래로 내려오면 매수 후보가 됩니다' : 'Fair value ÷ 1.15 — below this price it becomes a buy candidate'}>
            <div className="font-mono text-sm tabular-nums">{formatPrice(result.value.buy_price_per_share ?? null, result.market)}</div>
            <div
              className={cn(
                'whitespace-nowrap text-[11px]',
                result.value.drop_to_buy === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            >
              {lang === 'ko' ? '매수 기준가' : 'Buy below'} · {formatDrop(result.value.drop_to_buy, lang)}
            </div>
          </div>
        </>
      )}
      <div className="flex items-center gap-1" data-print-hide>
        <Button
          size="sm"
          variant={showWhy ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-xs"
          onClick={() => setShowWhy(v => !v)}
          aria-expanded={showWhy}
          title={lang === 'ko' ? '우량 판정의 실제 수치와 기준, 가치평가 방법별 적정가와 계산 과정' : 'Quality figures vs thresholds, per-method fair values and the arithmetic'}
        >
          <HelpCircle size={12} className="mr-1" />
          {lang === 'ko' ? '판정 근거' : 'Why'}
        </Button>
        <Button
          size="sm"
          variant={showLinks ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-xs"
          onClick={() => setShowLinks(v => !v)}
          aria-expanded={showLinks}
          title={result.market === 'KR'
            ? (lang === 'ko' ? '네이버 증권·DART·FnGuide 바로가기' : 'Naver Finance, DART and FnGuide links')
            : (lang === 'ko' ? 'SEC 공시·네이버 증권·Yahoo·Finviz 바로가기' : 'SEC filings, Naver Finance, Yahoo and Finviz links')}
        >
          <Link2 size={12} className="mr-1" />
          {lang === 'ko' ? '바로가기' : 'Links'}
          <ChevronDown size={12} className={cn('ml-0.5 transition-transform', showLinks && 'rotate-180')} />
        </Button>
        {result.verdict !== 'insufficient' && (
          <Button
            size="sm"
            variant={showHistory ? 'secondary' : 'ghost'}
            className="h-7 px-2 text-xs"
            onClick={() => setShowHistory(v => !v)}
            title={lang === 'ko'
              ? '최근 5년 매년 4월 15일에 그때 공개된 재무제표와 주가로 다시 판정하고, 그 뒤 수익률을 지수와 비교합니다'
              : 'Re-judge on April 15 of each of the last 5 years using filings public at the time, then compare later returns with the index'}
          >
            <Clock size={12} className="mr-1" />
            {lang === 'ko' ? '과거 검증' : 'Backtest'}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onAnalyze(result.ticker)}>
          {t('stockAnalysis', lang)}
          <ArrowUpRight size={12} className="ml-1" />
        </Button>
      </div>
      {result.error && result.verdict !== 'insufficient' && (
        <div className="basis-full text-[11px] text-muted-foreground" title={result.error}>
          {lang === 'ko' ? '일부 데이터 조회 실패' : 'Some data failed to load'}
        </div>
      )}
      {showWhy && (
        <div className="basis-full">
          <VerdictBreakdown result={result} lang={lang} />
        </div>
      )}
      {showLinks && (
        <div className="basis-full">
          <ResearchLinksPanel result={result} lang={lang} />
        </div>
      )}
      {showHistory && (
        <div className="basis-full">
          <HistoryPanel result={result} lang={lang} />
        </div>
      )}
    </div>
  );
}

function formatSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function signedClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'text-muted-foreground';
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-rose-600 dark:text-rose-400' : '';
}

const HISTORY_HORIZONS: { key: string; ko: string; en: string }[] = [
  { key: '3m', ko: '3개월', en: '3M' },
  { key: '6m', ko: '6개월', en: '6M' },
  { key: '12m', ko: '12개월', en: '12M' },
];

// 과거 시점 검증 — 그때 공개된 재무제표와 그날 주가로 다시 판정하고, 그 뒤 수익률을 지수와 비교한다.
function HistoryPanel({ result, lang }: { result: ScreenerResult; lang: Lang }) {
  const [data, setData] = useState<HistoryCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    screenerApi
      .historyCheck(result.ticker, result.market, result.industry)
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [result.ticker, result.market, result.industry]);

  if (error) {
    return (
      <div className="mt-1 rounded border border-rose-500/40 bg-rose-500/5 p-2 text-[11px] text-rose-600 dark:text-rose-400">
        {lang === 'ko' ? `과거 검증을 불러오지 못했습니다: ${error}` : `Backtest failed: ${error}`}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded border border-border/60 p-2 text-[11px] text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        {lang === 'ko'
          ? '그때 공개된 재무제표와 주가로 다시 판정하는 중… (수십 초 걸릴 수 있습니다)'
          : 'Re-judging with filings and prices from each date… (may take tens of seconds)'}
      </div>
    );
  }

  const bench = data.benchmark === '^KS11' ? (lang === 'ko' ? '코스피' : 'KOSPI') : data.benchmark;
  const summary = data.buy_summary;
  return (
    <div className="mt-1 space-y-1 rounded border border-border/60 bg-muted/10 p-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3 font-normal">{lang === 'ko' ? '검증일' : 'Date'}</th>
              <th className="py-1 pr-3 font-normal">{lang === 'ko' ? '재무제표' : 'Filing'}</th>
              <th className="py-1 pr-3 font-normal">{lang === 'ko' ? '그때 판정' : 'Verdict then'}</th>
              <th className="py-1 pr-3 text-right font-normal">{lang === 'ko' ? '괴리(간이)' : 'Gap (simple)'}</th>
              {HISTORY_HORIZONS.map(h => (
                <th key={h.key} className="py-1 pr-3 text-right font-normal">
                  {lang === 'ko' ? `${h.ko} 뒤 (${bench} 대비)` : `${h.en} later (vs ${bench})`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.checkpoints.map(c => (
              <tr key={c.as_of} className="border-t border-border/40">
                <td className="py-1 pr-3">{c.as_of}</td>
                <td className="py-1 pr-3 text-muted-foreground">{c.report_period ?? '—'}</td>
                <td className="py-1 pr-3">
                  {c.verdict ? verdictLabel(c.verdict, lang) : <span className="text-muted-foreground">{c.note ?? '—'}</span>}
                </td>
                <td className={cn('py-1 pr-3 text-right', signedClass(c.gap))}>{formatSignedPct(c.gap)}</td>
                {HISTORY_HORIZONS.map(h => {
                  const r = c.returns?.[h.key];
                  return (
                    <td key={h.key} className="py-1 pr-3 text-right">
                      {r ? (
                        <>
                          <span className={signedClass(r.return)}>{formatSignedPct(r.return)}</span>
                          <span className={cn('ml-1', signedClass(r.excess))}>({formatSignedPct(r.excess)})</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {summary.n > 0 && (
          <span className="mr-2 text-foreground">
            {lang === 'ko'
              ? `'매수 후보'였던 ${summary.n}번의 12개월 뒤 ${bench} 대비 평균 ${formatSignedPct(summary.avg_excess_12m)}, 지수를 이긴 비율 ${formatSignedPct(summary.beat_rate_12m).replace('+', '')}.`
              : `${summary.n} buy signal(s): avg ${formatSignedPct(summary.avg_excess_12m)} vs ${bench} after 12M, beat rate ${formatSignedPct(summary.beat_rate_12m).replace('+', '')}.`}
          </span>
        )}
        {lang === 'ko'
          ? '간이 검증입니다. 우량 판정은 스캐너와 같은 기준이지만, 가격 판정은 과거 재무제표만으로 재현되는 DCF·오너어닝 2개 모델만 써서 지금 괴리와 다를 수 있습니다. 미국은 그때 SEC에 제출된 연간 보고서, 한국은 전년도 DART 사업보고서를 씁니다.'
          : 'Simplified check: quality uses the scanner rules, but price uses only the DCF and owner-earnings models (reproducible from past filings), so the gap can differ from today’s. US uses annual reports filed with the SEC by then; Korea uses the prior-year DART annual report.'}
      </div>
    </div>
  );
}

const TRACK_HORIZONS: { key: string; ko: string; en: string }[] = [
  { key: '1m', ko: '1개월', en: '1M' },
  { key: '3m', ko: '3개월', en: '3M' },
  { key: '6m', ko: '6개월', en: '6M' },
  { key: '12m', ko: '12개월', en: '12M' },
];
const TRACK_VERDICTS: ScreenerVerdict[] = ['buy', 'watch', 'quality_expensive', 'financial'];

// 전진 검증 — 끝까지 돈 스캔마다 서버가 그날 판정을 기록하고, 기간이 지나면 실제 주가로 채점한다.
function TrackRecordPanel({ lang }: { lang: Lang }) {
  const [data, setData] = useState<TrackRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (loading || data) return;
    setLoading(true);
    setError(null);
    screenerApi
      .fetchTrackRecord()
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  return (
    <details
      className="group rounded-lg border border-border/70"
      onToggle={(event: { currentTarget: HTMLDetailsElement }) => { if (event.currentTarget.open) load(); }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        <ChartLine size={14} />
        {lang === 'ko' ? '판정 성과 추적 (전진 검증)' : 'Verdict track record (forward test)'}
      </summary>
      <div className="space-y-2 border-t border-border/60 px-3 py-2 text-xs">
        <p className="text-muted-foreground">
          {lang === 'ko'
            ? '스캔을 끝까지 돌릴 때마다 그날의 판정이 서버에 기록되고, 1·3·6·12개월이 지나면 실제 주가로 채점합니다. 칸의 숫자는 같은 기간 지수(미국 SPY, 한국 코스피) 대비 평균 초과수익률이고, 아래는 지수를 이긴 비율과 표본 수입니다.'
            : 'Each completed scan records that day’s verdicts on the server; after 1/3/6/12 months they are scored with actual prices. Cells show the average return in excess of the index (US: SPY, Korea: KOSPI), with the share that beat it and the sample size.'}
        </p>
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            {lang === 'ko' ? '기록된 판정을 주가로 채점하는 중…' : 'Scoring recorded verdicts…'}
          </div>
        )}
        {error && <div className="text-rose-600 dark:text-rose-400">{error}</div>}
        {data && data.snapshots === 0 && (
          <div className="text-muted-foreground">
            {lang === 'ko' ? '아직 기록이 없습니다. 스캔을 끝까지 돌리면 기록이 시작됩니다.' : 'No records yet. Finish a scan to start recording.'}
          </div>
        )}
        {data && data.snapshots > 0 && (
          <>
            <div className="text-muted-foreground">
              {lang === 'ko'
                ? `기록 ${data.snapshots}일 · 첫 기록 ${data.first_snapshot}${data.next_maturity ? ` · 다음 1개월 채점 ${data.next_maturity}` : ''}`
                : `${data.snapshots} day(s) recorded · first ${data.first_snapshot}${data.next_maturity ? ` · next 1M score ${data.next_maturity}` : ''}`}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full tabular-nums">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-normal">{lang === 'ko' ? '판정' : 'Verdict'}</th>
                    {TRACK_HORIZONS.map(h => (
                      <th key={h.key} className="py-1 pr-3 text-right font-normal">{lang === 'ko' ? h.ko : h.en}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TRACK_VERDICTS.map(verdict => (
                    <tr key={verdict} className="border-t border-border/40">
                      <td className="py-1 pr-3">{verdictLabel(verdict, lang)}</td>
                      {TRACK_HORIZONS.map(h => {
                        const stat = data.summary[verdict]?.[h.key];
                        return (
                          <td key={h.key} className="py-1 pr-3 text-right">
                            {stat && stat.n > 0 ? (
                              <>
                                <div className={signedClass(stat.avg_excess)}>{formatSignedPct(stat.avg_excess)}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {lang === 'ko'
                                    ? `이김 ${Math.round((stat.beat_rate ?? 0) * 100)}% · ${stat.n}개`
                                    : `beat ${Math.round((stat.beat_rate ?? 0) * 100)}% · n=${stat.n}`}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

// 스캔 결과 전체를 표로 — 엑셀·PDF 내보내기에 쓴다.
export function buildExportTable(results: ScreenerResult[], lang: Lang, title: string, subtitle: string): ExportTable {
  const ko = lang === 'ko';
  const rank = (v: ScreenerVerdict) => VERDICT_ORDER.indexOf(v);
  const rows = [...results]
    .sort((a, b) => rank(a.verdict) - rank(b.verdict) || byGapDesc(a, b))
    .map(r => {
      const failed = r.verdict === 'not_quality' || r.verdict === 'insufficient';
      return [
        verdictLabel(r.verdict, lang),
        r.name,
        r.ticker,
        r.market,
        r.market === 'KR' ? 'KRW' : 'USD',
        sectorLabel(r.sector, lang),
        r.industry ?? null,
        axisLabel(r.quality?.profitability ?? null, lang),
        axisLabel(r.quality?.growth ?? null, lang),
        axisLabel(r.quality?.financial_health ?? null, lang),
        r.value.price_per_share ?? null,
        r.value.gap,
        r.value.intrinsic_per_share,
        r.value.buy_price_per_share ?? null,
        r.value.drop_to_buy ?? null,
        (r.warnings ?? []).map(w => (ko ? WARNING_TEXT[w].ko : WARNING_TEXT[w].en).split('.')[0]).join(' / ') || null,
        failed ? failureReason(r, lang) : r.error ? (ko ? '일부 데이터 조회 실패' : 'Some data failed to load') : null,
      ];
    });
  return {
    title,
    subtitle,
    columns: [
      { header: ko ? '판정' : 'Verdict', width: 16 },
      { header: ko ? '종목명' : 'Name', width: 22 },
      { header: ko ? '티커' : 'Ticker', width: 12 },
      { header: ko ? '시장' : 'Market', width: 7 },
      { header: ko ? '통화' : 'Currency', width: 7 },
      { header: ko ? '섹터' : 'Sector', width: 12 },
      { header: ko ? '세부 업종' : 'Industry', width: 26 },
      { header: ko ? '수익성' : 'Profit', width: 9 },
      { header: ko ? '성장' : 'Growth', width: 9 },
      { header: ko ? '재무' : 'Balance', width: 9 },
      { header: ko ? '현재가' : 'Price', type: 'number', width: 13 },
      { header: ko ? '적정가 괴리' : 'Fair-value gap', type: 'percent', width: 12 },
      { header: ko ? '주당 적정가' : 'Fair value / sh', type: 'number', width: 14 },
      { header: ko ? '매수 기준가' : 'Buy below', type: 'number', width: 13 },
      { header: ko ? '매수까지 하락률' : 'Drop to buy', type: 'percent', width: 14 },
      { header: ko ? '모델 부적합 경고' : 'Model-fit warning', width: 30 },
      { header: ko ? '비고' : 'Note', width: 40 },
    ],
    rows,
  };
}

/** 판정별 구역과 접힌 '품질 미달 · 데이터 부족' 목록 — 스캔 탭과 '저장 분석' 아카이브가 함께 쓴다. */
export function QualityBuyResultsView({
  results,
  lang,
  onAnalyze,
  showEmptyBuy,
}: {
  results: ScreenerResult[];
  lang: Lang;
  onAnalyze: (ticker: string) => void;
  /** 매수 후보가 없을 때도 빈 구역을 보여 줄지(스캔이 끝난 뒤) */
  showEmptyBuy: boolean;
}) {
  const grouped = useMemo(() => {
    const map = new Map<ScreenerVerdict, ScreenerResult[]>();
    for (const r of results) {
      const list = map.get(r.verdict) ?? [];
      list.push(r);
      map.set(r.verdict, list);
    }
    for (const list of map.values()) list.sort(byGapDesc);
    return map;
  }, [results]);
  const rest = [...(grouped.get('not_quality') ?? []), ...(grouped.get('insufficient') ?? [])];

  return (
    <>
        {/* Sections */}
        {SECTIONS.map(section => {
          const list = grouped.get(section.verdict) ?? [];
          if (list.length === 0 && !(section.verdict === 'buy' && showEmptyBuy)) return null;
          return (
            <section key={section.verdict} className={cn('overflow-hidden rounded-lg border', section.tone)}>
              <header className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <h3 className="text-sm font-semibold">{lang === 'ko' ? section.ko : section.en}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
                <span className="text-[11px] text-muted-foreground">{lang === 'ko' ? section.koHint : section.enHint}</span>
              </header>
              {list.length === 0 ? (
                <div className="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground">
                  {lang === 'ko'
                    ? '지금은 기준을 넘는 종목이 없습니다. 아래 관심 후보가 조정 시 먼저 매수 구간에 들어올 종목입니다.'
                    : 'Nothing clears the bar right now. The watchlist below is next in line on a pullback.'}
                </div>
              ) : (
                <div className="bg-background/60">
                  {list.map(r => (
                    <ResultRow key={r.ticker} result={r} lang={lang} onAnalyze={onAnalyze} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {rest.length > 0 && (
          <details className="group rounded-lg border border-border/70">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              {lang === 'ko' ? '품질 미달 · 데이터 부족' : 'Below quality bar · insufficient data'}
              <span className="text-xs tabular-nums">{rest.length}</span>
            </summary>
            <div>
              {rest.map(r => (
                <ResultRow key={r.ticker} result={r} lang={lang} onAnalyze={onAnalyze} />
              ))}
            </div>
          </details>
        )}

    </>
  );
}

export function QualityBuyTab() {
  const { language } = useLanguage();
  const lang: Lang = language === 'ko' ? 'ko' : 'en';
  const { openTab } = useTabsContext();
  const { patchWorkspace } = useWorkspace();

  const [initialMarket] = useState<ScreenerMarket>(() => readRestoreMarket() ?? 'ALL');
  const [market, setMarket] = useState<ScreenerMarket>(initialMarket);
  const [results, setResults] = useState<ScreenerResult[]>(() => loadSaved()[initialMarket]?.results ?? []);
  const [endDate, setEndDate] = useState<string | null>(() => loadSaved()[initialMarket]?.endDate ?? null);
  const [total, setTotal] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 스캔 결과는 끝나든 중간에 멈추든 서버가 '저장 분석' 아카이브에 남긴다 — 그 사실을 알린다.
  const [archiveNote, setArchiveNote] = useState<{ scanned: number; complete: boolean } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const collectedRef = useRef<ScreenerResult[]>([]);
  const scanDateRef = useRef<string | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const runningRef = useRef(false);
  runningRef.current = isRunning;
  // 탭이 열린 채로 '저장 분석'에서 되살리면, 스캔 중이 아닐 때만 그 결과로 바꾼다.
  useEffect(() => {
    const onRestore = (event: Event) => {
      if (runningRef.current) return;
      const next = (event as CustomEvent<ScreenerMarket>).detail;
      const saved = loadSaved()[next];
      setMarket(next);
      setResults(saved?.results ?? []);
      setEndDate(saved?.endDate ?? null);
      setTotal(0);
      setError(null);
      setArchiveNote(null);
    };
    window.addEventListener(RESTORE_EVENT, onRestore);
    return () => window.removeEventListener(RESTORE_EVENT, onRestore);
  }, []);

  // 아카이브에 저장됐다고 알리면 열려 있는 '저장 분석' 탭이 목록을 다시 받는다.
  useEffect(() => {
    if (archiveNote) window.dispatchEvent(new Event(SAVED_ANALYSES_CHANGED_EVENT));
  }, [archiveNote]);

  const changeMarket = (next: ScreenerMarket) => {
    if (isRunning || next === market) return;
    const saved = loadSaved()[next];
    setMarket(next);
    setResults(saved?.results ?? []);
    setEndDate(saved?.endDate ?? null);
    setTotal(0);
    setError(null);
    setArchiveNote(null);
    setLoadedArchive(null);
  };

  // 이 브라우저에 남은 결과보다 새 스캔이 '저장 분석'에 있으면(새벽 자동 스캔, 다른 기기의 스캔) 그걸 보여 준다.
  const [loadedArchive, setLoadedArchive] = useState<{ endDate: string; complete: boolean; scanned: number; total: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const localDate = loadSaved()[market]?.endDate ?? null;
    (async () => {
      try {
        const { items } = await savedAnalysisService.listAnalyses({ source_tab: 'quality_buy', ticker: market, limit: 5 });
        const latest = items.find(item => item.ticker === market && item.result_data?.end_date);
        const latestDate: string | undefined = latest?.result_data?.end_date;
        if (!latest || !latestDate || (localDate && latestDate <= localDate)) return;
        const full = await savedAnalysisService.getAnalysisById(latest.id);
        const scan = full.result_data as ArchivedScan;
        if (cancelled || runningRef.current || !Array.isArray(scan?.results)) return;
        persist(market, { endDate: scan.end_date, results: scan.results });
        setResults(scan.results);
        setEndDate(scan.end_date);
        setTotal(0);
        setLoadedArchive({ endDate: scan.end_date, complete: scan.complete !== false, scanned: scan.scanned, total: scan.total });
      } catch {
        // 불러오지 못하면 이 브라우저의 결과를 그대로 보여 준다.
      }
    })();
    return () => { cancelled = true; };
  }, [market]);

  const startScan = useCallback((refresh: boolean) => {
    stopRef.current?.();
    setResults([]);
    setTotal(0);
    setError(null);
    setArchiveNote(null);
    setLoadedArchive(null);
    setIsRunning(true);

    const collected: ScreenerResult[] = [];
    collectedRef.current = collected;
    let scanDate: string | null = null;
    stopRef.current = screenerApi.scan(market, refresh, {
      onStart: info => {
        setTotal(info.total);
        setEndDate(info.end_date);
        scanDate = info.end_date;
        scanDateRef.current = info.end_date;
      },
      onResult: result => {
        collected.push(result);
        setResults([...collected]);
      },
      onArchived: info => setArchiveNote({ scanned: info.scanned, complete: info.complete }),
      onComplete: () => {
        setIsRunning(false);
        stopRef.current = null;
        persist(market, { endDate: scanDate, results: collected });
      },
      onError: message => {
        setIsRunning(false);
        stopRef.current = null;
        setError(message);
        // 중간에 멈춰도 받은 데까지는 이 브라우저에도 남긴다(서버는 아카이브에 남긴다).
        if (collected.length > 0) {
          persist(market, { endDate: scanDate, results: collected });
          setArchiveNote({ scanned: collected.length, complete: false });
        }
      },
    }, lang);
  }, [market, lang]);

  const stopScan = () => {
    stopRef.current?.();
    stopRef.current = null;
    setIsRunning(false);
    const collected = collectedRef.current;
    if (collected.length > 0) {
      persist(market, { endDate: scanDateRef.current, results: [...collected] });
      setArchiveNote({ scanned: collected.length, complete: false });
      // 서버는 연결이 끊긴 것을 알아챈 뒤에 저장한다 — 조금 뒤에 한 번 더 알린다.
      window.setTimeout(() => window.dispatchEvent(new Event(SAVED_ANALYSES_CHANGED_EVENT)), 20000);
    }
  };

  const openArchive = useCallback(() => {
    openTab(TabService.createSavedAnalysesTab());
  }, [openTab]);

  const openAnalysisFor = useCallback((ticker: string) => {
    patchWorkspace({ tickers: ticker });
    openTab(TabService.createStockSearchTab());
  }, [openTab, patchWorkspace]);

  const exportTable = useCallback(() => {
    const marketName = MARKETS.find(m => m.value === market);
    const label = marketName ? (lang === 'ko' ? marketName.ko : marketName.en) : market;
    const title = lang === 'ko' ? `매수 후보 ${label} ${endDate ?? ''}`.trim() : `Buy candidates ${label} ${endDate ?? ''}`.trim();
    const subtitle = lang === 'ko'
      ? `${results.length}종목 · 기준일 ${endDate ?? '—'} · 현재가는 기준일 시가총액 ÷ 주식 수 · 괴리 = 적정가 ÷ 시가총액 − 1`
      : `${results.length} names · as of ${endDate ?? '—'} · price = market cap ÷ shares · gap = fair value ÷ market cap − 1`;
    return { table: buildExportTable(results, lang, title, subtitle), filename: `quality-buy_${market}_${endDate ?? 'scan'}` };
  }, [market, lang, endDate, results]);

  const exportExcel = () => {
    const { table, filename } = exportTable();
    downloadXlsx(table, filename);
  };

  // PDF 는 화면 모습 그대로(색·구역·배지) 인쇄한다. 버튼·진행 표시처럼 인쇄에 의미 없는 것은 뺀다.
  const printRef = useRef<HTMLDivElement>(null);
  const exportPdf = () => {
    if (!printRef.current) return;
    const { table, filename } = exportTable();
    printElementAsPdf(printRef.current, filename, table.subtitle);
  };

  // 자동 저장과 별개로, 지금 화면에 있는 결과를 바로 '저장 분석'에 남기는 버튼.
  const [manualSave, setManualSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => { setManualSave('idle'); }, [results, market]);
  const saveToArchive = async () => {
    if (manualSave === 'saving' || results.length === 0) return;
    setManualSave('saving');
    const marketName = MARKETS.find(m => m.value === market);
    const label = marketName ? (lang === 'ko' ? marketName.ko : marketName.en) : market;
    const fullTotal = total > 0 ? total : results.length;
    const complete = results.length >= fullTotal;
    const counts: Partial<Record<ScreenerVerdict, number>> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    const scan: ArchivedScan = {
      market,
      end_date: endDate ?? '',
      total: fullTotal,
      scanned: results.length,
      complete,
      counts,
      results,
    };
    const name = lang === 'ko'
      ? `매수 후보 · ${label} · ${results.length}/${fullTotal}종목${complete ? '' : ' · 중단'}`
      : `Buy candidates · ${label} · ${results.length}/${fullTotal}${complete ? '' : ' · stopped'}`;
    try {
      await savedAnalysisService.saveAnalysis('quality_buy', market, lang, { market, end_date: endDate }, scan, name);
      setManualSave('saved');
      window.dispatchEvent(new Event(SAVED_ANALYSES_CHANGED_EVENT));
    } catch {
      setManualSave('error');
    }
  };

  const buyCount = results.filter(r => r.verdict === 'buy').length;
  const repricedCount = results.filter(r => r.repriced).length;
  const watchCount = results.filter(r => r.verdict === 'watch').length;
  const progressPct = total > 0 ? Math.round((results.length / total) * 100) : 0;
  const hasResults = results.length > 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div ref={printRef} className="mx-auto max-w-5xl space-y-4 p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <BadgeCheck size={18} className="text-primary" />
          <h2 className="text-lg font-semibold">{t('qualityBuy', language)}</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2" data-print-hide>
            <div className="flex flex-wrap rounded-full border border-border p-0.5">
              {MARKETS.map(m => (
                <button
                  key={m.value}
                  onClick={() => changeMarket(m.value)}
                  disabled={isRunning}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed',
                    market === m.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {lang === 'ko' ? m.ko : m.en}
                </button>
              ))}
            </div>
            {isRunning ? (
              <Button size="sm" variant="outline" onClick={stopScan}>
                <Square size={14} className="mr-1" />
                {lang === 'ko' ? '중단' : 'Stop'}
              </Button>
            ) : (
              <>
                {hasResults && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startScan(true)}
                    title={lang === 'ko' ? '저장해 둔 재무와 오늘 계산 결과를 쓰지 않고 모든 종목의 재무를 새로 받아 계산합니다(오래 걸림)' : 'Ignore stored financials and today\'s results; re-fetch every financial statement (slow)'}
                  >
                    <RefreshCw size={14} className="mr-1" />
                    {lang === 'ko' ? '새로 계산' : 'Recompute'}
                  </Button>
                )}
                <Button size="sm" onClick={() => startScan(false)}>
                  <Play size={14} className="mr-1" />
                  {lang === 'ko' ? '스캔' : 'Scan'}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Criteria */}
        <div className="rounded-lg border border-border/70 bg-muted/10 p-3 text-xs leading-relaxed text-muted-foreground">
          {lang === 'ko' ? (
            <ul className="space-y-1">
              <li>
                <b className="text-foreground">두 질문으로 나눠 봅니다.</b> ① <b className="text-foreground">우량한가</b> — 수익성·성장·재무건전성 중 둘 이상이 강하고 약한 항목이 없음.
                ② <b className="text-foreground">지금 싼가</b> — 8가지 방법으로 구한 적정가가 시가총액보다 15% 넘게 높음.
              </li>
              <li>
                <b className="text-foreground">관심 후보</b>는 우량하지만 아직 싸지 않은 종목(적정가 대비 −10%~+15%)이고, 얼마나 내려야 매수 구간인지 함께 보여 줍니다.
                은행·보험·증권은 <b className="text-foreground">금융업</b>으로 따로 모으고, 괴리가 ±50%를 넘으면 <AlertTriangle size={11} className="inline align-baseline text-amber-500" /> 표시를 답니다.
              </li>
              <li>
                종목마다 <b className="text-foreground">판정 근거</b>(실제 수치·방법별 적정가), <ChartLine size={11} className="inline align-baseline" /> 1년 주가(마우스 올리기), <b className="text-foreground">바로가기</b>(네이버 증권·DART·SEC)를 볼 수 있습니다.
              </li>
              <li>
                재무는 14~28일 기억해 두고 다음 스캔부터는 오늘 주가만 받아 다시 계산해 빠릅니다('새로 계산'은 재무를 전부 새로 받음).
                평일마다 서버가 <b className="text-foreground">S&P 500 전체는 아침 7:30</b>, <b className="text-foreground">코스피 전체는 오후 5:00</b>에 자동으로 스캔하고, 모든 스캔은 멈춰도 받은 데까지 <b className="text-foreground">저장 분석</b>에 남습니다.
              </li>
            </ul>
          ) : (
            <ul className="space-y-1">
              <li>
                <b className="text-foreground">Two questions.</b> ① <b className="text-foreground">Quality</b> — 2+ of profitability, growth and balance sheet strong, none weak.
                ② <b className="text-foreground">Cheap now</b> — fair value from 8 methods exceeds market cap by more than 15%.
              </li>
              <li>
                The <b className="text-foreground">watchlist</b> holds quality names within −10%~+15% of fair value, with the decline needed to reach the buy zone.
                Banks, insurers and brokers go to <b className="text-foreground">Financials</b>; gaps beyond ±50% get <AlertTriangle size={11} className="inline align-baseline text-amber-500" />.
              </li>
              <li>
                Each row has <b className="text-foreground">Why</b> (figures and per-method fair values), a <ChartLine size={11} className="inline align-baseline" /> 1-year chart on hover, and <b className="text-foreground">Links</b>.
              </li>
              <li>
                Financials are kept 14–28 days so later scans only fetch today’s price ('Recompute' re-fetches everything).
                On weekdays the server scans <b className="text-foreground">All S&P 500 at 7:30 KST</b> and <b className="text-foreground">All KOSPI at 17:00 KST</b>; every scan, even stopped, is saved to <b className="text-foreground">Saved Analyses</b>.
              </li>
            </ul>
          )}
        </div>

        <MethodGuide lang={lang} />

        {/* Progress */}
        {(isRunning || (total > 0 && results.length < total)) && (
          <div className="space-y-1" data-print-hide>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {isRunning ? (lang === 'ko' ? '스캔 중…' : 'Scanning…') : (lang === 'ko' ? '중단됨' : 'Stopped')}
                {isRunning && FULL_INDEX_MARKETS.includes(market) && (
                  <span className="ml-1">
                    {lang === 'ko' ? '— 지수 전체라 오래 걸립니다. 탭을 닫으면 중단됩니다.' : '— full index, this takes a while. Closing the tab stops it.'}
                  </span>
                )}
              </span>
              <span className="tabular-nums">{results.length} / {total}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
            {lang === 'ko' ? `스캔이 중간에 멈췄습니다: ${error}` : `Scan stopped: ${error}`}
          </div>
        )}

        {archiveNote && !isRunning && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-xs text-muted-foreground" data-print-hide>
            <Archive size={14} className="text-primary" />
            <span>
              {archiveNote.complete
                ? (lang === 'ko'
                  ? `스캔 결과 ${archiveNote.scanned}종목을 '저장 분석'에 저장했습니다.`
                  : `Saved ${archiveNote.scanned} results to Saved Analyses.`)
                : (lang === 'ko'
                  ? `중단된 스캔 — 여기까지 받은 ${archiveNote.scanned}종목을 '저장 분석'에 '중단'으로 저장했습니다.`
                  : `Scan stopped — the ${archiveNote.scanned} results received so far were saved to Saved Analyses as partial.`)}
            </span>
            <Button size="sm" variant="outline" className="ml-auto h-7 px-2 text-xs" onClick={openArchive}>
              {lang === 'ko' ? '저장 분석 열기' : 'Open Saved Analyses'}
              <ArrowUpRight size={12} className="ml-1" />
            </Button>
          </div>
        )}

        {!hasResults && !isRunning && !error && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {lang === 'ko' ? '스캔을 누르면 대형주를 훑어 매수 후보를 추립니다.' : 'Press Scan to screen large caps for buy candidates.'}
          </div>
        )}

        {hasResults && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {lang === 'ko'
                ? `${results.length}개 중 매수 후보 ${buyCount}개 · 관심 후보 ${watchCount}개`
                : `${buyCount} buy candidate${buyCount === 1 ? '' : 's'}, ${watchCount} on watch, of ${results.length}`}
              {endDate && <span> · {lang === 'ko' ? `기준일 ${endDate}` : `as of ${endDate}`}</span>}
              {repricedCount > 0 && (
                <span
                  title={lang === 'ko'
                    ? '재무제표는 분기마다 바뀌므로 최근 14~28일 안에 계산한 재무를 다시 쓰고, 적정가 괴리는 오늘 주가로 새로 계산했습니다'
                    : 'Financials change quarterly, so financials computed in the last 14–28 days were reused and the gap was recomputed at today\'s price'}
                >
                  {' · '}{lang === 'ko' ? `${repricedCount}종목은 저장된 재무 + 오늘 주가` : `${repricedCount} with stored financials + today's price`}
                </span>
              )}
              {loadedArchive && (
                <span>
                  {' · '}{lang === 'ko'
                    ? `저장 분석의 최근 스캔을 불러옴${loadedArchive.complete ? '' : ` (중단 ${loadedArchive.scanned}/${loadedArchive.total})`}`
                    : `Loaded the latest saved scan${loadedArchive.complete ? '' : ` (stopped ${loadedArchive.scanned}/${loadedArchive.total})`}`}
                </span>
              )}
            </span>
            {!isRunning && (
              <span className="ml-auto flex items-center gap-1" data-print-hide>
                <Button
                  size="sm"
                  variant={manualSave === 'saved' ? 'secondary' : 'outline'}
                  className="h-7 px-2 text-xs"
                  onClick={saveToArchive}
                  disabled={manualSave === 'saving' || manualSave === 'saved'}
                  title={lang === 'ko' ? "지금 화면의 결과를 '저장 분석'에 남깁니다" : 'Save these results to Saved Analyses'}
                >
                  {manualSave === 'saving' ? <Loader2 size={12} className="mr-1 animate-spin" />
                    : manualSave === 'saved' ? <Check size={12} className="mr-1" />
                    : <Archive size={12} className="mr-1" />}
                  {manualSave === 'saved'
                    ? (lang === 'ko' ? '저장됨' : 'Saved')
                    : manualSave === 'error'
                      ? (lang === 'ko' ? '저장 실패 · 다시' : 'Failed · retry')
                      : (lang === 'ko' ? '저장 분석에 저장' : 'Save to archive')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={exportExcel}
                  title={lang === 'ko' ? '전체 목록을 엑셀 파일(.xlsx)로 받습니다' : 'Download the full list as an Excel file (.xlsx)'}
                >
                  <Download size={12} className="mr-1" />
                  {lang === 'ko' ? '엑셀' : 'Excel'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={exportPdf}
                  title={lang === 'ko' ? "인쇄 창에서 대상을 'PDF로 저장'으로 고르면 PDF 파일로 받습니다" : "Choose 'Save as PDF' in the print dialog"}
                >
                  <FileText size={12} className="mr-1" />
                  PDF
                </Button>
              </span>
            )}
          </div>
        )}

        <QualityBuyResultsView results={results} lang={lang} onAnalyze={openAnalysisFor} showEmptyBuy={hasResults && !isRunning} />

        <div data-print-hide>
          <TrackRecordPanel lang={lang} />
        </div>
      </div>
    </div>
  );
}
