import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import {
  attributePriceMove,
  attributionSummary,
  diffMarketSnapshots,
  readMarketSnapshot,
  type SnapshotDiffRow,
} from '@/components/reports/analyst-report-v5/market-snapshot';
import { formatDateShort } from './helpers';
import { savedAnalysisService, type SavedAnalysis } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';

interface Props {
  /** 지금 보고 있는 저장 분석 */
  current: SavedAnalysis;
  language: ReportLanguage;
}

function formatSnapshotValue(
  value: number | string | null,
  format: SnapshotDiffRow['format'],
  currency: string | null,
): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  if (format === 'multiple') return `${value.toFixed(1)}`;
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  if (format === 'count') return value.toLocaleString();
  // currency
  const symbol = currency === 'KRW' ? '₩' : currency === 'JPY' ? '¥' : '$';
  const digits = currency === 'KRW' || currency === 'JPY' ? 0 : 2;
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** 변화의 색: 좋아졌으면 초록, 나빠졌으면 빨강, 방향성이 없는 지표는 중립 회색 */
function changeToneClass(row: SnapshotDiffRow): string {
  if (row.direction === 'flat' || row.changePct === null) return 'text-muted-foreground';
  if (row.higherIsBetter === null) return 'text-foreground';
  const good = row.higherIsBetter ? row.direction === 'up' : row.direction === 'down';
  return good
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
}

function DirectionIcon({ direction }: { direction: SnapshotDiffRow['direction'] }) {
  if (direction === 'up') return <ArrowUp className="h-3 w-3" aria-hidden />;
  if (direction === 'down') return <ArrowDown className="h-3 w-3" aria-hidden />;
  return <ArrowRight className="h-3 w-3 opacity-40" aria-hidden />;
}

export function SnapshotDiffPanel({ current, language }: Props) {
  const ko = language === 'ko';
  const [history, setHistory] = useState<SavedAnalysis[]>([]);

  // 같은 종목의 과거 저장분을 직접 조회한다(부모에서 목록을 내려받지 않아도 동작).
  useEffect(() => {
    let cancelled = false;
    savedAnalysisService
      .listAnalyses({ ticker: current.ticker, source_tab: 'stock_analysis', limit: 30 })
      .then(res => { if (!cancelled) setHistory(res.items); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [current.id, current.ticker]);

  const { previous, rows, attribution, currency } = useMemo(() => {
    const currentSnap = readMarketSnapshot(current.result_data);
    // 같은 종목의, 현재보다 과거이면서 스냅샷을 가진 가장 최근 저장분
    const prevItem = history.find(item =>
      item.id !== current.id
      && item.ticker === current.ticker
      && new Date(item.created_at).getTime() < new Date(current.created_at).getTime()
      && readMarketSnapshot(item.result_data) !== null,
    ) ?? null;
    const prevSnap = prevItem ? readMarketSnapshot(prevItem.result_data) : null;

    if (!currentSnap || !prevSnap) {
      return { previous: prevItem, rows: [], attribution: null, currency: null };
    }
    return {
      previous: prevItem,
      rows: diffMarketSnapshots(prevSnap, currentSnap),
      attribution: attributePriceMove(prevSnap, currentSnap),
      currency: currentSnap.currency ?? prevSnap.currency,
    };
  }, [current, history]);

  const currentSnap = readMarketSnapshot(current.result_data);

  // 현재 저장분에 스냅샷 자체가 없음 = 이 기능 도입 이전에 저장된 리포트
  if (!currentSnap) {
    return (
      <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {ko ? '이전 분석 대비 변화' : 'Change vs previous'}
        </h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {ko
            ? '이 리포트에는 저장 시점의 시장 값이 없습니다. 앞으로 저장하는 분석부터 변화 추적이 가능합니다.'
            : 'This report has no saved market snapshot. Tracking starts from analyses saved from now on.'}
        </p>
      </section>
    );
  }

  if (!previous || rows.length === 0) {
    return (
      <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {ko ? '이전 분석 대비 변화' : 'Change vs previous'}
        </h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {ko
            ? `비교할 이전 분석이 없습니다. ${current.ticker}를 다시 분석해 저장하면 이 자리에 변화가 표시됩니다.`
            : `No earlier analysis to compare. Save ${current.ticker} again to see changes here.`}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {ko ? '이전 분석 대비 변화' : 'Change vs previous'}
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDateShort(previous.created_at, language)} → {formatDateShort(current.created_at, language)}
        </span>
      </div>

      {attribution && (
        <p className="mt-2 rounded border border-border/50 bg-background/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/90">
          {attributionSummary(attribution, language)}
        </p>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-2 text-left font-medium">{ko ? '지표' : 'Metric'}</th>
              <th className="py-1 px-2 text-right font-medium">{ko ? '이전' : 'Before'}</th>
              <th className="py-1 px-2 text-right font-medium">{ko ? '현재' : 'After'}</th>
              <th className="py-1 pl-2 text-right font-medium">{ko ? '변화' : 'Change'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={String(row.key)} className="border-t border-border/40">
                <td className="py-1.5 pr-2 text-muted-foreground">{ko ? row.labelKo : row.labelEn}</td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-muted-foreground">
                  {formatSnapshotValue(row.before, row.format, currency)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-foreground">
                  {formatSnapshotValue(row.after, row.format, currency)}
                </td>
                <td className={`py-1.5 pl-2 text-right font-mono tabular-nums ${changeToneClass(row)}`}>
                  <span className="inline-flex items-center justify-end gap-1">
                    <DirectionIcon direction={row.direction} />
                    {row.changePct === null
                      ? '—'
                      : `${row.changePct >= 0 ? '+' : ''}${(row.changePct * 100).toFixed(1)}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {ko
          ? '두 저장 시점의 값을 그대로 비교한 것입니다. 컨센서스 EPS가 아직 갱신되지 않았다면 선행 PER 변화는 주가 변동만 반영합니다.'
          : 'Compares values as saved at each point. If consensus EPS has not been revised yet, the fwd P/E change reflects price movement only.'}
      </p>
    </section>
  );
}
