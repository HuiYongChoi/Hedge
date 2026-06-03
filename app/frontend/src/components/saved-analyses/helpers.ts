import { Fragment } from 'react';
import type { SavedAnalysis } from '@/services/saved-analyses-service';
import type { ReportLanguage } from '@/components/reports/analyst-report-v5/types';

export function formatDateShort(iso: string, language: ReportLanguage): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return language === 'ko'
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateLong(iso: string, language: ReportLanguage): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return language === 'ko'
    ? `${formatDateShort(iso, 'ko')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : d.toLocaleString('en-US');
}

export function getSavedDisplayName(item: SavedAnalysis): string {
  const explicit = typeof item.display_name === 'string' ? item.display_name.trim() : '';
  const stored = typeof item.result_data?.saved_display_name === 'string'
    ? item.result_data.saved_display_name.trim()
    : '';
  return explicit || stored || item.ticker;
}

export function sourceTabLabel(source: string, language: ReportLanguage): string {
  if (source === 'stock_analysis') return language === 'ko' ? '종목 분석' : 'Stock Analysis';
  if (source === 'data_sandbox')   return language === 'ko' ? '데이터 샌드박스' : 'Data Sandbox';
  if (source === 'stock_compare')  return language === 'ko' ? '종목 비교' : 'Stock Compare';
  return source;
}

export function sourceTabBadgeClass(source: string): string {
  if (source === 'stock_analysis')
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300';
  if (source === 'data_sandbox')
    return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300';
  if (source === 'stock_compare')
    return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300';
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-500';
}

export function agentCountSummary(item: SavedAnalysis, language: ReportLanguage): string {
  if (item.source_tab === 'stock_analysis') {
    const n =
      item.result_data?.agent_results?.length ??
      item.request_data?.selected_agent_keys?.length ??
      0;
    return language === 'ko' ? `에이전트 ${n}명` : `${n} agents`;
  }
  if (item.source_tab === 'stock_compare') {
    const n = item.result_data?.slots?.length ?? item.request_data?.tickers?.length ?? 0;
    return language === 'ko' ? `비교 종목 ${n}개` : `${n} compared`;
  }
  const fields = Object.keys(item.result_data?.metrics ?? {}).length;
  return language === 'ko' ? `필드 ${fields}개` : `${fields} fields`;
}

export function downloadJson(item: SavedAnalysis): void {
  const data = JSON.stringify(item, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.ticker}-${item.source_tab}-${item.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v);
}

// Re-export Fragment for use in KeyValueTable
export { Fragment };
