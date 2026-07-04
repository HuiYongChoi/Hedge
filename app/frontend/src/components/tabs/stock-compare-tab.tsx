import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveTickerValue, TickerInput } from '@/components/ui/ticker-input';
import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { TabService } from '@/services/tab-service';
import { buildValuationDeepDive } from '@/components/reports/analyst-report-v5/helpers';
import type { ValuationDeepDive, ValuationModel } from '@/components/reports/analyst-report-v5/types';
import { getDefaultModel } from '@/data/models';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import { analystTargetService } from '@/services/analyst-target-service';
import { savedAnalysisService } from '@/services/saved-analyses-service';
import { Archive, ArrowUpRight, Network, Plus, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

const MAX_SLOTS = 6;
const DEFAULT_COMPARE_TICKERS = ['MU', 'SK하이닉스', '삼성전자'];
const STORAGE_KEY = 'stock-compare:slots';

// Preferred valuation-model row order; any extra model keys are appended dynamically
// so newly added backend methods (e.g. EBITDA-normalized, ROIC-WACC EVA) show up
// automatically without editing this file.
const PREFERRED_MODEL_ORDER = [
  'dcf',
  'owner_earnings',
  'ev_ebitda',
  'ev_ebit',
  'ebitda_valuation',
  'roic_wacc_valuation',
  'residual_income',
  'pbr_band',
];

interface PricePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TickerSuggestion {
  ticker: string;
  name: string;
  market?: string;
}

interface CompareSlot {
  id: string;
  ticker: string;
  status: 'empty' | 'loading' | 'ready' | 'error';
  metrics?: Record<string, any>;
  annualMetrics?: Record<string, any>;
  forwardMetrics?: Record<string, any>;
  prices?: PricePoint[];
  lineItems?: Record<string, any>[];
  currentPrice?: number | null;
  targetConsensus?: number | null;
  valuation?: ValuationDeepDive | null;
  signal?: { signal: string; confidence: number } | null;
  error?: string;
  progressMessage?: string;
}

type ChartMetricKey = 'relative_price' | 'eps' | 'free_cash_flow' | 'operating_income_growth' | 'liabilities_to_equity';
type ChartWindow = '3m' | '1y' | '3y' | '5y' | 'all';
type ChartAxisMode = 'normalized' | 'actual';
type ChartDateDomain = { min: number; max: number; labels: string[] };

const COMPARISON_CHART_METRICS: Array<{
  key: ChartMetricKey;
  ko: string;
  en: string;
  unit?: string;
}> = [
  { key: 'relative_price', ko: '상대 가격', en: 'Relative price', unit: '%' },
  { key: 'eps', ko: 'EPS', en: 'EPS' },
  { key: 'free_cash_flow', ko: 'FCF', en: 'FCF' },
  { key: 'operating_income_growth', ko: '영업이익상승률', en: 'Operating income growth', unit: '%' },
  { key: 'liabilities_to_equity', ko: '부채비율', en: 'Debt ratio', unit: '%' },
];

const FINANCIAL_ROWS: Array<{ key: string; ko: string; en: string; percent?: boolean }> = [
  { key: 'currentPrice', ko: '현재가', en: 'Current price' },
  { key: 'price_to_earnings_ratio', ko: 'PER (TTM)', en: 'P/E (TTM)' },
  { key: 'forward_pe', ko: 'FwdPER (NTM·분기합산)', en: 'Fwd P/E (NTM)' },
  { key: 'forward_pe_fy0', ko: 'FwdPER (올해)', en: 'Fwd P/E (FY0)' },
  { key: 'forward_pe_fy1', ko: 'FwdPER (내년)', en: 'Fwd P/E (FY1)' },
  { key: 'price_to_book_ratio', ko: 'PBR', en: 'P/B' },
  { key: 'enterprise_value_to_ebitda_ratio', ko: 'EV/EBITDA', en: 'EV/EBITDA' },
  { key: 'operating_margin', ko: '영업이익률', en: 'Operating margin', percent: true },
  { key: 'net_margin', ko: '순이익률', en: 'Net margin', percent: true },
  { key: 'operating_margin_q', ko: '영업이익률 (분기)', en: 'Op margin (Q)', percent: true },
  { key: 'net_margin_q', ko: '순이익률 (분기)', en: 'Net margin (Q)', percent: true },
  { key: 'return_on_equity', ko: 'ROE', en: 'ROE', percent: true },
  { key: 'return_on_invested_capital', ko: 'ROIC', en: 'ROIC', percent: true },
  { key: 'revenue_growth', ko: '매출 성장 (연간)', en: 'Revenue growth (FY)', percent: true },
  { key: 'operating_income_growth', ko: '영업이익 성장 (연간)', en: 'Operating income growth (FY)', percent: true },
  { key: 'earnings_growth', ko: '순이익 성장 (연간)', en: 'Net income growth (FY)', percent: true },
  { key: 'revenue_growth_yoy', ko: '매출 성장 (분기 YoY)', en: 'Revenue growth (Q YoY)', percent: true },
  { key: 'operating_income_growth_yoy', ko: '영업이익 성장 (분기 YoY)', en: 'Operating income growth (Q YoY)', percent: true },
  { key: 'earnings_growth_yoy', ko: '순이익 성장 (분기 YoY)', en: 'Net income growth (Q YoY)', percent: true },
  { key: 'revenue_growth_qoq', ko: '매출 성장 (QoQ)', en: 'Revenue growth (QoQ)', percent: true },
  { key: 'operating_income_growth_qoq', ko: '영업이익 성장 (QoQ)', en: 'Operating income growth (QoQ)', percent: true },
  { key: 'earnings_growth_qoq', ko: '순이익 성장 (QoQ)', en: 'Net income growth (QoQ)', percent: true },
  { key: 'liabilities_to_equity', ko: '부채비율', en: 'Debt ratio', percent: true },
  { key: 'debt_to_equity', ko: '이자부채비율', en: 'Debt/Equity (int)' },
  { key: 'interest_coverage', ko: '이자보상배율', en: 'Interest coverage' },
];

const ANNUAL_GROWTH_KEYS = new Set(['revenue_growth', 'operating_income_growth', 'earnings_growth']);

const VALUATION_BAR_ROWS = [
  { key: 'dcf', ko: 'DCF', en: 'DCF', higherIsBetter: true },
  { key: 'owner_earnings', ko: 'Owner Earnings', en: 'Owner Earnings', higherIsBetter: true },
  { key: 'ev_ebitda', ko: 'EV/EBITDA', en: 'EV/EBITDA', higherIsBetter: true },
  { key: 'ev_ebit', ko: 'EV/EBIT', en: 'EV/EBIT', higherIsBetter: true },
  { key: 'ebitda_valuation', ko: 'EBITDA (정규화)', en: 'EBITDA normalized', higherIsBetter: true },
  { key: 'roic_wacc_valuation', ko: 'ROIC-WACC EVA', en: 'ROIC-WACC EVA', higherIsBetter: true },
  { key: 'residual_income', ko: 'RIM', en: 'RIM', higherIsBetter: true },
  { key: 'broker_target', ko: '증권사 평균 목표치', en: 'Broker target', higherIsBetter: true },
];

const FINANCIAL_BAR_GROUPS: Array<{
  key: string;
  ko: string;
  en: string;
  rows: Array<{ key: string; ko: string; en: string; higherIsBetter: boolean; percent?: boolean }>;
}> = [
  {
    key: 'valuation',
    ko: '밸류에이션',
    en: 'Valuation',
    rows: [
      { key: 'price_to_earnings_ratio', ko: 'PER (TTM)', en: 'P/E (TTM)', higherIsBetter: false },
      { key: 'forward_pe', ko: 'FwdPER (NTM)', en: 'Fwd P/E (NTM)', higherIsBetter: false },
      { key: 'forward_pe_fy0', ko: 'FwdPER (올해)', en: 'Fwd P/E (FY0)', higherIsBetter: false },
      { key: 'forward_pe_fy1', ko: 'FwdPER (내년)', en: 'Fwd P/E (FY1)', higherIsBetter: false },
      { key: 'price_to_book_ratio', ko: 'PBR', en: 'P/B', higherIsBetter: false },
      { key: 'enterprise_value_to_ebitda_ratio', ko: 'EV/EBITDA', en: 'EV/EBITDA', higherIsBetter: false },
    ],
  },
  {
    key: 'quality',
    ko: '수익성·퀄리티',
    en: 'Profitability & quality',
    rows: [
      { key: 'operating_margin', ko: '영업이익률', en: 'Operating margin', higherIsBetter: true, percent: true },
      { key: 'net_margin', ko: '순이익률', en: 'Net margin', higherIsBetter: true, percent: true },
      { key: 'operating_margin_q', ko: '영업이익률 (분기)', en: 'Op margin (Q)', higherIsBetter: true, percent: true },
      { key: 'net_margin_q', ko: '순이익률 (분기)', en: 'Net margin (Q)', higherIsBetter: true, percent: true },
      { key: 'operating_income_growth', ko: '영업이익 성장 (연간)', en: 'Operating income growth (FY)', higherIsBetter: true, percent: true },
      { key: 'operating_income_growth_yoy', ko: '영업이익 성장 (분기 YoY)', en: 'Operating income growth (Q YoY)', higherIsBetter: true, percent: true },
      { key: 'earnings_growth', ko: '순이익 성장 (연간)', en: 'Net income growth (FY)', higherIsBetter: true, percent: true },
      { key: 'earnings_growth_yoy', ko: '순이익 성장 (분기 YoY)', en: 'Net income growth (Q YoY)', higherIsBetter: true, percent: true },
      { key: 'return_on_equity', ko: 'ROE', en: 'ROE', higherIsBetter: true, percent: true },
      { key: 'return_on_invested_capital', ko: 'ROIC', en: 'ROIC', higherIsBetter: true, percent: true },
    ],
  },
  {
    key: 'growth_leverage',
    ko: '성장·레버리지',
    en: 'Growth & leverage',
    rows: [
      { key: 'revenue_growth', ko: '매출 성장 (연간)', en: 'Revenue growth (FY)', higherIsBetter: true, percent: true },
      { key: 'operating_income_growth', ko: '영업이익 성장 (연간)', en: 'Operating income growth (FY)', higherIsBetter: true, percent: true },
      { key: 'earnings_growth', ko: '순이익 성장 (연간)', en: 'Net income growth (FY)', higherIsBetter: true, percent: true },
      { key: 'revenue_growth_yoy', ko: '매출 성장 (분기 YoY)', en: 'Revenue growth (Q YoY)', higherIsBetter: true, percent: true },
      { key: 'operating_income_growth_yoy', ko: '영업이익 성장 (분기 YoY)', en: 'Operating income growth (Q YoY)', higherIsBetter: true, percent: true },
      { key: 'earnings_growth_yoy', ko: '순이익 성장 (분기 YoY)', en: 'Net income growth (Q YoY)', higherIsBetter: true, percent: true },
      { key: 'liabilities_to_equity', ko: '부채비율', en: 'Debt ratio', higherIsBetter: false, percent: true },
      { key: 'interest_coverage', ko: '이자보상배율', en: 'Interest coverage', higherIsBetter: true },
    ],
  },
];

function fmtNum(value: unknown, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtSignedPercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function fmtCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTargetWithGap(target: number | null | undefined, currentPrice: number | null | undefined): string {
  if (typeof target !== 'number' || !Number.isFinite(target)) return '—';
  const formattedTarget = fmtCurrency(target);
  if (typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || currentPrice === 0) {
    return formattedTarget;
  }
  const gap = (target / currentPrice) - 1;
  return `${formattedTarget} (${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}%)`;
}

function getValuationReferenceValue(slot: CompareSlot, rowKey: string): number | null {
  if (rowKey === 'broker_target') return numericValue(slot.targetConsensus);
  const model = slot.valuation?.models.find(item => item.key === rowKey);
  return numericValue(model?.intrinsicPerShare);
}

function formatValuationBarPrimary(slot: CompareSlot, row: MetricBarRow, language: 'ko' | 'en'): string | null {
  const target = getValuationReferenceValue(slot, row.key);
  if (target === null) return null;
  const label = row.key === 'broker_target'
    ? (language === 'ko' ? '목표가' : 'Target')
    : (language === 'ko' ? '가치' : 'Value');
  return `${label} ${fmtCurrency(target)}`;
}

function formatValuationBarSecondary(value: number, language: 'ko' | 'en'): string {
  return language === 'ko'
    ? `현재가 대비 ${fmtSignedPercent(value)}`
    : `vs current ${fmtSignedPercent(value)}`;
}

function getValuationBarTooltip(slot: CompareSlot, row: MetricBarRow, value: number, language: 'ko' | 'en'): string {
  const target = getValuationReferenceValue(slot, row.key);
  const current = numericValue(slot.currentPrice);
  const label = language === 'ko' ? row.ko : row.en;
  if (target === null) {
    return language === 'ko'
      ? `${label}: 산출 가치가 없습니다.`
      : `${label}: valuation value is unavailable.`;
  }
  if (current === null || current === 0) {
    return language === 'ko'
      ? `${label} 산출 가치 ${fmtCurrency(target)}. 현재가가 없어 상승여력을 계산하지 못했습니다.`
      : `${label} value ${fmtCurrency(target)}. Current price is unavailable, so upside cannot be calculated.`;
  }
  return language === 'ko'
    ? `${label} 산출 가치 ${fmtCurrency(target)}는 현재가 ${fmtCurrency(current)} 대비 ${fmtSignedPercent(value)}입니다. 산식: 산출 가치 ÷ 현재가 - 1.`
    : `${label} value ${fmtCurrency(target)} is ${fmtSignedPercent(value)} vs current price ${fmtCurrency(current)}. Formula: value / current price - 1.`;
}

function formatQuarterlyMarginTrend(slot: CompareSlot, kind: 'operating_margin' | 'net_margin'): string | null {
  const trend = slot.metrics?.quarterly_margin_trend;
  if (!Array.isArray(trend) || trend.length === 0) return null;
  // Backend ships newest-first; take up to 4 quarters and reverse to oldest → newest.
  const points = trend
    .slice(0, 4)
    .map((p: any) => (typeof p?.[kind] === 'number' && Number.isFinite(p[kind])
      ? `${(p[kind] * 100).toFixed(1)}%`
      : '—'))
    .reverse();
  if (points.every(p => p === '—')) return null;
  return points.join(' → ');
}

type ScoreEvidenceGroupData = {
  key: 'value' | 'quality' | 'growth';
  label: string;
  caption: string;
  items: Array<{ label: string; value: string }>;
};

function buildScoreEvidenceGroups(slot: CompareSlot, language: 'ko' | 'en'): ScoreEvidenceGroupData[] {
  const refLabel = language === 'ko' ? '참고 수치' : 'Referenced metrics';
  const marginTrend = formatQuarterlyMarginTrend(slot, 'operating_margin');

  return [
    {
      key: 'value',
      label: language === 'ko' ? '밸류' : 'Value',
      caption: refLabel,
      items: [
        {
          label: language === 'ko' ? 'FwdPER(NTM)' : 'Fwd P/E (NTM)',
          value: language === 'ko'
            ? `${fmtNum(getMetricValue(slot, 'forward_pe'))} · 올해 ${fmtNum(getMetricValue(slot, 'forward_pe_fy0'))} · 내년 ${fmtNum(getMetricValue(slot, 'forward_pe_fy1'))}`
            : `${fmtNum(getMetricValue(slot, 'forward_pe'))} · FY0 ${fmtNum(getMetricValue(slot, 'forward_pe_fy0'))} · FY1 ${fmtNum(getMetricValue(slot, 'forward_pe_fy1'))}`,
        },
        {
          label: language === 'ko' ? 'PBR / EV·EBITDA' : 'P/B / EV·EBITDA',
          value: `${fmtNum(getMetricValue(slot, 'price_to_book_ratio'))} / ${fmtNum(getMetricValue(slot, 'enterprise_value_to_ebitda_ratio'))}`,
        },
        {
          label: language === 'ko' ? '증권사 평균목표가' : 'Broker avg target',
          value: fmtCurrency(slot.targetConsensus),
        },
        {
          label: language === 'ko' ? '목표 상승여력' : 'Target upside',
          value: fmtPercent(getTargetUpside(slot)),
        },
        {
          label: language === 'ko' ? '모델 상승여력' : 'Model upside',
          value: fmtPercent(getAverageValuationGap(slot)),
        },
      ],
    },
    {
      key: 'quality',
      label: language === 'ko' ? '퀄리티' : 'Quality',
      caption: refLabel,
      items: [
        {
          label: language === 'ko' ? '분기 영업이익률' : 'Op margin',
          value: language === 'ko'
            ? `분기 ${fmtPercent(getMetricValue(slot, 'operating_margin_q'))} · 연간 ${fmtPercent(getMetricValue(slot, 'operating_margin'))}`
            : `Q ${fmtPercent(getMetricValue(slot, 'operating_margin_q'))} · FY ${fmtPercent(getMetricValue(slot, 'operating_margin'))}`,
        },
        {
          label: language === 'ko' ? '순이익률' : 'Net margin',
          value: language === 'ko'
            ? `분기 ${fmtPercent(getMetricValue(slot, 'net_margin_q'))} · 연간 ${fmtPercent(getMetricValue(slot, 'net_margin'))}`
            : `Q ${fmtPercent(getMetricValue(slot, 'net_margin_q'))} · FY ${fmtPercent(getMetricValue(slot, 'net_margin'))}`,
        },
        {
          label: 'ROE / ROIC',
          value: `${fmtPercent(getMetricValue(slot, 'return_on_equity'))} / ${fmtPercent(getMetricValue(slot, 'return_on_invested_capital'))}`,
        },
        {
          label: language === 'ko' ? '재무 안정성' : 'Balance sheet',
          value: language === 'ko'
            ? `이자 ${fmtNum(getMetricValue(slot, 'interest_coverage'))} · 부채 ${fmtPercent(getMetricValue(slot, 'liabilities_to_equity'))}`
            : `Interest ${fmtNum(getMetricValue(slot, 'interest_coverage'))} · Debt ${fmtPercent(getMetricValue(slot, 'liabilities_to_equity'))}`,
        },
      ],
    },
    {
      key: 'growth',
      label: language === 'ko' ? '성장' : 'Growth',
      caption: refLabel,
      items: [
        {
          label: language === 'ko' ? '연간 성장' : 'Annual growth',
          value: language === 'ko'
            ? `매출 ${fmtPercent(getMetricValue(slot, 'revenue_growth'))} · 영업 ${fmtPercent(getMetricValue(slot, 'operating_income_growth'))} · 순익 ${fmtPercent(getMetricValue(slot, 'earnings_growth'))}`
            : `Rev ${fmtPercent(getMetricValue(slot, 'revenue_growth'))} · Op ${fmtPercent(getMetricValue(slot, 'operating_income_growth'))} · Net ${fmtPercent(getMetricValue(slot, 'earnings_growth'))}`,
        },
        {
          label: language === 'ko' ? '분기 영업이익 YoY' : 'Q op income YoY',
          value: fmtPercent(getMetricValue(slot, 'operating_income_growth_yoy')),
        },
        {
          label: language === 'ko' ? '분기 순이익 YoY' : 'Q net income YoY',
          value: fmtPercent(getMetricValue(slot, 'earnings_growth_yoy')),
        },
        ...(marginTrend
          ? [{
              label: language === 'ko' ? '영업이익률 추세' : 'Op margin trend',
              value: marginTrend,
            }]
          : []),
      ],
    },
  ];
}

function toneClass(signal: string | null | undefined): string {
  if (signal === 'bullish') return 'text-emerald-400';
  if (signal === 'bearish') return 'text-rose-400';
  return 'text-muted-foreground';
}

function slotColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

function scoreTone(score: number): string {
  if (score >= 75) return 'text-amber-300';
  if (score >= 55) return 'text-emerald-300';
  if (score >= 35) return 'text-muted-foreground';
  return 'text-rose-300';
}

function scoreHelpText(kind: 'value' | 'quality' | 'growth', language: 'ko' | 'en'): string {
  if (language === 'en') {
    if (kind === 'value') return 'Value score compares cheaper multiples (P/E, Fwd P/E NTM, Fwd P/E this FY & next FY, P/B, EV/EBITDA), broker target upside, and valuation-model upside.';
    if (kind === 'quality') return 'Quality score compares annual and latest-quarter operating margin & net margin, plus ROE, ROIC, interest coverage, and lower liabilities-to-equity.';
    return 'Growth score compares annual revenue, operating-income and net-income growth plus latest-quarter YoY revenue, operating-income and net-income growth from the financial metrics feed.';
  }
  if (kind === 'value') return '밸류 점수는 낮은 PER/FwdPER(NTM)/FwdPER(올해·내년)/PBR/EV·EBITDA, 증권사 목표 상승여력, 가치평가 모델 상승여력을 함께 봅니다.';
  if (kind === 'quality') return '퀄리티 점수는 연간·최근분기 영업이익률·순이익률, ROE, ROIC, 이자보상배율, 낮은 부채비율을 함께 봅니다.';
  return '성장 점수는 연간 매출·영업이익·순이익 성장과 최근분기 매출·영업이익·순이익 YoY 성장을 함께 상대 비교합니다.';
}

function axisHelpText(kind: 'valuationUpside' | 'metricValue', language: 'ko' | 'en'): string {
  if (language === 'en') {
    if (kind === 'valuationUpside') return 'This section compares upside percentage from current price. For EV/EBITDA here, the bar is not the multiple itself; it is the model-implied price upside, so higher is better.';
    return 'This section compares the raw metric itself. For EV/EBITDA multiples, lower usually means cheaper valuation, so lower is better.';
  }
  if (kind === 'valuationUpside') return '여기는 현재가 대비 상승여력 % 비교입니다. EV/EBITDA 행도 멀티플 자체가 아니라 그 모델이 계산한 목표가 상승여력이므로 높을수록 좋습니다.';
  return '여기는 지표 원값 비교입니다. EV/EBITDA 멀티플은 기업가치/EBITDA 배수라, 같은 조건이면 낮을수록 더 싸게 거래된다는 뜻입니다.';
}

function getMetricValue(slot: CompareSlot, key: string): number | null {
  if (key === 'currentPrice') return numericValue(slot.currentPrice);
  if (key === 'forward_pe') return numericValue(slot.forwardMetrics?.forward_pe);
  if (key === 'forward_pe_fy0') return numericValue(slot.forwardMetrics?.forward_pe_fy0);
  if (key === 'forward_pe_fy1') return numericValue(slot.forwardMetrics?.forward_pe_fy1);
  if (ANNUAL_GROWTH_KEYS.has(key)) {
    return numericValue(slot.annualMetrics?.[key])
      ?? numericValue(slot.metrics?.[key])
      ?? getAnnualLineItemGrowth(slot, key);
  }
  return numericValue(slot.metrics?.[key]);
}

function getTargetUpside(slot: CompareSlot): number | null {
  const target = numericValue(slot.targetConsensus);
  const current = numericValue(slot.currentPrice);
  if (target === null || current === null || current === 0) return null;
  return (target / current) - 1;
}

function getAverageValuationGap(slot: CompareSlot): number | null {
  const gaps = (slot.valuation?.models || [])
    .map(model => numericValue(model.gapToMarket))
    .filter((value): value is number => value !== null);
  if (gaps.length === 0) return null;
  return gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
}

function scoreAcross(slots: CompareSlot[], getter: (slot: CompareSlot) => number | null, higherIsBetter: boolean): Map<string, number> {
  const values = slots
    .map(slot => ({ id: slot.id, value: getter(slot) }))
    .filter((item): item is { id: string; value: number } => item.value !== null && Number.isFinite(item.value));
  const scoreMap = new Map<string, number>();
  if (values.length === 0) return scoreMap;
  if (values.length === 1) {
    scoreMap.set(values[0].id, 70);
    return scoreMap;
  }

  const min = Math.min(...values.map(item => item.value));
  const max = Math.max(...values.map(item => item.value));
  const range = max - min;
  values.forEach(item => {
    const normalized = range === 0 ? 0.5 : (item.value - min) / range;
    scoreMap.set(item.id, Math.round((higherIsBetter ? normalized : 1 - normalized) * 100));
  });
  return scoreMap;
}

function averageScores(...scores: Array<number | undefined>): number {
  const usable = scores.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return 50;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function buildRankedScorecards(slots: CompareSlot[]) {
  const scoreMaps = {
    per: scoreAcross(slots, slot => getMetricValue(slot, 'price_to_earnings_ratio'), false),
    fwdPer: scoreAcross(slots, slot => getMetricValue(slot, 'forward_pe'), false),
    fwdPerFy0: scoreAcross(slots, slot => getMetricValue(slot, 'forward_pe_fy0'), false),
    fwdPerFy1: scoreAcross(slots, slot => getMetricValue(slot, 'forward_pe_fy1'), false),
    pbr: scoreAcross(slots, slot => getMetricValue(slot, 'price_to_book_ratio'), false),
    evEbitda: scoreAcross(slots, slot => getMetricValue(slot, 'enterprise_value_to_ebitda_ratio'), false),
    targetUpside: scoreAcross(slots, getTargetUpside, true),
    valuationGap: scoreAcross(slots, getAverageValuationGap, true),
    operatingMargin: scoreAcross(slots, slot => getMetricValue(slot, 'operating_margin'), true),
    netMargin: scoreAcross(slots, slot => getMetricValue(slot, 'net_margin'), true),
    operatingMarginQ: scoreAcross(slots, slot => getMetricValue(slot, 'operating_margin_q'), true),
    netMarginQ: scoreAcross(slots, slot => getMetricValue(slot, 'net_margin_q'), true),
    roe: scoreAcross(slots, slot => getMetricValue(slot, 'return_on_equity'), true),
    roic: scoreAcross(slots, slot => getMetricValue(slot, 'return_on_invested_capital'), true),
    interestCoverage: scoreAcross(slots, slot => getMetricValue(slot, 'interest_coverage'), true),
    liabilities: scoreAcross(slots, slot => getMetricValue(slot, 'liabilities_to_equity'), false),
    revenueGrowth: scoreAcross(slots, slot => getMetricValue(slot, 'revenue_growth'), true),
    operatingIncomeGrowth: scoreAcross(slots, slot => getMetricValue(slot, 'operating_income_growth'), true),
    earningsGrowth: scoreAcross(slots, slot => getMetricValue(slot, 'earnings_growth'), true),
    revenueGrowthQ: scoreAcross(slots, slot => getMetricValue(slot, 'revenue_growth_yoy'), true),
    operatingIncomeGrowthQ: scoreAcross(slots, slot => getMetricValue(slot, 'operating_income_growth_yoy'), true),
    earningsGrowthQ: scoreAcross(slots, slot => getMetricValue(slot, 'earnings_growth_yoy'), true),
  };

  return slots
    .map((slot, index) => {
      const valueScore = averageScores(
        scoreMaps.per.get(slot.id),
        scoreMaps.fwdPer.get(slot.id),
        scoreMaps.fwdPerFy0.get(slot.id),
        scoreMaps.fwdPerFy1.get(slot.id),
        scoreMaps.pbr.get(slot.id),
        scoreMaps.evEbitda.get(slot.id),
        scoreMaps.targetUpside.get(slot.id),
        scoreMaps.valuationGap.get(slot.id),
      );
      const qualityScore = averageScores(
        scoreMaps.operatingMargin.get(slot.id),
        scoreMaps.netMargin.get(slot.id),
        scoreMaps.operatingMarginQ.get(slot.id),
        scoreMaps.netMarginQ.get(slot.id),
        scoreMaps.roe.get(slot.id),
        scoreMaps.roic.get(slot.id),
        scoreMaps.interestCoverage.get(slot.id),
        scoreMaps.liabilities.get(slot.id),
      );
      const growthScore = averageScores(
        scoreMaps.revenueGrowth.get(slot.id),
        scoreMaps.operatingIncomeGrowth.get(slot.id),
        scoreMaps.earningsGrowth.get(slot.id),
        scoreMaps.revenueGrowthQ.get(slot.id),
        scoreMaps.operatingIncomeGrowthQ.get(slot.id),
        scoreMaps.earningsGrowthQ.get(slot.id),
      );
      const totalScore = Math.round((valueScore * 0.45) + (qualityScore * 0.35) + (growthScore * 0.20));
      return {
        slot,
        index,
        color: slotColor(index),
        valueScore,
        qualityScore,
        growthScore,
        totalScore,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function newSlot(ticker = ''): CompareSlot {
  return {
    id: Math.random().toString(36).slice(2, 9),
    ticker,
    status: ticker ? 'empty' : 'empty',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function fiveYearsAgoIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function normalizeCompareToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function stripKoreanCompanySuffix(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(주\)\s*$/i, '')
    .replace(/\s*주식회사\s*$/i, '')
    .trim();
}

function findExactTickerSuggestion(term: string, suggestions: TickerSuggestion[]): TickerSuggestion | null {
  const normalizedTerm = normalizeCompareToken(stripKoreanCompanySuffix(term));
  if (!normalizedTerm) return null;

  return suggestions.find(suggestion => {
    const candidates = [
      suggestion.ticker,
      suggestion.name,
      stripKoreanCompanySuffix(suggestion.name),
    ].map(normalizeCompareToken);
    return candidates.includes(normalizedTerm);
  }) ?? null;
}

export function StockCompareTab() {
  const { language } = useLanguage();
  const { openTab } = useTabsContext();
  const { patchWorkspace } = useWorkspace();
  // 비교 → 종목 분석 딥링크: 활성 종목을 워크스페이스에 반영하고 분석 탭으로 이동
  // (저장 분석 재열람과 동일한 패턴 — saved-list-row.tsx handleRestore 참조)
  const openAnalysisFor = useCallback((ticker: string) => {
    const trimmed = ticker.trim();
    if (!trimmed) return;
    patchWorkspace({ tickers: trimmed });
    openTab(TabService.createStockSearchTab());
  }, [openTab, patchWorkspace]);
  const [slots, setSlots] = useState<CompareSlot[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const tickers: string[] = JSON.parse(raw);
        if (Array.isArray(tickers) && tickers.length > 0) {
          return tickers.slice(0, MAX_SLOTS).map(tk => newSlot(tk));
        }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_COMPARE_TICKERS.map(ticker => newSlot(ticker));
  });
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingComparison, setIsSavingComparison] = useState(false);
  const [chartMetricKey, setChartMetricKey] = useState<ChartMetricKey>('relative_price');
  const [chartWindow, setChartWindow] = useState<ChartWindow>('1y');
  const [chartAxisMode, setChartAxisMode] = useState<ChartAxisMode>('normalized');
  const abortRef = useRef<AbortController | null>(null);

  // Persist ticker list (content excluded), mirroring the tabs-context pattern.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(slots.map(s => s.ticker).filter(Boolean)),
      );
    } catch {
      /* ignore */
    }
  }, [slots]);

  const updateSlot = useCallback((id: string, patch: Partial<CompareSlot>) => {
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const handleTickerChange = (id: string, value: string) => {
    updateSlot(id, { ticker: value.toUpperCase() });
  };

  const addSlot = () => {
    setSlots(prev => (prev.length >= MAX_SLOTS ? prev : [...prev, newSlot()]));
  };

  const removeSlot = (id: string) => {
    setSlots(prev => (prev.length <= 1 ? prev : prev.filter(s => s.id !== id)));
    if (baselineId === id) setBaselineId(null);
  };

  const fetchMetricsFor = useCallback(async (ticker: string, signal: AbortSignal) => {
    const commonBody = { ticker, start_date: fiveYearsAgoIso(), end_date: todayIso(), limit: 10 };
    const [ttmResponse, annualResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/hedge-fund/fetch-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commonBody),
        signal,
      }),
      fetch(`${API_BASE_URL}/hedge-fund/fetch-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonBody, period: 'annual' }),
        signal,
      }),
    ]);
    if (!ttmResponse.ok) throw new Error(`HTTP ${ttmResponse.status}`);

    const ttmData = await ttmResponse.json();
    if (!annualResponse.ok) {
      return ttmData;
    }

    const annualData = await annualResponse.json();
    return {
      ...ttmData,
      annual_metrics: annualData.metrics || {},
      annual_line_items: annualData.line_items || [],
    };
  }, []);

  const fetchAnalystTargetFor = useCallback(async (ticker: string, signal: AbortSignal) => {
    if (signal.aborted) return null;
    return analystTargetService.fetch(ticker);
  }, []);

  const resolveCompareTicker = useCallback(async (input: string, signal: AbortSignal): Promise<string> => {
    const strippedInput = stripKoreanCompanySuffix(input);
    const staticResolved = resolveTickerValue(strippedInput);
    if (staticResolved !== strippedInput) {
      return staticResolved.toUpperCase();
    }

    const response = await fetch(`${API_BASE_URL}/ticker-search?q=${encodeURIComponent(strippedInput)}`, { signal });
    if (!response.ok) {
      return staticResolved.toUpperCase();
    }

    const suggestions: TickerSuggestion[] = await response.json();
    const exact = findExactTickerSuggestion(strippedInput, suggestions);
    return (exact?.ticker || staticResolved).toUpperCase();
  }, []);

  const runValuationForTicker = useCallback(async (
    resolvedTicker: string,
    displayTicker: string,
    slotId: string,
    signal: AbortSignal,
  ) => {
    const model = await getDefaultModel();
    const suffix = Math.random().toString(36).slice(2, 8);
    const pmId = `portfolio_manager_${suffix}`;
    const valuationNodeId = `valuation_analyst_${suffix}`;
    const graphNodes = [
      {
        id: valuationNodeId,
        type: 'agent-node',
        data: { name: 'Valuation', description: 'valuation', status: 'Idle' },
        position: { x: 0, y: 0 },
      },
      { id: pmId, type: 'portfolio-manager-node', data: { name: 'Portfolio Manager', status: 'IDLE' }, position: { x: 0, y: 0 } },
    ];
    const graphEdges = [{ id: 'e-val-pm', source: valuationNodeId, target: pmId }];
    const agentModels = model
      ? [
          { agent_id: valuationNodeId, model_name: model.model_name, model_provider: model.provider },
          { agent_id: pmId, model_name: model.model_name, model_provider: model.provider },
        ]
      : [];

    const body: Record<string, any> = {
      tickers: [resolvedTicker],
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      agent_models: agentModels,
      start_date: oneYearAgoIso(),
      end_date: todayIso(),
      language,
    };

    const response = await fetch(`${API_BASE_URL}/hedge-fund/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No reader');

    const decoder = new TextDecoder();
    let buffer = '';
    let complete: any = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const eventText of events) {
        if (!eventText.trim()) continue;
        const typeMatch = eventText.match(/^event: (.+)$/m);
        const dataMatch = eventText.match(/^data: (.+)$/m);
        if (!typeMatch || !dataMatch) continue;
        if (typeMatch[1] === 'progress') {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            if (parsed.ticker && String(parsed.ticker).toUpperCase() !== resolvedTicker.toUpperCase()) continue;
            const status = parsed.status || (language === 'ko' ? '분석 중' : 'Running');
            updateSlot(slotId, { progressMessage: `${displayTicker} · ${status}` });
          } catch {
            /* ignore */
          }
        }
        if (typeMatch[1] === 'complete') {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            complete = parsed.data || parsed;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return complete;
  }, [language, updateSlot]);

  const runComparison = useCallback(async () => {
    const active = slots.filter(s => s.ticker.trim());
    if (active.length === 0 || isRunning) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);

    setSlots(prev => prev.map(s => (s.ticker.trim() ? {
      ...s,
      status: 'loading',
      error: undefined,
      progressMessage: language === 'ko' ? '대기 중' : 'Queued',
      valuation: null,
      signal: null,
      annualMetrics: undefined,
      forwardMetrics: undefined,
      targetConsensus: null,
    } : s)));

    const runSlot = async (slot: CompareSlot) => {
      const displayTicker = slot.ticker.trim();
      try {
        updateSlot(slot.id, { progressMessage: language === 'ko' ? `${displayTicker} · 티커 확인 중` : `${displayTicker} · Resolving ticker` });
        const resolvedTicker = await resolveCompareTicker(displayTicker, controller.signal);
        updateSlot(slot.id, { progressMessage: language === 'ko' ? `${displayTicker} · 재무 데이터 수집 중` : `${displayTicker} · Loading metrics` });
        const data = await fetchMetricsFor(resolvedTicker, controller.signal);
        const analystTarget = await fetchAnalystTargetFor(resolvedTicker, controller.signal);
        const prices: PricePoint[] = data.prices || [];
        const currentPrice = analystTarget?.current_price ?? (prices.length ? prices[prices.length - 1].close : null);
        updateSlot(slot.id, {
          metrics: data.metrics || {},
          annualMetrics: data.annual_metrics || {},
          forwardMetrics: data.forward_metrics || {},
          prices,
          lineItems: data.annual_line_items || data.line_items || [],
          currentPrice,
          targetConsensus: analystTarget?.consensus ?? null,
          status: 'ready',
          progressMessage: language === 'ko' ? `${displayTicker} · 재무 데이터 완료 · 가치평가 중` : `${displayTicker} · Metrics ready · valuing`,
        });

        void runValuationForTicker(resolvedTicker, displayTicker, slot.id, controller.signal)
          .then(complete => {
            if (controller.signal.aborted) return;
            const analystSignals: Record<string, any> = complete?.analyst_signals || {};
            const valuationKey = Object.keys(analystSignals).find(k => k.startsWith('valuation_analyst'));
            const valuationByTicker = valuationKey ? analystSignals[valuationKey] : {};
            const entry = valuationByTicker?.[resolvedTicker] ?? valuationByTicker?.[displayTicker];
            if (!entry) throw new Error('valuation result missing');

            updateSlot(slot.id, {
              valuation: buildValuationDeepDive({ reasoning: entry.reasoning } as any, currentPrice),
              signal: { signal: entry.signal, confidence: entry.confidence },
              status: 'ready',
              progressMessage: language === 'ko' ? `${displayTicker} · 완료` : `${displayTicker} · Complete`,
            });
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            updateSlot(slot.id, {
              status: 'ready',
              progressMessage: language === 'ko'
                ? `${displayTicker} · 재무 데이터 완료 · 가치평가 실패`
                : `${displayTicker} · metrics loaded; valuation failed`,
            });
          });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        updateSlot(slot.id, {
          status: 'error',
          error: err?.message || 'fetch failed',
          progressMessage: language === 'ko' ? `${displayTicker} · 데이터 수집 실패` : `${displayTicker} · Metrics failed`,
        });
      }
    };

    await Promise.allSettled(active.map(runSlot));
    if (!controller.signal.aborted) {
      setIsRunning(false);
    }
  }, [slots, isRunning, fetchMetricsFor, fetchAnalystTargetFor, resolveCompareTicker, runValuationForTicker, updateSlot, language]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const readySlots = slots.filter(s => s.ticker.trim());

  // Union of valuation model keys across all slots, in preferred order then extras.
  const modelKeys = useMemo(() => {
    const present = new Set<string>();
    readySlots.forEach(s => s.valuation?.models.forEach(m => present.add(m.key)));
    const ordered = PREFERRED_MODEL_ORDER.filter(k => present.has(k));
    const extras = [...present].filter(k => !PREFERRED_MODEL_ORDER.includes(k));
    return [...ordered, ...extras];
  }, [readySlots]);

  const modelLabel = (key: string): string => {
    for (const s of readySlots) {
      const m = s.valuation?.models.find(mm => mm.key === key);
      if (m) return m.labelKey;
    }
    return key;
  };

  const findModel = (slot: CompareSlot, key: string): ValuationModel | undefined =>
    slot.valuation?.models.find(m => m.key === key);

  const handleSaveComparison = useCallback(async () => {
    if (isSavingComparison) return;
    const comparedSlots = slots.filter(slot => slot.ticker.trim());
    if (comparedSlots.length === 0) return;

    const now = new Date().toISOString();
    const tickers = comparedSlots.map(slot => slot.ticker.trim());
    const displayName = `${tickers.join(' vs ')} 비교`;

    setIsSavingComparison(true);
    try {
      await savedAnalysisService.saveAnalysis(
        'stock_compare',
        tickers.join(', '),
        language,
        {
          tickers,
          baseline_ticker: comparedSlots.find(slot => slot.id === baselineId)?.ticker ?? null,
          saved_at: now,
        },
        {
          slots: comparedSlots,
          model_keys: modelKeys,
          financial_rows: FINANCIAL_ROWS,
          baseline_id: baselineId,
          saved_at: now,
        },
        displayName,
      );
      alert(language === 'ko' ? '비교 데이터가 아카이브에 저장되었습니다.' : 'Comparison saved to archive.');
    } catch (err: any) {
      alert(err?.message || (language === 'ko' ? '저장에 실패했습니다.' : 'Save failed.'));
    } finally {
      setIsSavingComparison(false);
    }
  }, [baselineId, isSavingComparison, language, modelKeys, slots]);

  // Only rank/score slots whose data is actually loaded; a ticker typed but not yet
  // run must not surface placeholder 50/50/50 scores.
  const scoredSlots = useMemo(() => readySlots.filter(s => s.status === 'ready'), [readySlots]);
  const rankedScorecards = useMemo(() => buildRankedScorecards(scoredSlots), [scoredSlots]);

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-7xl p-4 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <Network size={18} className="text-primary" />
          <h2 className="text-lg font-semibold">{t('stockCompare', language)}</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveComparison}
              disabled={isSavingComparison || readySlots.length === 0}
            >
              <Archive size={14} className="mr-1" />
              {language === 'ko' ? '아카이브 추가' : 'Save Archive'}
            </Button>
            <Button size="sm" variant="outline" onClick={addSlot} disabled={slots.length >= MAX_SLOTS}>
              <Plus size={14} className="mr-1" />{t('compareAddTicker', language)}
            </Button>
            <Button size="sm" onClick={runComparison} disabled={isRunning || readySlots.length === 0}>
              <RefreshCw size={14} className={cn('mr-1', isRunning && 'animate-spin')} />{t('compareRun', language)}
            </Button>
          </div>
        </div>

        {/* Ticker slot inputs */}
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
          {slots.map(slot => (
            <div key={slot.id} className="relative rounded-lg border bg-muted/10 p-2">
              <div className="flex items-center gap-1">
                <TickerInput
                  value={slot.ticker}
                  placeholder={t('compareEmptySlot', language)}
                  onChange={value => handleTickerChange(slot.id, value)}
                  onKeyDown={e => { if (e.key === 'Enter') runComparison(); }}
                  className="h-8 text-sm"
                />
                {slots.length > 1 && (
                  <button
                    onClick={() => removeSlot(slot.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove slot"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {slot.status === 'error' && (
                <div className="mt-1 text-[10px] text-red-500">{slot.error}</div>
              )}
              {slot.progressMessage && (
                <div className={cn(
                  'mt-1 truncate text-[10px]',
                  slot.status === 'error' ? 'text-red-500' : slot.status === 'ready' ? 'text-emerald-500' : 'text-muted-foreground',
                )}>
                  <span className="sr-only">compareStatus</span>
                  {slot.progressMessage}
                </div>
              )}
            </div>
          ))}
        </div>

        {readySlots.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t('comparePlaceholder', language)}
          </div>
        ) : (
          <>
            <CompareRankingCards scorecards={rankedScorecards} language={language} onOpenAnalysis={openAnalysisFor} />

            <CurrentPriceSummary slots={readySlots} language={language} />

            <MetricBarComparisonPanel
              title={t('compareValuationBarsTitle', language)}
              subtitle={language === 'ko' ? '현재가 대비 각 모델·증권사 목표치의 상승여력 기준' : 'Upside/downside from current price by model and broker target'}
              slots={readySlots}
              rows={VALUATION_BAR_ROWS.filter(row => row.key === 'broker_target' || modelKeys.includes(row.key))}
              language={language}
              axisHelp={axisHelpText('valuationUpside', language)}
              getValue={(slot, rowKey) => {
                if (rowKey === 'broker_target') return getTargetUpside(slot);
                return findModel(slot, rowKey)?.gapToMarket ?? null;
              }}
              formatValue={value => fmtSignedPercent(value)}
              formatPrimaryValue={(slot, row) => formatValuationBarPrimary(slot, row, language)}
              formatSecondaryValue={value => formatValuationBarSecondary(value, language)}
              getValueTooltip={(slot, row, value) => getValuationBarTooltip(slot, row, value, language)}
            />

            <MetricBarComparisonPanel
              title={t('compareMetricBarsTitle', language)}
              subtitle={language === 'ko' ? '같은 행 안에서 막대 길이로 직접 비교하고 BEST 태그로 우위 종목을 표시' : 'Each row shares one scale, with BEST marking the leading stock'}
              slots={readySlots}
              rowGroups={FINANCIAL_BAR_GROUPS}
              language={language}
              axisHelp={axisHelpText('metricValue', language)}
              getValue={(slot, rowKey) => getMetricValue(slot, rowKey)}
              formatValue={(value, row) => row.percent ? `${(value * 100).toFixed(1)}%` : fmtNum(value)}
            />

            {/* Valuation comparison matrix */}
            <section className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">{t('compareValuationMatrix', language)}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Model</th>
                      {readySlots.map(s => (
                        <th key={s.id} className="px-3 py-2 text-right">{s.ticker || '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modelKeys.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-xs text-muted-foreground" colSpan={readySlots.length + 1}>
                          {t('compareNoData', language)}
                        </td>
                      </tr>
                    ) : modelKeys.map(key => (
                      <tr key={key} className="border-t">
                        <td className="px-3 py-2 text-xs">{modelLabel(key)}</td>
                        {readySlots.map(s => {
                          const m = findModel(s, key);
                          return (
                            <td key={s.id} className="px-3 py-2 text-right font-mono">
                              {m ? (
                                <span className={toneClass(m.signal)}>
                                  {fmtCurrency(m.intrinsicPerShare)}
                                  <span className="ml-1 text-[10px]">
                                    {m.gapToMarket !== null && m.gapToMarket !== undefined
                                      ? `(${fmtPercent(m.gapToMarket)})`
                                      : ''}
                                  </span>
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-t">
                      <td className="px-3 py-2 text-xs">{t('compareBrokerConsensusTarget', language)}</td>
                      {readySlots.map(s => (
                        <td key={s.id} className="px-3 py-2 text-right font-mono">
                          <span className="text-amber-500">
                            {formatTargetWithGap(s.targetConsensus, s.currentPrice)}
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Financial metrics comparison */}
            <section className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">{t('compareFinancials', language)}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">{language === 'ko' ? '지표' : 'Metric'}</th>
                      {readySlots.map(s => (
                        <th key={s.id} className="px-3 py-2 text-right">{s.ticker || '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FINANCIAL_ROWS.map(row => (
                      <tr key={row.key} className="border-t">
                        <td className="px-3 py-2 text-xs">{language === 'ko' ? row.ko : row.en}</td>
                        {readySlots.map(s => {
                          const v = row.key === 'currentPrice'
                            ? s.currentPrice
                            : getMetricValue(s, row.key);
                          return (
                            <td key={s.id} className="px-3 py-2 text-right font-mono">
                              {row.key === 'currentPrice' ? fmtCurrency(v as number | null) : row.percent ? fmtPercent(v) : fmtNum(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Financial charts comparison (normalized price overlay) */}
            <section className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <div className="text-sm font-medium">{t('compareCharts', language)}</div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <select
                    value={chartMetricKey}
                    onChange={event => setChartMetricKey(event.target.value as ChartMetricKey)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label={language === 'ko' ? '차트 지표' : 'Chart metric'}
                  >
                    {COMPARISON_CHART_METRICS.map(metric => (
                      <option key={metric.key} value={metric.key}>{language === 'ko' ? metric.ko : metric.en}</option>
                    ))}
                  </select>
                  <select
                    value={chartWindow}
                    onChange={event => setChartWindow(event.target.value as ChartWindow)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label={language === 'ko' ? '차트 기간' : 'Chart window'}
                  >
                    <option value="3m">{language === 'ko' ? '3개월' : '3M'}</option>
                    <option value="1y">{language === 'ko' ? '1년' : '1Y'}</option>
                    <option value="3y">{language === 'ko' ? '3년' : '3Y'}</option>
                    <option value="5y">{language === 'ko' ? '5년' : '5Y'}</option>
                    <option value="all">{language === 'ko' ? '전체' : 'All'}</option>
                  </select>
                  <select
                    value={chartAxisMode}
                    onChange={event => setChartAxisMode(event.target.value as ChartAxisMode)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label={language === 'ko' ? '세로축 모드' : 'Axis mode'}
                  >
                    <option value="normalized">{language === 'ko' ? '상대축 100' : 'Indexed 100'}</option>
                    <option value="actual">{language === 'ko' ? '실값축' : 'Actual'}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-3 p-3">
                <RelativeComparisonChart
                  slots={readySlots}
                  metricKey={chartMetricKey}
                  chartWindow={chartWindow}
                  chartAxisMode={chartAxisMode}
                  language={language}
                  height={260}
                />
                <div className="grid gap-3">
                  {COMPARISON_CHART_METRICS.filter(metric => metric.key !== chartMetricKey).map(metric => (
                    <div key={metric.key} className="rounded-md border bg-muted/5">
                      <RelativeComparisonChart
                        slots={readySlots}
                        metricKey={metric.key}
                        chartWindow={chartWindow}
                        chartAxisMode={metric.key === 'relative_price' ? 'normalized' : chartAxisMode}
                        language={language}
                        compact
                        height={150}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const CHART_COLORS = ['#4f83cc', '#2f9b72', '#c95f66', '#8f6bb8', '#b58a3b', '#4f9aa5'];

function CurrentPriceSummary({ slots, language }: { slots: CompareSlot[]; language: 'ko' | 'en' }) {
  return (
    <section className="grid gap-2 md:grid-cols-3">
      {slots.map(slot => {
        const prices = (slot.prices || []).filter(p => Number.isFinite(p.close) && p.close > 0);
        const first = prices[0]?.close;
        const last = slot.currentPrice ?? prices[prices.length - 1]?.close ?? null;
        const change = typeof first === 'number' && typeof last === 'number' && first > 0
          ? (last / first) - 1
          : null;
        return (
          <div key={slot.id} className="rounded-lg border bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs text-muted-foreground">{slot.ticker}</div>
            </div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{fmtCurrency(last)}</div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{t('compareCurrentPrice', language)}</span>
              <span className={cn(change !== null && change >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                {change === null ? '—' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function CompareRankingCards({
  scorecards,
  language,
  onOpenAnalysis,
}: {
  scorecards: ReturnType<typeof buildRankedScorecards>;
  language: 'ko' | 'en';
  onOpenAnalysis?: (ticker: string) => void;
}) {
  if (scorecards.length === 0) return null;
  const sortedByValue = [...scorecards].sort((a, b) => b.valueScore - a.valueScore);
  const valueRankById = new Map(sortedByValue.map((item, index) => [item.slot.id, index + 1]));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-xl font-semibold tracking-tight">{t('compareValueRankTitle', language)}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('compareValueRankSubtitle', language)}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {scorecards.map(card => (
          <div
            key={card.slot.id}
            className={cn(
              'rounded-lg border bg-card/30 p-4 shadow-sm',
              card.rank === 1 ? 'border-amber-300/35 bg-amber-300/5' : 'border-border/80',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={cn('text-4xl font-black tabular-nums', card.rank === 1 ? 'text-amber-400' : 'text-muted-foreground')}>
                  {card.rank}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{language === 'ko' ? '종합 매력도' : 'Composite rank'}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: card.color }} />
                    <span className="text-lg font-semibold">{card.slot.ticker}</span>
                  </div>
                </div>
              </div>
              {onOpenAnalysis && (
                <button
                  type="button"
                  onClick={() => onOpenAnalysis(card.slot.ticker)}
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-border/60 px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={`${card.slot.ticker} ${t('compareOpenAnalysis', language)}`}
                >
                  <ArrowUpRight className="h-3 w-3" />
                  {t('compareOpenAnalysis', language)}
                </button>
              )}
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div className="text-3xl font-bold tabular-nums">{fmtCurrency(card.slot.currentPrice)}</div>
              <div className={cn('text-sm font-semibold tabular-nums', scoreTone(card.totalScore))}>{card.totalScore}</div>
            </div>
            <div className="mt-4 space-y-3">
              <ScoreBar
                label={language === 'ko' ? '밸류' : 'Value'}
                help={scoreHelpText('value', language)}
                score={card.valueScore}
                rank={valueRankById.get(card.slot.id)}
                color={card.rank === 1 ? '#c7a24f' : card.color}
              />
              <ScoreBar label={language === 'ko' ? '퀄리티' : 'Quality'} help={scoreHelpText('quality', language)} score={card.qualityScore} color={card.color} />
              <ScoreBar label={language === 'ko' ? '성장' : 'Growth'} help={scoreHelpText('growth', language)} score={card.growthScore} color={card.color} />
            </div>
            <div className="mt-4 space-y-3 border-t border-border/70 pt-3">
              {buildScoreEvidenceGroups(card.slot, language).map(group => (
                <ScoreEvidenceGroup key={group.key} group={group} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ScoreEvidenceGroup({ group }: { group: ScoreEvidenceGroupData }) {
  return (
    <section className="border-l border-border/70 pl-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold text-foreground">{group.label}</h4>
        <span className="text-[10px] text-muted-foreground">{group.caption}</span>
      </div>
      <dl className="mt-1.5 space-y-1">
        {group.items.map(item => (
          <div key={item.label} className="grid grid-cols-[6.2rem_minmax(0,1fr)] gap-2 text-[11px] leading-4">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="break-words font-medium text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ScoreBar({ label, help, score, rank, color }: { label: string; help?: string; score: number; rank?: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1 text-muted-foreground">
          <span>{label}</span>
          {help && <ScoreHelpTooltip text={help} />}
          {rank === 1 && <span className="text-amber-300">1위</span>}
        </div>
        <span className={cn('font-semibold tabular-nums', scoreTone(score))}>{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(score, 100))}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function ScoreHelpTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted/40 text-[10px] font-semibold text-muted-foreground hover:border-muted-foreground hover:text-foreground"
            aria-label={text}
          >
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal bg-zinc-900 text-left leading-relaxed text-zinc-100 shadow-lg">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface MetricBarRow {
  key: string;
  ko: string;
  en: string;
  higherIsBetter: boolean;
  percent?: boolean;
}

function MetricBarComparisonPanel({
  title,
  subtitle,
  slots,
  rows,
  rowGroups,
  language,
  axisHelp,
  getValue,
  formatValue,
  formatPrimaryValue,
  formatSecondaryValue,
  getValueTooltip,
}: {
  title: string;
  subtitle?: string;
  slots: CompareSlot[];
  rows?: MetricBarRow[];
  rowGroups?: Array<{ key: string; ko: string; en: string; rows: MetricBarRow[] }>;
  language: 'ko' | 'en';
  axisHelp?: string;
  getValue: (slot: CompareSlot, rowKey: string) => number | null;
  formatValue: (value: number, row: MetricBarRow) => string;
  formatPrimaryValue?: (slot: CompareSlot, row: MetricBarRow, value: number) => string | null;
  formatSecondaryValue?: (value: number, row: MetricBarRow) => string;
  getValueTooltip?: (slot: CompareSlot, row: MetricBarRow, value: number) => string | null;
}) {
  const groups = rowGroups || [{ key: 'single', ko: '', en: '', rows: rows || [] }];
  const hasAnyRow = groups.some(group => group.rows.length > 0);
  if (!hasAnyRow) return null;

  return (
    <section className="rounded-lg border border-border/80 bg-card/30">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="flex items-center gap-1.5 text-base font-semibold">
            {title}
            {axisHelp && <ScoreHelpTooltip text={axisHelp} />}
          </h3>
          {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
        </div>
      </div>
      <div className="space-y-5 p-4">
        {groups.map(group => (
          <div key={group.key} className="space-y-3">
            {group.ko && (
              <div className="text-xs font-semibold text-muted-foreground">{language === 'ko' ? group.ko : group.en}</div>
            )}
            {group.rows.map(row => (
              <MetricBarRowView
                key={row.key}
                row={row}
                slots={slots}
                language={language}
                getValue={getValue}
                formatValue={formatValue}
                formatPrimaryValue={formatPrimaryValue}
                formatSecondaryValue={formatSecondaryValue}
                getValueTooltip={getValueTooltip}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricBarRowView({
  row,
  slots,
  language,
  getValue,
  formatValue,
  formatPrimaryValue,
  formatSecondaryValue,
  getValueTooltip,
}: {
  row: MetricBarRow;
  slots: CompareSlot[];
  language: 'ko' | 'en';
  getValue: (slot: CompareSlot, rowKey: string) => number | null;
  formatValue: (value: number, row: MetricBarRow) => string;
  formatPrimaryValue?: (slot: CompareSlot, row: MetricBarRow, value: number) => string | null;
  formatSecondaryValue?: (value: number, row: MetricBarRow) => string;
  getValueTooltip?: (slot: CompareSlot, row: MetricBarRow, value: number) => string | null;
}) {
  const values = slots.map((slot, index) => ({ slot, index, value: getValue(slot, row.key) }));
  const usable = values.filter((item): item is { slot: CompareSlot; index: number; value: number } => item.value !== null && Number.isFinite(item.value));
  const bestValue = usable.length
    ? (row.higherIsBetter ? Math.max(...usable.map(item => item.value)) : Math.min(...usable.map(item => item.value)))
    : null;
  const min = usable.length ? Math.min(...usable.map(item => item.value)) : 0;
  const max = usable.length ? Math.max(...usable.map(item => item.value)) : 1;
  const range = max - min;
  const hasSplitValueColumns = Boolean(formatPrimaryValue || formatSecondaryValue);

  return (
    <div className="rounded-md border border-border/80 bg-background/45 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-sm font-semibold">{language === 'ko' ? row.ko : row.en}</div>
        <div className="text-[10px] text-muted-foreground">{row.higherIsBetter ? (language === 'ko' ? '높을수록' : 'higher is better') : (language === 'ko' ? '낮을수록' : 'lower is better')}</div>
      </div>
      <div className="space-y-2">
        {values.map(item => {
          const color = slotColor(item.index);
          const isBest = bestValue !== null && item.value !== null && Math.abs(item.value - bestValue) < 1e-9;
          const width = item.value === null
            ? 0
            : range === 0
              ? 100
              : Math.max(3, Math.min(100, ((item.value - min) / range) * 100));
          const primaryValue = item.value === null ? null : formatPrimaryValue?.(item.slot, row, item.value) ?? null;
          const secondaryValue = item.value === null ? null : (formatSecondaryValue ?? formatValue)(item.value, row);
          const fallbackValue = item.value === null ? '—' : formatValue(item.value, row);
          const tooltip = item.value === null ? null : getValueTooltip?.(item.slot, row, item.value) ?? null;
          const bestBadge = isBest ? (
            <span className="rounded border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">BEST</span>
          ) : null;
          return (
            <div
              key={item.slot.id}
              className={cn(
                'grid items-center gap-2 text-xs',
                hasSplitValueColumns
                  ? 'md:grid-cols-[8rem_minmax(0,1fr)_2.75rem_8.5rem_7.5rem]'
                  : 'md:grid-cols-[8rem_minmax(0,1fr)_7rem]',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="truncate text-muted-foreground">{item.slot.ticker}</span>
              </div>
              <div className="metricBarTrack h-2 rounded-full bg-muted">
                {item.value !== null && (
                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
                )}
              </div>
              {hasSplitValueColumns ? (
                <>
                  <div className="metricBarBestCell flex min-w-0 justify-end">{bestBadge}</div>
                  <MetricBarValue
                    className="metricBarValueCell justify-end font-mono font-semibold text-foreground tabular-nums"
                    value={primaryValue ?? '—'}
                    tooltip={tooltip}
                  />
                  <MetricBarValue
                    className="metricBarGapCell justify-end font-mono text-[11px] text-muted-foreground tabular-nums"
                    value={secondaryValue ?? fallbackValue}
                    tooltip={tooltip}
                  />
                </>
              ) : (
                <div className="flex min-w-0 items-center justify-end gap-2 font-mono tabular-nums">
                  {bestBadge}
                  <MetricBarValue value={fallbackValue} tooltip={tooltip} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricBarValue({
  value,
  tooltip,
  className,
}: {
  value: string;
  tooltip: string | null;
  className?: string;
}) {
  const content = <span className="max-w-full truncate">{value}</span>;

  if (!tooltip) {
    return <span className={cn('inline-flex min-w-0 text-right', className)}>{content}</span>;
  }

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex min-w-0 text-right transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              className,
            )}
            aria-label={tooltip}
          >
            {content}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs whitespace-normal bg-zinc-900 text-left leading-relaxed text-zinc-100 shadow-lg">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getMetricLabel(metricKey: ChartMetricKey, language: 'ko' | 'en'): string {
  const metric = COMPARISON_CHART_METRICS.find(item => item.key === metricKey);
  return metric ? (language === 'ko' ? metric.ko : metric.en) : metricKey;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getAnnualLineItemGrowth(slot: CompareSlot, key: string): number | null {
  const fieldByKey: Record<string, string> = {
    revenue_growth: 'revenue',
    operating_income_growth: 'operating_income',
    earnings_growth: 'net_income',
  };
  const field = fieldByKey[key];
  if (!field) return null;

  const points = (slot.lineItems || [])
    .map(item => ({ date: reportDate(item), value: numericValue(item[field]) }))
    .filter((point): point is { date: string; value: number } => Boolean(point.date) && point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return null;

  const current = points[points.length - 1].value;
  const previous = points[points.length - 2].value;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function reportDate(item: Record<string, any>): string {
  return String(item.report_period || item.period || item.date || '').slice(0, 10);
}

function windowCutoff(chartWindow: ChartWindow): number | null {
  if (chartWindow === 'all') return null;
  const now = new Date();
  if (chartWindow === '3m') now.setMonth(now.getMonth() - 3);
  if (chartWindow === '1y') now.setFullYear(now.getFullYear() - 1);
  if (chartWindow === '3y') now.setFullYear(now.getFullYear() - 3);
  if (chartWindow === '5y') now.setFullYear(now.getFullYear() - 5);
  return now.getTime();
}

function filterByWindow<T extends { label: string }>(points: T[], chartWindow: ChartWindow): T[] {
  const cutoff = windowCutoff(chartWindow);
  if (cutoff === null) return points;
  return points.filter(point => {
    const ts = new Date(point.label).getTime();
    return Number.isFinite(ts) ? ts >= cutoff : true;
  });
}

function filterByWindowWithFallback<T extends { label: string }>(points: T[], chartWindow: ChartWindow): T[] {
  const filtered = filterByWindow(points, chartWindow);
  return filtered.length >= 2 ? filtered : points;
}

function buildMetricPoints(slot: CompareSlot, metricKey: ChartMetricKey, chartWindow: ChartWindow): Array<{ label: string; y: number }> {
  if (metricKey === 'relative_price') {
    const points = (slot.prices || [])
      .filter(p => Number.isFinite(p.close) && p.close > 0)
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(p => ({ label: p.time.slice(0, 10), y: p.close }));
    return filterByWindow(points, chartWindow);
  }

  const items: Array<Record<string, any> & { _label: string }> = (slot.lineItems || [])
    .map(item => ({ ...item, _label: reportDate(item) }))
    .filter((item): item is Record<string, any> & { _label: string } => Boolean(item._label))
    .sort((a, b) => String(a._label).localeCompare(String(b._label)));

  const points = items.map((item, idx) => {
    if (metricKey === 'eps') return { label: item._label, y: numericValue(item.earnings_per_share) };
    if (metricKey === 'free_cash_flow') return { label: item._label, y: numericValue(item.free_cash_flow) };
    if (metricKey === 'liabilities_to_equity') {
      const direct = numericValue(item.liabilities_to_equity);
      if (direct !== null) return { label: item._label, y: direct * 100 };
      const liabilities = numericValue(item.total_liabilities);
      const equity = numericValue(item.shareholders_equity);
      return { label: item._label, y: liabilities !== null && equity !== null && equity !== 0 ? (liabilities / equity) * 100 : null };
    }
    const current = numericValue(item.operating_income);
    const prev = idx > 0 ? numericValue(items[idx - 1].operating_income) : null;
    return {
      label: item._label,
      y: current !== null && prev !== null && prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : null,
    };
  })
    .filter((point): point is { label: string; y: number } => point.y !== null && Number.isFinite(point.y));

  return filterByWindowWithFallback(points, chartWindow);
}

function fmtAxis(value: number, metricKey: ChartMetricKey, axisMode: ChartAxisMode): string {
  if (axisMode === 'normalized') return value.toFixed(0);
  if (metricKey === 'operating_income_growth' || metricKey === 'liabilities_to_equity') return `${value.toFixed(0)}%`;
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 2);
}

function formatDateTick(label: string): string {
  const date = new Date(label);
  if (!Number.isFinite(date.getTime())) return label;
  return `${String(date.getFullYear()).slice(2)}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function buildDateDomain(points: Array<{ label: string }>): ChartDateDomain | null {
  const labels = Array.from(new Set(points
    .map(point => point.label)
    .filter(label => Number.isFinite(new Date(label).getTime()))))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  if (labels.length === 0) return null;
  const min = new Date(labels[0]).getTime();
  const max = new Date(labels[labels.length - 1]).getTime();
  return { min, max: max === min ? min + 1 : max, labels };
}

function dateToChartX(label: string, dateDomain: ChartDateDomain): number {
  const ts = new Date(label).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.min(1, (ts - dateDomain.min) / (dateDomain.max - dateDomain.min)));
}

function buildXAxisTicks(dateDomain: ChartDateDomain | null, compact: boolean): Array<{ label: string; x: number }> {
  if (!dateDomain || dateDomain.labels.length === 0) return [];
  const desired = Math.min(dateDomain.labels.length, compact ? 3 : 5);
  const indexes = Array.from({ length: desired }, (_, idx) => Math.round((idx * (dateDomain.labels.length - 1)) / Math.max(desired - 1, 1)));
  return Array.from(new Set(indexes)).map(idx => {
    const label = dateDomain.labels[idx];
    return { label, x: dateToChartX(label, dateDomain) };
  });
}

function hasMixedSigns(points: Array<{ y: number }>): boolean {
  return points.some(point => point.y > 0) && points.some(point => point.y < 0);
}

function shouldUseIndexedAxis(
  metricKey: ChartMetricKey,
  chartAxisMode: ChartAxisMode,
  series: Array<{ points: Array<{ y: number }> }>,
): boolean {
  if (chartAxisMode !== 'normalized') return false;
  if (metricKey === 'relative_price') return true;
  return series.every(item => {
    const base = item.points.find(point => point.y !== 0)?.y;
    return typeof base === 'number' && base > 0 && !hasMixedSigns(item.points);
  });
}

function RelativeComparisonChart({
  slots,
  metricKey,
  chartWindow,
  chartAxisMode,
  language,
  compact = false,
  height = 200,
}: {
  slots: CompareSlot[];
  metricKey: ChartMetricKey;
  chartWindow: ChartWindow;
  chartAxisMode: ChartAxisMode;
  language: 'ko' | 'en';
  compact?: boolean;
  height?: number;
}) {
  const rawSeries = slots
    .map((slot, idx) => {
      const rawPoints = buildMetricPoints(slot, metricKey, chartWindow);
      if (rawPoints.length < 2) return null;
      return { ticker: slot.ticker, color: CHART_COLORS[idx % CHART_COLORS.length], points: rawPoints };
    })
    .filter((x): x is { ticker: string; color: string; points: { label: string; y: number }[] } => x !== null);
  const dateDomain = buildDateDomain(rawSeries.flatMap(s => s.points));
  const useIndexedAxis = shouldUseIndexedAxis(metricKey, chartAxisMode, rawSeries);
  const effectiveAxisMode: ChartAxisMode = useIndexedAxis ? 'normalized' : 'actual';
  const forcedActualAxis = chartAxisMode === 'normalized' && effectiveAxisMode === 'actual';
  const series = dateDomain
    ? rawSeries.map(item => {
        const base = item.points.find(point => point.y !== 0)?.y;
        const points = item.points.map(point => ({
          label: point.label,
          x: dateToChartX(point.label, dateDomain),
          y: useIndexedAxis && base ? (point.y / base) * 100 : point.y,
        }));
        return { ...item, points };
      })
    : [];

  const chartHeader = (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>
        {getMetricLabel(metricKey, language)}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {effectiveAxisMode === 'normalized'
          ? (language === 'ko' ? '시작점 100 기준' : 'Indexed to 100')
          : forcedActualAxis
            ? (language === 'ko' ? '실값 전환' : 'Actual axis')
          : (language === 'ko' ? '실값' : 'Actual')}
      </div>
    </div>
  );

  if (series.length === 0) {
    return (
      <div className={cn('p-3', compact && 'p-2')}>
        {chartHeader}
        <div className="flex items-center justify-center text-center text-xs text-muted-foreground" style={{ minHeight: Math.max(height - 36, 96) }}>
          {language === 'ko' ? '표시할 시계열 데이터가 없습니다.' : 'No time-series data to display.'}
        </div>
      </div>
    );
  }

  const allY = series.flatMap(s => s.points.map(p => p.y));
  const baselineValues = effectiveAxisMode === 'normalized' ? [100] : [];
  const minY = Math.min(...allY, ...baselineValues);
  const maxY = Math.max(...allY, ...baselineValues);
  const range = maxY - minY || 1;
  const W = 600;
  const H = height;
  const padL = compact ? 34 : 48;
  const padR = 10;
  const padT = 16;
  const padB = compact ? 34 : 42;

  const toSvg = (x: number, y: number) => ({
    sx: padL + x * (W - padL - padR),
    sy: H - padB - ((y - minY) / range) * (H - padT - padB),
  });
  const yTicks = [minY, minY + range / 2, maxY];
  const xTicks = buildXAxisTicks(dateDomain, compact);

  return (
    <div className={cn('p-3', compact && 'p-2')}>
      {chartHeader}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {yTicks.map(tick => {
          const { sy } = toSvg(0, tick);
          return (
            <g key={tick}>
              <line x1={padL} x2={W - padR} y1={sy} y2={sy} stroke="currentColor" strokeOpacity={0.12} />
              <text x={padL - 6} y={sy + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity="0.55">
                {fmtAxis(tick, metricKey, effectiveAxisMode)}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="currentColor" strokeOpacity={0.18} />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="currentColor" strokeOpacity={0.18} />
        {xTicks.map(tick => {
          const { sx } = toSvg(tick.x, minY);
          return (
            <g key={`${tick.label}-${tick.x}`}>
              <line x1={sx} x2={sx} y1={padT} y2={H - padB} stroke="currentColor" strokeOpacity={0.08} />
              <line x1={sx} x2={sx} y1={H - padB} y2={H - padB + 4} stroke="currentColor" strokeOpacity={0.35} />
              <text x={sx} y={H - 8} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">
                {formatDateTick(tick.label)}
              </text>
            </g>
          );
        })}
        {series.map(s => {
          const d = s.points
            .map((p, i) => {
              const { sx, sy } = toSvg(p.x, p.y);
              return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
            })
            .join(' ');
          return <path key={s.ticker} d={d} fill="none" stroke={s.color} strokeWidth={1.5} />;
        })}
      </svg>
      <div className={cn('mt-2 flex flex-wrap gap-3', compact && 'gap-2')}>
        {series.map(s => (
          <div key={s.ticker} className="flex items-center gap-1 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.ticker}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {forcedActualAxis
            ? (language === 'ko'
              ? '가로축은 실제 보고일 기준입니다. 음수와 양수가 섞인 지표는 상대축 왜곡을 막기 위해 실값축으로 표시합니다.'
              : 'X-axis uses actual report dates. Mixed-sign metrics use an actual axis to avoid distorted indexing.')
            : (language === 'ko'
              ? '가로축은 실제 보고일 기준이며, 세로축은 선택한 상대/실값 모드입니다.'
              : 'X-axis uses actual report dates; Y-axis follows the selected indexed/actual mode.')}
        </div>
      )}
    </div>
  );
}
