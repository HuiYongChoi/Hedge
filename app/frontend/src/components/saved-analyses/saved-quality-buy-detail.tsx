import { useCallback, useMemo, useRef } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadXlsx, printElementAsPdf } from '@/lib/table-export';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';
import { QualityBuyResultsView, buildExportTable } from '@/components/tabs/quality-buy-tab';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import type { ArchivedScan, ScreenerResult } from '@/services/screener-api';
import { TabService } from '@/services/tab-service';

interface Props {
  detail: SavedAnalysis;
  language: ReportLanguage;
}

const MARKET_NAMES: Record<string, { ko: string; en: string }> = {
  ALL: { ko: '대형주 전체', en: 'Large caps' },
  KR: { ko: '한국 대형주', en: 'Korea large caps' },
  US: { ko: '미국 대형주', en: 'US large caps' },
  SP500: { ko: 'S&P 500 전체', en: 'All S&P 500' },
  KOSPI: { ko: '코스피 전체', en: 'All KOSPI' },
};

/** 아카이브에 남긴 매수 후보 스캔 — 스캔 탭과 같은 구역·행(차트·바로가기·과거 검증 포함)으로 보여 준다. */
export function SavedQualityBuyDetail({ detail, language }: Props) {
  const lang = language === 'ko' ? 'ko' : 'en';
  const { openTab } = useTabsContext();
  const { patchWorkspace } = useWorkspace();
  const scan = (detail.result_data ?? {}) as Partial<ArchivedScan>;
  const results: ScreenerResult[] = useMemo(() => (Array.isArray(scan.results) ? scan.results : []), [scan.results]);

  const openAnalysisFor = useCallback((ticker: string) => {
    patchWorkspace({ tickers: ticker });
    openTab(TabService.createStockSearchTab());
  }, [openTab, patchWorkspace]);

  const market = MARKET_NAMES[scan.market ?? ''];
  const marketName = market ? market[lang] : scan.market ?? detail.ticker;
  const scanned = scan.scanned ?? results.length;
  const total = scan.total ?? scanned;
  const buy = results.filter(r => r.verdict === 'buy').length;
  const watch = results.filter(r => r.verdict === 'watch').length;
  const partial = scan.complete === false;

  const printRef = useRef<HTMLDivElement>(null);
  const exportParts = () => {
    const title = lang === 'ko' ? `매수 후보 ${marketName} ${scan.end_date ?? ''}`.trim() : `Buy candidates ${marketName} ${scan.end_date ?? ''}`.trim();
    const subtitle = lang === 'ko'
      ? `${scanned}/${total}종목${partial ? ' (중단)' : ''} · 기준일 ${scan.end_date ?? '—'} · 현재가는 기준일 시가총액 ÷ 주식 수 · 괴리 = 적정가 ÷ 시가총액 − 1`
      : `${scanned}/${total}${partial ? ' (stopped)' : ''} · as of ${scan.end_date ?? '—'} · price = market cap ÷ shares · gap = fair value ÷ market cap − 1`;
    return { table: buildExportTable(results, lang, title, subtitle), filename: `quality-buy_${scan.market ?? detail.ticker}_${scan.end_date ?? detail.id}` };
  };
  const exportExcel = () => {
    const { table, filename } = exportParts();
    downloadXlsx(table, filename);
  };
  const exportPdf = () => {
    if (!printRef.current) return;
    const { table, filename } = exportParts();
    printElementAsPdf(printRef.current, filename, table.subtitle);
  };

  return (
    <div ref={printRef} className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <span className="text-foreground">{marketName}</span>
        {scan.end_date && <span>{lang === 'ko' ? `기준일 ${scan.end_date}` : `As of ${scan.end_date}`}</span>}
        <span className="tabular-nums">
          {lang === 'ko' ? `${scanned}/${total}종목 스캔` : `${scanned}/${total} scanned`}
        </span>
        <span className="tabular-nums">
          {lang === 'ko' ? `매수 후보 ${buy} · 관심 후보 ${watch}` : `Buy ${buy} · Watch ${watch}`}
        </span>
        {partial && (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-amber-600 dark:text-amber-300">
            {lang === 'ko'
              ? '중간에 멈춘 스캔 — 여기까지 받은 결과만 있습니다'
              : 'Stopped scan — only the results received so far'}
          </span>
        )}
        {results.length > 0 && (
          <span className="ml-auto flex items-center gap-1" data-print-hide>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={exportExcel}>
              <Download size={12} className="mr-1" />
              {lang === 'ko' ? '엑셀' : 'Excel'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={exportPdf}>
              <FileText size={12} className="mr-1" />
              PDF
            </Button>
          </span>
        )}
      </div>
      {results.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {lang === 'ko' ? '저장된 종목이 없습니다.' : 'No saved results.'}
        </div>
      ) : (
        <QualityBuyResultsView results={results} lang={lang} onAnalyze={openAnalysisFor} showEmptyBuy={!partial} />
      )}
    </div>
  );
}
