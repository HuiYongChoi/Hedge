import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ui/llm-selector';
import { resolveTickerValue, TickerInput } from '@/components/ui/ticker-input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/language-context';
import { Agent, getAgents } from '@/data/agents';
import { getDefaultModel, getModels, LanguageModel } from '@/data/models';
import { t } from '@/lib/language-preferences';
import { stockAnalysisRunService, StockAnalysisRunStatus } from '@/services/stock-analysis-run-service';
import { Bot, ChevronDown, ChevronUp, Info, Loader2, Play, Search, Square } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (typeof window !== 'undefined' && 
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
    ? 'http://localhost:8000' 
    : '/hedge-api');

interface AgentResult {
  agentKey: string;
  agentName: string;
  status: 'waiting' | 'running' | 'complete' | 'error';
  ticker?: string;
  message?: string;
  analysis?: any;
  report?: Record<string, any>;
  timestamp?: string;
}

interface CompleteResult {
  decisions?: Record<string, any>;
  analyst_signals?: Record<string, any>;
  reasoning?: string;
}

interface DetailReportState {
  agentName: string;
  markdown: string;
}

interface StockAnalysisSavedState {
  tickers: string;
  startDate: string;
  endDate: string;
  selectedModel: LanguageModel | null;
  selectedAgentKeys: string[];
  agentResults: AgentResult[];
  completeResult: CompleteResult | null;
  expandedAgentKeys: string[];
  selectedDetailReport: DetailReportState | null;
  errorMessage: string | null;
}

function serializeStockAnalysisState(state: {
  tickers: string;
  startDate: string;
  endDate: string;
  selectedModel: LanguageModel | null;
  selectedAgents: Set<string>;
  agentResults: Map<string, AgentResult>;
  completeResult: CompleteResult | null;
  expandedAgents: Set<string>;
  selectedDetailReport: DetailReportState | null;
  errorMessage: string | null;
}): StockAnalysisSavedState {
  return {
    tickers: state.tickers,
    startDate: state.startDate,
    endDate: state.endDate,
    selectedModel: state.selectedModel,
    selectedAgentKeys: Array.from(state.selectedAgents),
    agentResults: Array.from(state.agentResults.values()),
    completeResult: state.completeResult,
    expandedAgentKeys: Array.from(state.expandedAgents),
    selectedDetailReport: state.selectedDetailReport,
    errorMessage: state.errorMessage,
  };
}

function restoreStockAnalysisState(
  savedState: Record<string, any> | null | undefined,
  availableAgents: Agent[],
  availableModels: LanguageModel[],
  defaultModel: LanguageModel | null,
) {
  const state = (savedState || {}) as Partial<StockAnalysisSavedState>;
  const availableAgentKeys = new Set(availableAgents.map(agent => agent.key));
  const selectedAgentKeys = (state.selectedAgentKeys || []).filter(key => availableAgentKeys.has(key));
  const restoredModel = state.selectedModel
    ? availableModels.find(model =>
        model.model_name === state.selectedModel?.model_name &&
        model.provider === state.selectedModel?.provider
      ) || state.selectedModel
    : defaultModel;

  return {
    tickers: state.tickers || '',
    startDate: state.startDate || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      return d.toISOString().split('T')[0];
    })(),
    endDate: state.endDate || new Date().toISOString().split('T')[0],
    selectedModel: restoredModel,
    selectedAgents: new Set(selectedAgentKeys),
    agentResults: new Map((state.agentResults || []).map(result => [result.agentKey, result])),
    completeResult: state.completeResult || null,
    expandedAgents: new Set(state.expandedAgentKeys || []),
    selectedDetailReport: state.selectedDetailReport || null,
    errorMessage: state.errorMessage || null,
  };
}

function getStockAnalysisStatus(
  isRunning: boolean,
  errorMessage: string | null,
  completeResult: CompleteResult | null,
  agentResults: Map<string, AgentResult>,
): StockAnalysisRunStatus {
  if (isRunning) return 'IN_PROGRESS';
  if (errorMessage) return 'ERROR';
  if (completeResult || Array.from(agentResults.values()).some(result => result.status === 'complete')) return 'COMPLETE';
  return 'IDLE';
}

function extractBaseAgentKey(agentId: string) {
  const withoutAgentSuffix = agentId.replace(/_agent/g, '');
  const parts = withoutAgentSuffix.split('_');
  const suffix = parts[parts.length - 1];

  if (/^[a-z0-9]{6}$/.test(suffix)) {
    return parts.slice(0, -1).join('_');
  }

  return withoutAgentSuffix;
}

function getAgentDisplayName(agent: Agent, language: 'ko' | 'en') {
  return language === 'ko' && agent.display_name_ko ? agent.display_name_ko : agent.display_name;
}

function getAgentDescription(agent: Agent, language: 'ko' | 'en') {
  return language === 'ko' && agent.investing_style_ko ? agent.investing_style_ko : agent.investing_style;
}

function normalizeConfidence(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;

  const percentage = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(percentage)));
}

function getSignalLabel(signal: unknown, language: 'ko' | 'en') {
  const raw = String(signal || 'neutral').toLowerCase();

  if (raw === 'bullish' || raw === 'buy' || raw === 'long') {
    return language === 'ko' ? '매수/강세' : 'Buy / Bullish';
  }
  if (raw === 'bearish' || raw === 'sell' || raw === 'short') {
    return language === 'ko' ? '매도/약세' : 'Sell / Bearish';
  }
  return language === 'ko' ? '중립/관망' : 'Hold / Neutral';
}

