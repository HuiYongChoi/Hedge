import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import {
  AxisSignal,
  ScreenerMarket,
  ScreenerResult,
  ScreenerVerdict,
  screenerApi,
} from '@/services/screener-api';
import { TabService } from '@/services/tab-service';
import { ArrowUpRight, BadgeCheck, ChevronDown, Play, RefreshCw, Square } from 'lucide-react';
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
  { value: 'ALL', ko: '전체', en: 'All' },
  { value: 'KR', ko: '한국', en: 'Korea' },
  { value: 'US', ko: '미국', en: 'US' },
];

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
];

const AXES: { key: 'profitability' | 'growth' | 'financial_health'; ko: string; en: string }[] = [
  { key: 'profitability', ko: '수익성', en: 'Profit' },
  { key: 'growth', ko: '성장', en: 'Growth' },
  { key: 'financial_health', ko: '재무', en: 'Balance' },
];

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
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 first:border-t-0">
      <div className="min-w-[9rem] flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{result.name}</span>
          <span className="text-xs text-muted-foreground">{result.ticker}</span>
        </div>
        <QualityDots result={result} lang={lang} />
      </div>
      {failed ? (
        <div className="max-w-[28rem] text-right text-xs text-muted-foreground">{failureReason(result, lang)}</div>
      ) : (
        <>
          <div className="w-24 text-right">
            <div
              className={cn(
                'font-mono text-sm tabular-nums',
                gap === null ? 'text-muted-foreground' : gap > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}
            >
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
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onAnalyze(result.ticker)}>
        {t('stockAnalysis', lang)}
        <ArrowUpRight size={12} className="ml-1" />
      </Button>
      {result.error && result.verdict !== 'insufficient' && (
        <div className="basis-full text-[11px] text-muted-foreground" title={result.error}>
          {lang === 'ko' ? '일부 데이터 조회 실패' : 'Some data failed to load'}
        </div>
      )}
    </div>
  );
}

