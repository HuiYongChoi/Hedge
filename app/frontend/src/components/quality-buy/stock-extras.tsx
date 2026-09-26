// 매수 후보 결과 행의 부가 기능 — 외부 사이트 바로가기와 1년 주가 호버 차트.
// 스캔 탭과 '저장 분석' 아카이브가 같은 행을 쓰므로 둘 다 여기서 가져간다.

import { cn } from '@/lib/utils';
import { PriceChart, ScreenerResult, screenerApi } from '@/services/screener-api';
import { ChartLine, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Lang = 'ko' | 'en';

export interface ResearchLink {
  label: string;
  hint: string;
  href: string;
}

function krCode(ticker: string): string {
  return ticker.split('.')[0];
}

/** 시장별 바로가기. 미국 네이버 주소는 거래소 코드가 필요해 따로(비동기로) 붙인다. */
export function researchLinks(result: Pick<ScreenerResult, 'ticker' | 'market'>, lang: Lang): ResearchLink[] {
  const ko = lang === 'ko';
  if (result.market === 'KR') {
    const code = encodeURIComponent(krCode(result.ticker));
    return [
      { label: ko ? '네이버 증권' : 'Naver Finance', hint: ko ? '시세·종합' : 'Quote', href: `https://finance.naver.com/item/main.naver?code=${code}` },
      { label: ko ? '네이버 기업정보' : 'Naver company info', hint: ko ? '재무·실적' : 'Financials', href: `https://finance.naver.com/item/coinfo.naver?code=${code}` },
      { label: ko ? '네이버 리서치' : 'Naver research', hint: ko ? '증권사 리포트' : 'Broker reports', href: `https://stock.naver.com/domestic/stock/${code}/research` },
      { label: ko ? '네이버 뉴스' : 'Naver news', hint: ko ? '종목 뉴스' : 'News', href: `https://finance.naver.com/item/news.naver?code=${code}` },
      // autoSearch=true + option=corp가 있어야 종목코드 자동 검색이 실행된다(종목 분석 탭과 같은 주소).
      { label: 'DART', hint: ko ? '공시·사업보고서' : 'Filings', href: `https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&option=corp&textCrpNm=${code}` },
      { label: 'FnGuide', hint: ko ? '컨센서스' : 'Consensus', href: `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${code}` },
    ];
  }
  const t = encodeURIComponent(result.ticker);
  // 신형 EDGAR 경로는 숫자 CIK만 받는다 — cgi-bin 이 티커를 CIK로 해석한다(종목 분석 탭과 같은 주소).
  const edgar = (type: string) =>
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t}&type=${type}&dateb=&owner=exclude&count=40`;
  return [
    { label: 'SEC 10-K', hint: ko ? '연간 보고서' : 'Annual report', href: edgar('10-K') },
    { label: 'SEC 10-Q', hint: ko ? '분기 보고서' : 'Quarterly report', href: edgar('10-Q') },
    { label: 'SEC 8-K', hint: ko ? '수시 공시' : 'Current reports', href: edgar('8-K') },
    { label: 'Yahoo Finance', hint: ko ? '시세·재무' : 'Quote', href: `https://finance.yahoo.com/quote/${t}` },
    { label: 'Finviz', hint: ko ? '지표 요약' : 'Snapshot', href: `https://finviz.com/quote.ashx?t=${t}` },
  ];
}

function LinkChip({ link }: { link: ResearchLink }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:border-primary/60 hover:text-primary"
    >
      <span className="font-medium">{link.label}</span>
      <span className="text-muted-foreground">{link.hint}</span>
      <ExternalLink size={10} className="text-muted-foreground" />
    </a>
  );
}

/** 펼친 행에 보여 주는 바로가기 모음. */
export function ResearchLinksPanel({ result, lang }: { result: Pick<ScreenerResult, 'ticker' | 'market'>; lang: Lang }) {
  const [naver, setNaver] = useState<string | null | undefined>(result.market === 'US' ? undefined : null);

  useEffect(() => {
    if (result.market !== 'US') return;
    let cancelled = false;
    screenerApi
      .fetchNaverLink(result.ticker)
      .then(body => { if (!cancelled) setNaver(body.url); })
      .catch(() => { if (!cancelled) setNaver(null); });
    return () => { cancelled = true; };
  }, [result.ticker, result.market]);

  const links = researchLinks(result, lang);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded border border-border/60 bg-muted/10 p-2">
      {result.market === 'US' && naver && (
        <LinkChip link={{ label: lang === 'ko' ? '네이버 증권' : 'Naver Finance', hint: lang === 'ko' ? '해외주식' : 'US stock', href: naver }} />
      )}
      {result.market === 'US' && naver === undefined && (
        <span className="inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          <Loader2 size={10} className="animate-spin" />
          {lang === 'ko' ? '네이버 주소 찾는 중' : 'Finding Naver link'}
        </span>
      )}
      {links.map(link => <LinkChip key={link.label} link={link} />)}
    </div>
  );
}