function getSignalClass(signal: unknown) {
  const raw = String(signal || 'neutral').toLowerCase();

  if (raw === 'bullish' || raw === 'buy' || raw === 'long') {
    return 'border-green-500/30 bg-green-500/10 text-green-500';
  }
  if (raw === 'bearish' || raw === 'sell' || raw === 'short') {
    return 'border-red-500/30 bg-red-500/10 text-red-500';
  }
  return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500';
}

function formatConfidence(value: unknown) {
  const confidence = normalizeConfidence(value);
  return confidence === null ? null : `${confidence}%`;
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function isKoreanStock(ticker: string) {
  const trimmed = ticker.trim();
  // 한글 기업명 또는 숫자로 시작하는 KS/KQ 티커
  if (/[\uAC00-\uD7A3]/.test(trimmed)) return true;
  const normalized = normalizeTicker(trimmed);
  return /^[0-9][0-9A-Z._-]*$/.test(normalized);
}

function getKoreanStockCode(ticker: string) {
  const trimmed = ticker.trim();
  // 한글 기업명이면 숫자 코드 추출을 위해 resolveTickerValue로 먼저 변환
  if (/[\uAC00-\uD7A3]/.test(trimmed)) {
    const resolved = resolveTickerValue(trimmed);
    return resolved.match(/\d+/)?.[0] || trimmed;
  }
  const normalized = normalizeTicker(trimmed);
  return normalized.match(/\d+/)?.[0] || normalized;
}

function getResearchLinks(ticker: string) {
  const normalized = normalizeTicker(ticker);

  if (isKoreanStock(normalized)) {
    const code = getKoreanStockCode(normalized);
    return [
      {
        label: 'DART 정기보고서',
        href: `https://dart.fss.or.kr/dsab001/main.do?textCrpNm=${encodeURIComponent(code)}`,
      },
      {
        label: '네이버 증권',
        href: `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`,
      },
    ];
  }

  return [
    {
      label: 'SEC 10-K',
      href: `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(normalized)}&owner=exclude`,
    },
    {
      label: 'Finviz',
      href: `https://finviz.com/quote.ashx?t=${encodeURIComponent(normalized)}`,
    },
  ];
}

function getTickerAnalystReports(analystSignals: Record<string, any> | undefined, ticker: string) {
  if (!analystSignals) return [];

  return Object.entries(analystSignals)
    .filter(([agentId]) => !agentId.startsWith('risk_management_agent'))
    .map(([agentId, signals]) => {
      const report = signals && typeof signals === 'object' ? (signals as Record<string, any>)[ticker] : null;
      if (!report || typeof report !== 'object') return null;
      return {
        agentId,
        signal: report.signal,
        confidence: report.confidence,
      };
    })
    .filter((entry): entry is { agentId: string; signal: unknown; confidence: unknown } => Boolean(entry));
}

function scoreSignal(signal: unknown, confidence: unknown) {
  const raw = String(signal || 'neutral').toLowerCase();
  const normalizedConfidence = normalizeConfidence(confidence) ?? 50;

  if (raw === 'bullish' || raw === 'buy' || raw === 'long' || raw === 'positive') {
    return 50 + normalizedConfidence / 2;
  }
  if (raw === 'bearish' || raw === 'sell' || raw === 'short' || raw === 'negative') {
    return 50 - normalizedConfidence / 2;
  }
  return 50;
}

function scoreDecision(decision: any) {
  const action = String(decision?.action || 'hold').toLowerCase();
  const confidence = normalizeConfidence(decision?.confidence) ?? 50;

  if (action === 'buy' || action === 'cover') return 50 + confidence / 2;
  if (action === 'sell' || action === 'short') return 50 - confidence / 2;
  return 50;
}

function calculateCompositeScore(
  analystSignals: Record<string, any> | undefined,
  ticker: string,
  decision: any,
) {
  const reports = getTickerAnalystReports(analystSignals, ticker);
  const scores = reports
    .map(report => scoreSignal(report.signal, report.confidence))
    .filter(score => Number.isFinite(score));

  if (scores.length === 0) {
    return Math.round(scoreDecision(decision));
  }

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.max(0, Math.min(100, Math.round(average)));
}

function getScoreBand(score: number, language: 'ko' | 'en') {
  if (score >= 80) {
    return {
      label: language === 'ko' ? '강력 매수' : 'Strong Buy',
      className: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
    };
  }
  if (score >= 60) {
    return {
      label: language === 'ko' ? '매수' : 'Buy',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    };
  }
  if (score >= 40) {
    return {
      label: language === 'ko' ? '관망' : 'Watch',
      className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    };
  }
  if (score >= 20) {
    return {
      label: language === 'ko' ? '비중 축소' : 'Reduce',
      className: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400',
    };
  }
  return {
    label: language === 'ko' ? '강력 매도' : 'Strong Sell',
    className: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  };
}

function buildExecutiveSummary(
  ticker: string,
  score: number,
  analystSignals: Record<string, any> | undefined,
  decision: any,
  language: 'ko' | 'en',
) {
  const reports = getTickerAnalystReports(analystSignals, ticker);
  const band = getScoreBand(score, language);

  if (reports.length === 0) {
    return language === 'ko'
      ? `${ticker}의 종합 점수는 ${score}점으로 ${band.label} 구간입니다. 에이전트 신호가 제한적이므로 추가 확인이 필요합니다.`
      : `${ticker} has a composite score of ${score}, placing it in the ${band.label} range. Agent signal coverage is limited, so review the details before acting.`;
  }

  const bullishCount = reports.filter(report => scoreSignal(report.signal, report.confidence) > 55).length;
  const bearishCount = reports.filter(report => scoreSignal(report.signal, report.confidence) < 45).length;
  const neutralCount = reports.length - bullishCount - bearishCount;
  const quantity = Number(decision?.quantity || 0);
  const actionNote = quantity > 0
    ? language === 'ko'
      ? `참고 주문 수량은 ${quantity}주입니다.`
      : `Reference order size is ${quantity} shares.`
    : language === 'ko'
      ? '시드머니 기반 주문 수량 없이 판단 상태만 표시합니다.'
      : 'No seed-money-based order size is shown; this is a decision status only.';

  return language === 'ko'
    ? `${reports.length}개 에이전트 기준 강세 ${bullishCount}개, 약세 ${bearishCount}개, 중립 ${neutralCount}개입니다. 종합 판단은 ${band.label}이며 ${actionNote}`
    : `${reports.length} agents show ${bullishCount} bullish, ${bearishCount} bearish, and ${neutralCount} neutral views. The combined decision is ${band.label}. ${actionNote}`;
}

function ScoreTooltip({ language }: { language: 'ko' | 'en' }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={language === 'ko' ? '종합 점수 기준' : 'Composite score guide'}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {language === 'ko' ? (
            <div className="space-y-1">
              <div>80~100점: 강력 매수</div>
              <div>60~79점: 매수</div>
              <div>40~59점: 관망(중립)</div>
              <div>20~39점: 비중 축소</div>
              <div>0~19점: 강력 매도</div>
            </div>
          ) : (
            <div className="space-y-1">
              <div>80-100: Strong Buy</div>
              <div>60-79: Buy</div>
              <div>40-59: Watch / Neutral</div>
              <div>20-39: Reduce</div>
              <div>0-19: Strong Sell</div>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ResearchQuickLinks({ tickers, language }: { tickers: string[]; language: 'ko' | 'en' }) {
  // 한국 기업명은 티커 코드로 변환 후 처리
  const normalizedTickers = Array.from(new Set(
    tickers.map(t => normalizeTicker(resolveTickerValue(t.trim()))).filter(Boolean)
  ));

  if (normalizedTickers.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-border/70 bg-muted/10 px-4 py-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {language === 'ko' ? '참고 자료 및 원본 공시' : 'Reference filings and market data'}
      </div>
      <div className="flex flex-wrap gap-2">
        {normalizedTickers.map((ticker) => (
          <div key={ticker} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-muted-foreground">{ticker}</span>
            {getResearchLinks(ticker).map((link, index) => (
              <a
                key={`${ticker}-${link.label}`}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  index === 0
                    ? 'inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300'
                    : 'inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-primary'
                }
              >
                {link.label}
                <span className="ml-1 text-[10px]" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function normalizeCrossCheckGuideHeading(markdown: string) {
  return markdown.replace(
    /#{1,6}\s*🔍\s*(?:[^\n#]*?의\s*)?원문 대조 체크리스트/gu,
    '### 🔍 원문 대조 체크리스트',
  );
}

function formatDecisionReasoning(value: unknown) {
  if (!value) return '';

  return normalizeCrossCheckGuideHeading(String(value))
    .replace(/\r\n?/g, '\n')
    .replace(/([^\n])\s*(###\s*🔍\s*원문 대조 체크리스트)/gu, '$1\n\n$2')
    .replace(/(###\s*🔍\s*원문 대조 체크리스트)\s*/gu, '$1\n\n')
    .replace(/\s*(\d+)[).]\s+\*\*(핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증):\*\*/gu, '\n$1. **$2:**')
    .replace(/\s*[-–]\s+\*\*(핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증):\*\*/gu, '\n- **$1:**')
    .replace(/\s+\*\*(핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증):\*\*/gu, '\n\n**$1:**')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractCrossCheckGuide(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const headingIndex = trimmed.search(/###\s*🔍/u);
    if (headingIndex >= 0) {
      return normalizeCrossCheckGuideHeading(trimmed.slice(headingIndex).trim());
    }

    const checklistIndex = trimmed.search(/원문 대조 체크리스트|핵심 타겟 데이터|원문 추적 섹션|경영진 멘트 검증/u);
    if (checklistIndex >= 0) {
      const body = trimmed.slice(checklistIndex).trim();
      return body.startsWith('###')
        ? normalizeCrossCheckGuideHeading(body)
        : normalizeCrossCheckGuideHeading(`### 🔍 원문 대조 체크리스트\n${body}`);
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const guide = extractCrossCheckGuide(item);
      if (guide) return guide;
    }
    return null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, any>;
    const directFields = [
      'cross_check_guide',
      'crossCheckGuide',
      'source_check_guide',
      'sourceCheckGuide',
      'detail_report',
      'verification_guide',
    ];

    for (const field of directFields) {
      const guide = extractCrossCheckGuide(record[field]);
      if (guide) return guide;
    }

    const narrativeFields = ['reasoning', 'details', 'explanation', 'summary', 'analysis'];
    for (const field of narrativeFields) {
      const guide = extractCrossCheckGuide(record[field]);
      if (guide) return guide;
    }

    for (const nestedValue of Object.values(record)) {
      const guide = extractCrossCheckGuide(nestedValue);
      if (guide) return guide;
    }
  }

  return null;
}

function getAnalysisReportEntries(analysis: any) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return [] as Array<{ ticker: string; report: Record<string, any> }>;
  }

  return Object.entries(analysis)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([ticker, value]) => ({
      ticker,
      report: value as Record<string, any>,
    }));
}

function formatGuideMetricValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : null;
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  return null;
}

function getGuideMetricSnippets(report: Record<string, any>) {
  const candidates = [
    ['signal', '에이전트 의견'],
    ['confidence', '신뢰도'],
    ['score', '점수'],
    ['intrinsic_value', '내재가치'],
    ['market_cap', '시가총액'],
    ['revenue_growth', '매출 성장률'],
    ['operating_margin', '영업이익률'],
    ['free_cash_flow', '잉여현금흐름'],
    ['fcf_yield', 'FCF 수익률'],
    ['wacc', 'WACC'],
    ['rd_expense', 'R&D 지출'],
  ];

  return candidates
    .map(([key, label]) => {
      const value = formatGuideMetricValue(report[key]);
      if (!value) return null;
      return `${label} ${value}`;
    })
    .filter((snippet): snippet is string => Boolean(snippet))
    .slice(0, 3);
}

function buildFallbackCrossCheckGuide(result: AgentResult) {
  const entries = getAnalysisReportEntries(result.analysis);
  const primary = entries[0];
  const ticker = primary?.ticker || result.ticker || normalizeTicker('');
  const report = primary?.report || {};
  const metrics = getGuideMetricSnippets(report);
  const targetData = metrics.length > 0
    ? metrics.join(', ')
    : '전처리 데이터에서 제공된 신호, 신뢰도, 핵심 재무/시장 지표(N/A 포함)';
  const sourceSections = ticker && isKoreanStock(ticker)
    ? 'DART 사업보고서의 「사업의 내용」, 「재무에 관한 사항」, 「이사의 경영진단 및 분석의견」, 주요 주석을 우선 확인하십시오.'
    : 'SEC 10-K의 MD&A, Risk Factors, Financial Statements, Notes to Financial Statements를 우선 확인하십시오.';

  return `### 🔍 원문 대조 체크리스트

1. **핵심 타겟 데이터:** ${targetData}.
2. **원문 추적 섹션:** ${sourceSections}
3. **경영진 멘트 검증:** 에이전트의 긍정/부정 논거가 경영진의 실제 설명, 리스크 요인, 투자 계획, 자본 배분 발언과 일치하는지 원문 문장 단위로 확인하십시오.`;
}

function getDetailReportMarkdown(result: AgentResult) {
  return extractCrossCheckGuide(result.analysis)
    || extractCrossCheckGuide(result.report)
    || buildFallbackCrossCheckGuide(result);
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+?\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function renderMarkdownBlocks(markdown: string): ReactNode {
  const elements: ReactNode[] = [];
  let orderedItems: string[] = [];
  let unorderedItems: string[] = [];

  const flushLists = () => {
    if (orderedItems.length > 0) {
      const items = orderedItems;
      orderedItems = [];
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-5 list-decimal space-y-3 pl-6">
          {items.map((item, index) => (
            <li key={index} className="pl-1 leading-relaxed text-zinc-300">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ol>,
      );
    }

    if (unorderedItems.length > 0) {
      const items = unorderedItems;
      unorderedItems = [];
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-5 list-disc space-y-2 pl-6">
          {items.map((item, index) => (
            <li key={index} className="pl-1 leading-relaxed text-zinc-300">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>,
      );
    }
  };

  markdown.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushLists();
      return;
    }

    if (trimmed.startsWith('### ')) {
      flushLists();
      elements.push(
        <h3 key={`h3-${index}`} className="mb-5 mt-1 text-xl font-semibold leading-relaxed text-foreground">
          {trimmed.replace(/^###\s+/, '')}
        </h3>,
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      flushLists();
      elements.push(
        <h2 key={`h2-${index}`} className="mb-5 mt-2 text-2xl font-semibold leading-relaxed text-foreground">
          {trimmed.replace(/^##\s+/, '')}
        </h2>,
      );
      return;
    }

    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (orderedMatch) {
      orderedItems.push(orderedMatch[1]);
      return;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      unorderedItems.push(unorderedMatch[1]);
      return;
    }

    flushLists();
    elements.push(
      <p key={`p-${index}`} className="my-4 whitespace-pre-wrap leading-relaxed text-zinc-300">
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
  });

  flushLists();
  return <>{elements}</>;
}

export function StockSearchTab() {
  const { language } = useLanguage();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<LanguageModel[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<LanguageModel | null>(null);
  const [tickers, setTickers] = useState('');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0];
  });
  const [isRunning, setIsRunning] = useState(false);
  const [agentResults, setAgentResults] = useState<Map<string, AgentResult>>(new Map());
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [selectedDetailReport, setSelectedDetailReport] = useState<DetailReportState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const savedRunIdRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPersistedPayloadRef = useRef<string>('');
  const [hasRestoredSavedRun, setHasRestoredSavedRun] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [agentList, modelList, defaultModel] = await Promise.all([
          getAgents(),
          getModels(),
          getDefaultModel(),
        ]);
        setAgents(agentList);
        setModels(modelList);

        let restored = false;
        try {
          const latestRun = await stockAnalysisRunService.getLatestRun();
          if (latestRun?.ui_state) {
            const restoredState = restoreStockAnalysisState(latestRun.ui_state, agentList, modelList, defaultModel);
            savedRunIdRef.current = latestRun.id;
            setTickers(restoredState.tickers);
            setStartDate(restoredState.startDate);
            setEndDate(restoredState.endDate);
            setSelectedModel(restoredState.selectedModel);
            setSelectedAgents(restoredState.selectedAgents);
            setAgentResults(restoredState.agentResults);
            setCompleteResult(restoredState.completeResult);
            setExpandedAgents(restoredState.expandedAgents);
            setSelectedDetailReport(restoredState.selectedDetailReport);
            setErrorMessage(restoredState.errorMessage);
            restored = true;
          }
        } catch (restoreError) {
          console.warn('Failed to restore latest Stock Analysis run', restoreError);
        }

        if (!restored) {
          setSelectedModel(defaultModel);
          // Select nothing by default
          setSelectedAgents(new Set());
        }
      } catch (err) {
        console.error('Failed to load agents/models', err);
      } finally {
        setHasRestoredSavedRun(true);
      }
    };
    load();
  }, []);

  const persistCurrentRun = useCallback(async () => {
    if (!hasRestoredSavedRun) return;

    const uiState = serializeStockAnalysisState({
      tickers,
      startDate,
      endDate,
      selectedModel,
      selectedAgents,
      agentResults,
      completeResult,
      expandedAgents,
      selectedDetailReport,
      errorMessage,
    });
    const firstTicker = tickers.trim() ? resolveTickerValue(tickers.split(',')[0].trim()).toUpperCase() : null;
    const payload = {
      ticker: firstTicker,
      language,
      status: getStockAnalysisStatus(isRunning, errorMessage, completeResult, agentResults),
      request_data: {
        tickers: firstTicker ? [firstTicker] : [],
        start_date: startDate,
        end_date: endDate,
        selected_agent_keys: Array.from(selectedAgents),
        selected_model: selectedModel,
      },
      result_data: {
        completeResult,
        agentResults: uiState.agentResults,
      },
      ui_state: uiState,
      error_message: errorMessage,
    };
    const serializedPayload = JSON.stringify(payload);
    if (serializedPayload === lastPersistedPayloadRef.current) return;

    try {
      const savedRun = await stockAnalysisRunService.saveLatestRun(payload, savedRunIdRef.current);
      savedRunIdRef.current = savedRun.id;
      lastPersistedPayloadRef.current = serializedPayload;
    } catch (saveError) {
      console.warn('Failed to persist Stock Analysis run', saveError);
    }
  }, [
    agentResults,
    completeResult,
    endDate,
    errorMessage,
    expandedAgents,
    hasRestoredSavedRun,
    isRunning,
    language,
    selectedAgents,
    selectedDetailReport,
    selectedModel,
    startDate,
    tickers,
  ]);

  useEffect(() => {
    if (!hasRestoredSavedRun) return;
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      persistCurrentRun();
    }, 700);

    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
    };
  }, [
    agentResults,
    completeResult,
    endDate,
    errorMessage,
    expandedAgents,
    hasRestoredSavedRun,
    isRunning,
    language,
    persistCurrentRun,
    selectedAgents,
    selectedDetailReport,
    selectedModel,
    startDate,
    tickers,
  ]);

  const allSelected = agents.length > 0 && selectedAgents.size === agents.length;
  const someSelected = selectedAgents.size > 0 && !allSelected;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedAgents(new Set());
    } else {
      setSelectedAgents(new Set(agents.map(a => a.key)));
    }
  };

  const handleToggleAgent = (key: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
  };

  const handleRun = async () => {
    if (!tickers.trim() || selectedAgents.size === 0) return;

    // Use only the first ticker for single ticker analysis
    // 한국 기업명이 입력된 경우 티커 코드로 변환
    const rawTicker = tickers.split(',')[0].trim();
    const singleTicker = resolveTickerValue(rawTicker).toUpperCase();
    if (!singleTicker) return;

    setTickers(rawTicker);

    setIsRunning(true);
    setErrorMessage(null);
    setCompleteResult(null);
    setSelectedDetailReport(null);

    // Build initial agent results map
    const initialResults = new Map<string, AgentResult>();
    agents.filter(a => selectedAgents.has(a.key)).forEach(agent => {
      initialResults.set(agent.key, {
        agentKey: agent.key,
        agentName: getAgentDisplayName(agent, language),
        status: 'waiting',
      });
    });
    setAgentResults(initialResults);

    // Build graph nodes and edges
    const tickerList = [singleTicker];
    const suffix = Math.random().toString(36).slice(2, 8);
    const pmId = `portfolio_manager_${suffix}`;

    const agentNodes = agents
      .filter(a => selectedAgents.has(a.key))
      .map(a => ({
        id: `${a.key}_${suffix}`,
        type: 'agent-node',
        data: { name: a.display_name, description: a.investing_style, status: 'Idle' },
        position: { x: 0, y: 0 },
      }));

    const graphNodes = [
      ...agentNodes,
      {
        id: pmId,
        type: 'portfolio-manager-node',
        data: { name: 'Portfolio Manager', status: 'IDLE' },
        position: { x: 0, y: 0 },
      },
    ];

    // Backend auto-connects start_node to agents with no incoming edges.
    // Only send agent → pm edges.
    const graphEdges = agentNodes.map((n, i) => ({
      id: `e-agent-pm-${i}`,
      source: n.id,
      target: pmId,
    }));

    const agentModels = selectedModel
      ? [...agentNodes.map(n => ({
          agent_id: n.id,
          model_name: selectedModel.model_name,
          model_provider: selectedModel.provider,
        })),
        { agent_id: pmId, model_name: selectedModel.model_name, model_provider: selectedModel.provider }]
      : [];

    const body = {
      tickers: tickerList,
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      agent_models: agentModels,
      start_date: startDate,
      end_date: endDate,
      language: language,
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${API_BASE_URL}/hedge-fund/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventText of events) {
          if (!eventText.trim()) continue;
          try {
            const typeMatch = eventText.match(/^event: (.+)$/m);
            const dataMatch = eventText.match(/^data: (.+)$/m);
            if (!typeMatch || !dataMatch) continue;

            const eventType = typeMatch[1];
            const eventData = JSON.parse(dataMatch[1]);

            if (eventType === 'progress' && eventData.agent) {
              // Map backend unique node ids (e.g. "warren_buffett_a1b2c3") to agent keys.
              const baseKey = extractBaseAgentKey(eventData.agent);
              setAgentResults(prev => {
                const next = new Map(prev);
                const existing = next.get(baseKey);
                if (existing) {
                  next.set(baseKey, {
                    ...existing,
                    status: eventData.status === 'Done' ? 'complete' : 'running',
                    ticker: eventData.ticker,
                    message: eventData.status,
                    analysis: eventData.analysis ?? existing.analysis,
                    timestamp: eventData.timestamp,
                  });
                }
                return next;
              });
            } else if (eventType === 'complete') {
              const completeData = eventData.data || eventData;
              setCompleteResult(completeData);
              setAgentResults(prev => {
                const next = new Map(prev);
                const analystSignals = completeData.analyst_signals || {};

                Object.entries(analystSignals).forEach(([agentId, report]) => {
                  const baseKey = extractBaseAgentKey(agentId);
                  if (!selectedAgents.has(baseKey)) return;

                  const existing = next.get(baseKey);
                  if (existing) {
                    next.set(baseKey, {
                      ...existing,
                      status: 'complete',
                      analysis: report,
                      report: report as Record<string, any>,
                    });
                  }
                });

                next.forEach((val, key) => {
                  next.set(key, { ...val, status: 'complete' });
                });
                return next;
              });
            } else if (eventType === 'error') {
              setErrorMessage(eventData.message || 'Unknown error');
              setAgentResults(prev => {
                const next = new Map(prev);
                next.forEach((val, key) => {
                  if (val.status !== 'complete') {
                    next.set(key, { ...val, status: 'error' });
                  }
                });
                return next;
              });
            }
          } catch (_) {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setErrorMessage(err.message || 'Connection error');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openDetailReport = (event: MouseEvent<HTMLButtonElement>, result: AgentResult) => {
    event.stopPropagation();
    setSelectedDetailReport({
      agentName: result.agentName,
      markdown: getDetailReportMarkdown(result),
    });
  };

  const closeDetailReport = () => {
    setSelectedDetailReport(null);
  };

  const statusColor = (status: AgentResult['status']) => {
    switch (status) {
      case 'complete': return 'text-green-500';
      case 'running': return 'text-blue-500';
      case 'error': return 'text-red-500';
      default: return 'text-muted-foreground';
    }
  };

  const statusLabel = (status: AgentResult['status']) => {
    switch (status) {
      case 'complete': return t('completeStatus', language);
      case 'running': return t('runningStatus', language);
      case 'error': return t('errorStatus', language);
      default: return t('waitingStatus', language);
    }
  };

  const canRun = tickers.trim() !== '' && selectedAgents.size > 0 && !isRunning;

  return (
    <>
    <div
      id="main-summary-view"
      style={{ display: selectedDetailReport ? 'none' : 'flex' }}
      className="h-full w-full flex-col bg-background overflow-hidden"
    >
      {/* Header */}
      <div className="border-b p-4 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Search size={18} className="text-blue-500" />
          <h1 className="text-lg font-semibold text-primary">
            {language === 'ko' ? '종목 분석' : 'Stock Analysis'}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {language === 'ko'
            ? '종목을 검색하고 원하는 에이전트를 선택해 상세 분석 보고서를 받으세요.'
            : 'Search for stocks and select agents to receive detailed analysis reports.'}
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Config Panel */}
        <div className="w-72 flex-shrink-0 border-r overflow-y-auto p-4 space-y-4">
          {/* Tickers */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('tickers', language)}</label>
            <TickerInput
              placeholder={language === 'ko' ? '단일 종목 입력 (예: AAPL)' : 'Enter single ticker (e.g. AAPL)'}
              value={tickers}
              onChange={val => {
                 setTickers(val);
              }}
              onKeyDown={e => { if (e.key === 'Enter' && canRun) handleRun(); }}
            />
            <p className="text-xs text-muted-foreground">
              {language === 'ko' ? '단일 종목만 검색 및 분석이 가능합니다.' : 'Only a single ticker can be analyzed at a time.'}
            </p>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs">{t('startDate', language)}</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs">{t('endDate', language)}</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs" />
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('nodeModel', language)}</label>
            <ModelSelector
              models={models}
              value={selectedModel?.model_name || ''}
              onChange={setSelectedModel}
              placeholder="Auto"
            />
          </div>

          {/* Agent selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('analystNodes', language)}</label>

            {/* Select All */}
            <div className="flex items-center gap-2 pb-1 border-b">
              <Checkbox
                id="select-all"
                checked={allSelected}
                ref={(el) => {
                  if (el) (el as any).indeterminate = someSelected;
                }}
                onCheckedChange={handleSelectAll}
              />
              <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                {language === 'ko' ? '모두 선택' : 'Select All'}
              </label>
              <span className="ml-auto text-xs text-muted-foreground">{selectedAgents.size}/{agents.length}</span>
            </div>

            {/* Categories Accordion */}
            <Accordion type="multiple" defaultValue={Array.from(new Set(agents.map(a => a.category || 'Other')))}>
              {Array.from(new Set(agents.map(a => a.category || 'Other'))).map(category => {
                const categoryAgents = agents.filter(a => (a.category || 'Other') === category);
                const categoryKo = categoryAgents[0]?.category_ko || '기타';
                return (
                  <AccordionItem key={category} value={category} className="border-b-0">
                    <AccordionTrigger className="py-2 text-sm font-semibold hover:no-underline">
                      {language === 'ko' ? categoryKo : category}
                    </AccordionTrigger>
                    <AccordionContent className="space-y-2 pb-2">
                      {categoryAgents.map(agent => (
                        <div key={agent.key} className="flex items-start gap-2">
                          <Checkbox
                            id={`agent-${agent.key}`}
                            checked={selectedAgents.has(agent.key)}
                            onCheckedChange={() => handleToggleAgent(agent.key)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <label htmlFor={`agent-${agent.key}`} className="text-sm cursor-pointer leading-tight">
                              {getAgentDisplayName(agent, language)}
                            </label>
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              {getAgentDescription(agent, language)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>

          {/* Run Button */}
          <Button
            className="w-full"
            onClick={isRunning ? handleStop : handleRun}
            disabled={!canRun && !isRunning}
            variant={isRunning ? 'destructive' : 'default'}
          >
            {isRunning ? (
              <><Square className="h-4 w-4 mr-2" /> {language === 'ko' ? '중지' : 'Stop'}</>
            ) : (
              <><Play className="h-4 w-4 mr-2" /> {language === 'ko' ? '분석 실행' : 'Run Analysis'}</>
            )}
          </Button>
        </div>

        {/* Right: Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {agentResults.size === 0 && !isRunning && (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-2">
                <Bot size={40} className="mx-auto opacity-30" />
                <p className="text-sm">
                  {language === 'ko'
                    ? '종목과 에이전트를 선택한 후 분석을 실행하세요.'
                    : 'Enter a ticker and select agents to run analysis.'}
                </p>
              </div>
            </div>
          )}

          {/* Agent cards */}
          {Array.from(agentResults.values()).map(result => {
            const isExpanded = expandedAgents.has(result.agentKey);
            return (
              <Card key={result.agentKey} className="overflow-hidden">
                <CardHeader
                  className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => result.analysis && toggleExpand(result.agentKey)}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Bot size={16} className={statusColor(result.status)} />
                    <CardTitle className="min-w-[140px] flex-1 text-sm font-medium">{result.agentName}</CardTitle>
                    {result.analysis && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-100"
                        onClick={(event) => openDetailReport(event, result)}
                      >
                        🔍 원문 대조 리포트 보기
                      </Button>
                    )}
                    {result.ticker && (
                      <Badge variant="outline" className="text-xs">{result.ticker}</Badge>
                    )}
                    <span className={`text-xs font-medium ${statusColor(result.status)}`}>
                      {result.status === 'running' && <Loader2 size={12} className="inline animate-spin mr-1" />}
                      {statusLabel(result.status)}
                    </span>
                    {result.analysis && (
                      isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />
                    )}
                  </div>
                  {result.message && result.message !== 'Done' && (
                    <p className="text-xs text-muted-foreground mt-1">{result.message}</p>
                  )}
                </CardHeader>

                {isExpanded && result.analysis && (
                  <CardContent className="px-4 pb-4 pt-0">
                    <div className="border-t pt-3 space-y-2">
                      {typeof result.analysis === 'object' && Object.keys(result.analysis).some(k => typeof result.analysis[k] === 'object' && ('signal' in result.analysis[k] || 'confidence' in result.analysis[k])) ? (
                        <AgentReportSummary analysis={result.analysis} language={language} />
                      ) : (
                        <AnalysisDisplay analysis={result.analysis} agentKey={result.agentKey} language={language} />
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}

          {completeResult && completeResult.decisions && (
            <ResearchQuickLinks
              tickers={Object.keys(completeResult.decisions)}
              language={language}
            />
          )}

          {/* Final Decision */}
          {completeResult && completeResult.decisions && (
            <Card className="border-green-300 dark:border-green-700">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">
                  {language === 'ko' ? '최종 투자 결정' : 'Final Investment Decisions'}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="space-y-3">
                  {Object.entries(completeResult.decisions).map(([ticker, decision]: [string, any]) => {
                    const compositeScore = calculateCompositeScore(
                      completeResult.analyst_signals,
                      ticker,
                      decision,
                    );
                    const scoreBand = getScoreBand(compositeScore, language);
                    const executiveSummary = buildExecutiveSummary(
                      ticker,
                      compositeScore,
                      completeResult.analyst_signals,
                      decision,
                      language,
                    );
                    const quantity = Number(decision?.quantity || 0);
                    const action = String(decision?.action || '').toLowerCase();

                    return (
                      <div key={ticker} className="rounded-md border border-border bg-background/60 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-primary">{ticker}</span>
                            <Badge variant="outline" className={scoreBand.className}>
                              {scoreBand.label}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold text-primary">
                              {language === 'ko' ? '종합 점수' : 'Composite Score'}: {compositeScore} / 100
                            </span>
                            <ScoreTooltip language={language} />
                            {quantity > 0 && action !== 'hold' && (
                              <span className="text-xs text-muted-foreground">
                                {language === 'ko' ? '참고 수량' : 'Reference Qty'}: {quantity} {t('shares', language)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 rounded-md bg-muted/20 p-3">
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            {language === 'ko' ? '약식 요약' : 'Executive Summary'}
                          </div>
                          <p className="text-sm leading-relaxed text-foreground">
                            {executiveSummary}
                          </p>
                          {decision?.reasoning && (
                            <div className="mt-3 border-t border-border/60 pt-3">
                              <div className="mb-2 text-xs font-medium text-muted-foreground">
                                {language === 'ko' ? '상세 근거' : 'Detailed Rationale'}
                              </div>
                              <div className="text-xs leading-relaxed text-muted-foreground [&_h2]:mb-2 [&_h2]:mt-1 [&_h2]:text-sm [&_h3]:mb-2 [&_h3]:mt-1 [&_h3]:text-sm [&_li]:text-muted-foreground [&_ol]:my-2 [&_p]:my-2 [&_p]:text-muted-foreground [&_ul]:my-2">
                                {renderMarkdownBlocks(formatDecisionReasoning(decision.reasoning))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {completeResult.reasoning && (
                  <div className="mt-4 p-4 bg-muted/20 border border-muted rounded-lg shadow-sm">
                    <h3 className="text-sm font-semibold mb-2 text-primary">{language === 'ko' ? '종합 분석 보고서' : 'Synthesized Analysis Report'}</h3>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {completeResult.reasoning}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    <div
      id="detail-report-view"
      style={{ display: selectedDetailReport ? 'block' : 'none' }}
      className="h-full w-full overflow-y-auto bg-background text-foreground"
    >
      {selectedDetailReport && (
        <div className="min-h-full">
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:px-6">
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-9 w-fit max-w-full justify-start whitespace-normal rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-primary sm:justify-self-start"
                onClick={closeDetailReport}
              >
                ⬅️ 요약으로 돌아가기 <span className="ml-1 text-xs">(Back)</span>
              </Button>
              <h2 className="max-w-full text-center text-base font-semibold leading-relaxed text-primary sm:col-start-2">
                {selectedDetailReport.agentName}의 사업보고서 원문 대조 가이드
              </h2>
              <div aria-hidden="true" className="hidden sm:block" />
            </div>
          </header>

          <main className="mx-auto max-w-4xl px-6 py-8">
            <article className="rounded-md border border-border/70 bg-muted/10 p-7 text-sm leading-relaxed text-zinc-300 shadow-sm sm:p-9">
              {renderMarkdownBlocks(selectedDetailReport.markdown)}
            </article>
          </main>
        </div>
      )}
    </div>
    </>
  );
}

function AnalysisDisplay({ analysis, language }: { analysis: any; agentKey?: string; language: any }) {
  if (!analysis) return null;

  // Try to render structured analysis data
  if (typeof analysis === 'string') {
    return (
      <div className="text-sm leading-relaxed text-foreground [&_h2]:mb-2 [&_h2]:mt-1 [&_h2]:text-sm [&_h3]:mb-2 [&_h3]:mt-1 [&_h3]:text-sm [&_li]:text-muted-foreground [&_ol]:my-2 [&_p]:my-2 [&_p]:text-muted-foreground [&_ul]:my-2">
        {renderMarkdownBlocks(formatDecisionReasoning(analysis))}
      </div>
    );
  }

  if (typeof analysis === 'object') {
    return (
      <div className="space-y-2 text-sm">
        {Object.entries(analysis).map(([key, value]) => (
          <div key={key}>
            <span className="font-medium text-primary capitalize">
              {t(key as any, language) !== key ? t(key as any, language) : key.replace(/_/g, ' ')}: 
            </span>
            {renderValue(value, language)}
          </div>
        ))}
      </div>
    );
  }

  return <pre className="text-xs overflow-auto">{JSON.stringify(analysis, null, 2)}</pre>;
}

function AgentReportSummary({ analysis, language }: { analysis: any; language: 'ko' | 'en' }) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return null;
  }

  const entries = Object.entries(analysis)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([ticker, value]) => {
      const report = value as Record<string, any>;
      return {
        ticker,
        signal: report.signal,
        confidence: formatConfidence(report.confidence),
        reasoning: report.reasoning || report.details || report.explanation,
      };
    });

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        {language === 'ko' ? '에이전트 점수 요약' : 'Agent Score Summary'}
      </div>
      <div className="grid gap-2">
        {entries.map((entry) => (
          <div key={entry.ticker} className="rounded-md border border-border bg-background/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary">{entry.ticker}</span>
              <Badge variant="outline" className={getSignalClass(entry.signal)}>
                {getSignalLabel(entry.signal, language)}
              </Badge>
              {entry.confidence && (
                <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-500">
                  {language === 'ko' ? '점수' : 'Score'} {entry.confidence}
                </Badge>
              )}
            </div>
            {entry.reasoning && (
              <div className="mt-2 text-xs leading-relaxed text-muted-foreground [&_h2]:mb-2 [&_h2]:mt-1 [&_h2]:text-sm [&_h3]:mb-2 [&_h3]:mt-1 [&_h3]:text-sm [&_li]:text-muted-foreground [&_ol]:my-2 [&_p]:my-2 [&_p]:text-muted-foreground [&_ul]:my-2">
                {renderMarkdownBlocks(formatDecisionReasoning(entry.reasoning))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderValue(value: any, language: any): ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-500' : 'text-red-500'}>
      {value ? (language === 'ko' ? '예' : 'Yes') : (language === 'ko' ? '아니오' : 'No')}
    </span>;
  }
  if (typeof value === 'number') return <span className="text-blue-500 font-mono">{value}</span>;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'bullish' || lower === 'buy') return <span className="text-green-500 font-medium">{language === 'ko' ? '강세' : value}</span>;
    if (lower === 'bearish' || lower === 'sell') return <span className="text-red-500 font-medium">{language === 'ko' ? '약세' : value}</span>;
    if (lower === 'neutral' || lower === 'hold') return <span className="text-yellow-500 font-medium">{language === 'ko' ? '중립' : value}</span>;
    return <span className="text-foreground">{value}</span>;
  }
  if (typeof value === 'object') {
    return (
      <div className="ml-3 space-y-1 mt-1">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground capitalize">
              {t(k as any, language) !== k ? t(k as any, language) : k.replace(/_/g, ' ')}: 
            </span>
            {renderValue(v, language)}
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}