export function QualityBuyTab() {
  const { language } = useLanguage();
  const lang: Lang = language === 'ko' ? 'ko' : 'en';
  const { openTab } = useTabsContext();
  const { patchWorkspace } = useWorkspace();

  const [market, setMarket] = useState<ScreenerMarket>('ALL');
  const [results, setResults] = useState<ScreenerResult[]>(() => loadSaved().ALL?.results ?? []);
  const [endDate, setEndDate] = useState<string | null>(() => loadSaved().ALL?.endDate ?? null);
  const [total, setTotal] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const changeMarket = (next: ScreenerMarket) => {
    if (isRunning || next === market) return;
    const saved = loadSaved()[next];
    setMarket(next);
    setResults(saved?.results ?? []);
    setEndDate(saved?.endDate ?? null);
    setTotal(0);
    setError(null);
  };

  const startScan = useCallback((refresh: boolean) => {
    stopRef.current?.();
    setResults([]);
    setTotal(0);
    setError(null);
    setIsRunning(true);

    const collected: ScreenerResult[] = [];
    let scanDate: string | null = null;
    stopRef.current = screenerApi.scan(market, refresh, {
      onStart: info => {
        setTotal(info.total);
        setEndDate(info.end_date);
        scanDate = info.end_date;
      },
      onResult: result => {
        collected.push(result);
        setResults([...collected]);
      },
      onComplete: () => {
        setIsRunning(false);
        stopRef.current = null;
        persist(market, { endDate: scanDate, results: collected });
      },
      onError: message => {
        setIsRunning(false);
        stopRef.current = null;
        setError(message);
      },
    });
  }, [market]);

  const stopScan = () => {
    stopRef.current?.();
    stopRef.current = null;
    setIsRunning(false);
  };

  const openAnalysisFor = useCallback((ticker: string) => {
    patchWorkspace({ tickers: ticker });
    openTab(TabService.createStockSearchTab());
  }, [openTab, patchWorkspace]);

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

  const buyCount = grouped.get('buy')?.length ?? 0;
  const watchCount = grouped.get('watch')?.length ?? 0;
  const rest = [...(grouped.get('not_quality') ?? []), ...(grouped.get('insufficient') ?? [])];
  const progressPct = total > 0 ? Math.round((results.length / total) * 100) : 0;
  const hasResults = results.length > 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <BadgeCheck size={18} className="text-primary" />
          <h2 className="text-lg font-semibold">{t('qualityBuy', language)}</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-border p-0.5">
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
                    title={lang === 'ko' ? '오늘 저장된 계산 결과를 무시하고 다시 조회합니다' : "Ignore today's cached results and re-fetch"}
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
            <>
              종목 분석은 <b className="text-foreground">'지금 싼가'</b>에 매수 기준이 걸려 있어, 비싸게 거래되는 우량주는 대부분 중립·매도로 나옵니다.
              여기서는 두 질문을 나눠 봅니다. <b className="text-foreground">① 우량한가</b> — 수익성·성장·재무건전성 셋 중 둘 이상이 강하고 약한 항목이 없음.{' '}
              <b className="text-foreground">② 지금 싼가</b> — 계산한 적정가가 시가총액보다 15% 넘게 높음(종목 분석의 가치평가 매수 기준과 같음).
              아직 싸지 않은 우량주 가운데 적정가에서 크게 벗어나지 않은 종목은 <b className="text-foreground">관심 후보</b>로 따로 모으고, 얼마나 내려야 매수 구간인지 함께 보여 줍니다.
              AI 호출 없이 계산만 하므로 빠르고, 같은 날 다시 스캔하면 저장된 결과를 바로 보여 줍니다. 대상은 한국·미국 대형주 각 25개입니다.
            </>
          ) : (
            <>
              Stock Analysis only turns bullish when a stock is <b className="text-foreground">cheap</b>, so richly priced quality stocks mostly show neutral or bearish.
              This view splits the two questions. <b className="text-foreground">① Quality</b> — at least two of profitability, growth and balance-sheet health are strong, none weak.{' '}
              <b className="text-foreground">② Cheap now</b> — estimated fair value exceeds market cap by more than 15% (the same bar as the valuation analyst).
              Quality names close to fair value but not yet cheap go to the <b className="text-foreground">watchlist</b>, with the decline needed to reach the buy zone.
              No AI calls, only calculations; re-scanning on the same day returns cached results. Universe: 25 Korean and 25 US large caps.
            </>
          )}
        </div>

        {/* Progress */}
        {(isRunning || (total > 0 && results.length < total)) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{lang === 'ko' ? '스캔 중…' : 'Scanning…'}</span>
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

        {!hasResults && !isRunning && !error && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {lang === 'ko' ? '스캔을 누르면 대형주를 훑어 매수 후보를 추립니다.' : 'Press Scan to screen large caps for buy candidates.'}
          </div>
        )}

        {hasResults && (
          <div className="text-xs text-muted-foreground">
            {lang === 'ko'
              ? `${results.length}개 중 매수 후보 ${buyCount}개 · 관심 후보 ${watchCount}개`
              : `${buyCount} buy candidate${buyCount === 1 ? '' : 's'}, ${watchCount} on watch, of ${results.length}`}
            {endDate && <span> · {lang === 'ko' ? `기준일 ${endDate}` : `as of ${endDate}`}</span>}
          </div>
        )}

        {/* Sections */}
        {SECTIONS.map(section => {
          const list = grouped.get(section.verdict) ?? [];
          if (list.length === 0 && !(section.verdict === 'buy' && hasResults && !isRunning)) return null;
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
                    <ResultRow key={r.ticker} result={r} lang={lang} onAnalyze={openAnalysisFor} />
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
                <ResultRow key={r.ticker} result={r} lang={lang} onAnalyze={openAnalysisFor} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