// ── 1년 주가 호버 차트 ─────────────────────────────────────────────────────────

// 같은 화면에서 여러 번 올려도 한 번만 받는다(서버도 하루 동안 기억한다).
const chartCache = new Map<string, PriceChart>();

function formatAxis(value: number, market: 'KR' | 'US'): string {
  if (market === 'KR') return Math.round(value).toLocaleString('ko-KR');
  return value >= 1000 ? Math.round(value).toLocaleString('en-US') : value.toFixed(value >= 100 ? 0 : 2);
}

function formatMoney(value: number, market: 'KR' | 'US'): string {
  return market === 'KR' ? `₩${Math.round(value).toLocaleString('ko-KR')}` : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function pct(value: number): string {
  const p = value * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

interface RefLine { label: string; value: number; className: string }

const W = 300;
const H = 140;
const PAD = { l: 46, r: 8, t: 10, b: 20 };

function ChartSvg({ rows, market, refs }: { rows: PriceChart['rows']; market: 'KR' | 'US'; refs: RefLine[] }) {
  const values = rows.map(r => r.close);
  const all = [...values, ...refs.map(r => r.value)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const w = W - PAD.l - PAD.r;
  const h = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * w);
  const y = (v: number) => PAD.t + (1 - (v - min) / range) * h;
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.close).toFixed(1)}`).join(' ');
  const area = `${line} L${x(rows.length - 1).toFixed(1)},${PAD.t + h} L${x(0).toFixed(1)},${PAD.t + h} Z`;
  const ticks = [0, 1, 2, 3].map(k => min + (range * k) / 3);
  const xLabels = [0, Math.floor((rows.length - 1) / 2), rows.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img">
      {ticks.map(v => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.l - 4} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground" fontSize={9}>
            {formatAxis(v, market)}
          </text>
        </g>
      ))}
      {xLabels.map((idx, k) => (
        <text
          key={k}
          x={x(idx)}
          y={H - 5}
          textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
          className="fill-muted-foreground"
          fontSize={9}
        >
          {rows[idx]?.date.slice(2).replace(/-/g, '.')}
        </text>
      ))}
      {/* 오르내림 색은 한국(빨강=상승)과 미국 관례가 반대라, 선은 중립색으로 그린다(Investment Navigator 와 같음). */}
      <g className="text-sky-500">
        <path d={area} fill="currentColor" opacity={0.12} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(rows.length - 1)} cy={y(values[values.length - 1])} r={2.6} fill="currentColor" />
      </g>
      {refs.map((ref, i) => (
        <g key={ref.label} className={ref.className}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(ref.value)} y2={y(ref.value)} stroke="currentColor" strokeWidth={1} strokeDasharray="4 3" />
          {/* 두 선이 가까우면 이름이 겹치므로 하나는 오른쪽 끝, 하나는 왼쪽 끝에 적는다. */}
          <text
            x={i === 0 ? W - PAD.r : PAD.l + 2}
            y={y(ref.value) + (i === 0 ? -3 : 10)}
            textAnchor={i === 0 ? 'end' : 'start'}
            fill="currentColor"
            fontSize={9}
          >
            {ref.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ChartBody({ result, lang, chart, error }: { result: ScreenerResult; lang: Lang; chart: PriceChart | null; error: boolean }) {
  const ko = lang === 'ko';
  if (error || (chart && chart.rows.length < 2)) {
    return <div className="py-6 text-center text-[11px] text-muted-foreground">{ko ? '주가를 불러오지 못했습니다' : 'Could not load prices'}</div>;
  }
  if (!chart) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        {ko ? '차트 불러오는 중…' : 'Loading chart…'}
      </div>
    );
  }
  const rows = chart.rows;
  const values = rows.map(r => r.close);
  const last = values[values.length - 1];
  const high = Math.max(...values);
  const low = Math.min(...values);
  const change = last / values[0] - 1;

  // 적정가·매수 기준가는 '시가총액 ÷ 주식 수' 기준이라, 차트 종가와 주식 단위가 다르면(우선주·ADR 등)
  // 선이 엉뚱한 곳에 그려진다. 스캔 때 가격과 차트 종가가 크게 다르면 선을 생략한다.
  const scanPrice = result.value.price_per_share ?? null;
  const comparable = scanPrice !== null && scanPrice > 0 && Math.abs(last / scanPrice - 1) < 0.35;
  const refs: RefLine[] = [];
  if (comparable) {
    const fair = result.value.intrinsic_per_share;
    const buy = result.value.buy_price_per_share ?? null;
    const inRange = (v: number) => v > low * 0.5 && v < high * 1.6;
    if (fair !== null && Number.isFinite(fair) && inRange(fair)) {
      refs.push({ label: ko ? '적정가' : 'Fair value', value: fair, className: 'text-emerald-500' });
    }
    if (buy !== null && Number.isFinite(buy) && inRange(buy)) {
      refs.push({ label: ko ? '매수 기준가' : 'Buy below', value: buy, className: 'text-amber-500' });
    }
  }

  return (
    <>
      <ChartSvg rows={rows} market={result.market} refs={refs} />
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
        <span className="text-muted-foreground">{ko ? '1년 수익률' : '1Y return'}</span>
        <span className={cn('text-right', change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
          {pct(change)}
        </span>
        <span className="text-muted-foreground">{ko ? '최근 종가' : 'Last close'}</span>
        <span className="text-right">{formatMoney(last, result.market)}</span>
        <span className="text-muted-foreground">{ko ? '1년 고 · 저' : '1Y high · low'}</span>
        <span className="text-right">{formatMoney(high, result.market)} · {formatMoney(low, result.market)}</span>
        <span className="text-muted-foreground">{ko ? '고점 대비' : 'From high'}</span>
        <span className="text-right">{pct(last / high - 1)}</span>
      </div>
      {!comparable && scanPrice !== null && (
        <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {ko
            ? '스캔 가격(시가총액 ÷ 주식 수)과 종가 단위가 달라 적정가 선은 생략했습니다.'
            : 'Scan price (market cap ÷ shares) differs from the quote, so fair-value lines are omitted.'}
        </div>
      )}
    </>
  );
}

const POP_WIDTH = 320;

/** 차트 아이콘 — 마우스를 올리면 최근 1년 주봉 차트를, 누르면 고정해서 보여 준다. */
export function PriceChartHover({ result, lang }: { result: ScreenerResult; lang: Lang }) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [chart, setChart] = useState<PriceChart | null>(() => chartCache.get(result.ticker) ?? null);
  const [error, setError] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const open = hovered || pinned;

  useEffect(() => {
    if (!open || chart || error) return;
    let cancelled = false;
    screenerApi
      .fetchPriceChart(result.ticker)
      .then(body => {
        if (cancelled) return;
        if (body.rows.length >= 2) chartCache.set(result.ticker, body);
        setChart(body);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [open, chart, error, result.ticker]);

  // 행을 감싼 구역이 overflow-hidden 이라, 팝업은 body 에 fixed 로 띄우고 화면 안쪽으로 맞춘다.
  useLayoutEffect(() => {
    if (!open || !iconRef.current) return;
    const place = () => {
      const r = iconRef.current!.getBoundingClientRect();
      const popH = popRef.current?.offsetHeight ?? 240;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const left = Math.max(8, Math.min(r.left - 8, vw - POP_WIDTH - 8));
      const below = r.bottom + 6;
      const top = below + popH > vh - 8 ? Math.max(8, r.top - popH - 6) : below;
      setPos({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, chart, error]);

  // 고정(클릭)한 팝업은 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!pinned) return;
    const close = (event: MouseEvent) => {
      if (iconRef.current?.contains(event.target as Node)) return;
      setPinned(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [pinned]);

  const title = lang === 'ko' ? `${result.name} 1년 주가` : `${result.name} 1-year price`;
  return (
    <>
      <button
        ref={iconRef}
        type="button"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned(v => !v)}
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
        )}
        aria-label={title}
        aria-expanded={open}
      >
        <ChartLine size={12} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          role="tooltip"
          className="pointer-events-none fixed z-[1000] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
          style={{ width: POP_WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
        >
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-semibold">{result.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {result.ticker} · {lang === 'ko' ? '주봉 · 1년' : 'Weekly · 1Y'}
            </span>
          </div>
          <ChartBody result={result} lang={lang} chart={chart} error={error} />
        </div>,
        document.body,
      )}
    </>
  );
}
