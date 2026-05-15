import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ui/llm-selector';
import { resolveTickerValue, TickerInput, type TickerInputValidationStatus } from '@/components/ui/ticker-input';
import { useLanguage } from '@/contexts/language-context';
import { useWorkspace, type Workspace } from '@/contexts/workspace-context';
import { Agent, getAgents } from '@/data/agents';
import { getDefaultModel, getModels, LanguageModel } from '@/data/models';
import {
  DATA_SANDBOX_OVERRIDES_EVENT,
  DATA_SANDBOX_OVERRIDES_STORAGE_KEY,
  countSandboxOverrideFields,
  getSandboxOverrideForTicker,
  loadDataSandboxOverrideSnapshot,
} from '@/lib/data-sandbox-overrides';
import { useToastManager } from '@/hooks/use-toast-manager';
import { t } from '@/lib/language-preferences';
import {
  ensureParagraphBreaks,
  formatDecisionReasoning,
  normalizeCrossCheckGuideHeading,
  renderMarkdownBlocks,
} from '@/lib/markdown-blocks';
// Phase 2 moved markdown rendering out of this tab. Legacy static markers:
// parseSentimentMarker renderInlineMarkdown renderTonedContent TONE_STYLES ToneLegend
// sortReportSentimentLines(markdown) normalizeReportOrderedMarkers(sortReportSentimentLines(markdown)).
import { savedAnalysisService } from '@/services/saved-analyses-service';
import { stockAnalysisRunService, StockAnalysisRunStatus } from '@/services/stock-analysis-run-service';
import {
  ReportSentimentDashboard,
  ReportToneLegend,
} from '@/components/reports/report-sentiment-dashboard';
import { AnalystReportDashboard } from '@/components/reports/analyst-report-dashboard';
import { Bot, ChevronDown, ChevronUp, Database, Loader2, PanelLeftClose, PanelLeftOpen, Play, Search, Square } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AgentFormulaTooltip, extractBaseAgentKey } from '@/components/ui/agent-formula-tooltip';

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
  agentResults: AgentResult[];
  completeResult: CompleteResult | null;
  analysisGeneratedAt: string | null;
  expandedAgentKeys: string[];
  selectedDetailReport: DetailReportState | null;
  errorMessage: string | null;
}

interface StockSearchTabProps {
  isTabActive?: boolean;
  tabId?: string;
}

interface SavedStockAnalysisInputState {
  tickers?: string | string[];
  input_ticker?: string;
  startDate?: string;
  endDate?: string;
  start_date?: string;
  end_date?: string;
  selectedModel?: LanguageModel | null;
  selected_model?: LanguageModel | null;
  selectedAgentKeys?: string[];
  selected_agent_keys?: string[];
  useDataSandboxOverrides?: boolean;
  use_data_sandbox_overrides?: boolean;
}

function serializeStockAnalysisState(state: {
  agentResults: Map<string, AgentResult>;
  completeResult: CompleteResult | null;
  analysisGeneratedAt: string | null;
  expandedAgents: Set<string>;
  selectedDetailReport: DetailReportState | null;
  errorMessage: string | null;
}): StockAnalysisSavedState {
  return {
    agentResults: Array.from(state.agentResults.values()),
    completeResult: state.completeResult,
    analysisGeneratedAt: state.analysisGeneratedAt,
    expandedAgentKeys: Array.from(state.expandedAgents),
    selectedDetailReport: state.selectedDetailReport,
    errorMessage: state.errorMessage,
  };
}

function restoreStockAnalysisState(
  savedState: Record<string, any> | null | undefined,
) {
  const state = (savedState || {}) as Partial<StockAnalysisSavedState>;

  return {
    agentResults: new Map((state.agentResults || []).map(result => [result.agentKey, result])),
    completeResult: state.completeResult || null,
    analysisGeneratedAt: state.analysisGeneratedAt || null,
    expandedAgents: new Set(state.expandedAgentKeys || []),
    selectedDetailReport: state.selectedDetailReport || null,
    errorMessage: state.errorMessage || null,
  };
}

function resolveRestoredModel(
  savedModel: LanguageModel | null | undefined,
  availableModels: LanguageModel[],
  defaultModel: LanguageModel | null,
  fallbackModel: LanguageModel | null,
) {
  if (!savedModel) {
    return defaultModel ?? fallbackModel;
  }

  return availableModels.find(model =>
    model.model_name === savedModel.model_name &&
    model.provider === savedModel.provider,
  ) || savedModel;
}

function restoreWorkspaceFromSavedInput(
  savedInput: SavedStockAnalysisInputState | null | undefined,
  availableAgents: Agent[],
  availableModels: LanguageModel[],
  defaultModel: LanguageModel | null,
  fallbackWorkspace: Workspace,
): Partial<Workspace> {
  const state = (savedInput || {}) as SavedStockAnalysisInputState;
  const availableAgentKeys = new Set(availableAgents.map(agent => agent.key));
  const rawTickers = Array.isArray(state.tickers)
    ? state.tickers.join(', ')
    : typeof state.tickers === 'string'
      ? state.tickers
      : typeof state.input_ticker === 'string'
        ? state.input_ticker
        : fallbackWorkspace.tickers;
  const selectedAgentKeys = (
    Array.isArray(state.selected_agent_keys)
      ? state.selected_agent_keys
      : Array.isArray(state.selectedAgentKeys)
        ? state.selectedAgentKeys
        : Array.from(fallbackWorkspace.selectedAgents)
  ).filter(key => availableAgentKeys.has(key));

  return {
    tickers: rawTickers,
    startDate:
      (typeof state.start_date === 'string' ? state.start_date : state.startDate) || fallbackWorkspace.startDate,
    endDate:
      (typeof state.end_date === 'string' ? state.end_date : state.endDate) || fallbackWorkspace.endDate,
    selectedModel: resolveRestoredModel(
      state.selected_model ?? state.selectedModel,
      availableModels,
      defaultModel,
      fallbackWorkspace.selectedModel,
    ),
    selectedAgents: new Set(selectedAgentKeys),
    useDataSandboxOverrides:
      typeof state.use_data_sandbox_overrides === 'boolean'
        ? state.use_data_sandbox_overrides
        : typeof state.useDataSandboxOverrides === 'boolean'
          ? state.useDataSandboxOverrides
          : fallbackWorkspace.useDataSandboxOverrides,
  };
}

function hasWorkspaceInput(workspace: Workspace) {
  return Boolean(
    workspace.tickers.trim() ||
    workspace.selectedAgents.size > 0 ||
    workspace.useDataSandboxOverrides,
  );
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

export function isKoreanStock(ticker: string) {
  const trimmed = ticker.trim();
  // 한글 기업명 또는 숫자로 시작하는 KS/KQ 티커
  if (/[\uAC00-\uD7A3]/.test(trimmed)) return true;
  const normalized = normalizeTicker(trimmed);
  return /^[0-9][0-9A-Z._-]*$/.test(normalized);
}

export function isJapaneseStock(ticker: string) {
  const t = (ticker || '').trim().toUpperCase();
  const code = t.split('.')[0];
  // .T 접미사 또는 TSE 4자리 숫자 코드 (한국 6자리와 구분)
  return t.endsWith('.T') || /^\d{4}$/.test(code);
}

export function getKoreanStockCode(ticker: string) {
  const trimmed = ticker.trim();
  // 한글 기업명이면 숫자 코드 추출을 위해 resolveTickerValue로 먼저 변환
  if (/[\uAC00-\uD7A3]/.test(trimmed)) {
    const resolved = resolveTickerValue(trimmed);
    return resolved.match(/\d+/)?.[0] || trimmed;
  }
  const normalized = normalizeTicker(trimmed);
  return normalized.match(/\d+/)?.[0] || normalized;
}

export function getResearchLinks(ticker: string) {
  const normalized = normalizeTicker(ticker);

  // 일본 종목 먼저 확인 (4자리 코드가 isKoreanStock 수 패턴에도 걸리므로 우선 처리)
  if (isJapaneseStock(normalized)) {
    const code = normalized.split('.')[0];
    return [
      {
        label: 'EDINET 유가증권보고서',
        href: `https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx`,
      },
      {
        label: 'Yahoo Finance Japan',
        href: `https://finance.yahoo.co.jp/quote/${encodeURIComponent(code)}.T`,
      },
    ];
  }

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

export function getTickerAnalystReports(analystSignals: Record<string, any> | undefined, ticker: string) {
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



export function scoreSignal(signal: unknown, confidence: unknown) {
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

export function scoreDecision(decision: any) {
  const action = String(decision?.action || 'hold').toLowerCase();
  const confidence = normalizeConfidence(decision?.confidence) ?? 50;

  if (action === 'buy' || action === 'cover') return 50 + confidence / 2;
  if (action === 'sell' || action === 'short') return 50 - confidence / 2;
  return 50;
}

export function calculateCompositeScore(
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

export function extractCrossCheckGuide(value: unknown): string | null {
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

export function buildFallbackCrossCheckGuide(result: AgentResult) {
  const entries = getAnalysisReportEntries(result.analysis);
  const primary = entries[0];
  const ticker = primary?.ticker || result.ticker || normalizeTicker('');
  const report = primary?.report || {};
  const metrics = getGuideMetricSnippets(report);
  const targetData = metrics.length > 0
    ? metrics.join(', ')
    : '전처리 데이터에서 제공된 신호, 신뢰도, 핵심 재무/시장 지표(N/A 포함)';
  const sourceSections = ticker && isJapaneseStock(ticker)
    ? 'EDINET 유가증권보고서(사업 현황, 재무 현황, 업적 개요, 리스크 섹션)를 우선 확인하십시오.'
    : ticker && isKoreanStock(ticker)
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

export function StockSearchTab({ isTabActive = true }: StockSearchTabProps) {
  const { language } = useLanguage();
  const { workspace, setTickers, setDateRange, setSelectedModel, toggleAgent, setSelectedAgents, setUseDataSandboxOverrides, patchWorkspace } = useWorkspace();
  const {
    tickers,
    startDate,
    endDate,
    selectedModel,
    selectedAgents,
    useDataSandboxOverrides,
  } = workspace;
  const { success, error } = useToastManager();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<LanguageModel[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [agentResults, setAgentResults] = useState<Map<string, AgentResult>>(new Map());
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null);
  const [analysisGeneratedAt, setAnalysisGeneratedAt] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [selectedDetailReport, setSelectedDetailReport] = useState<DetailReportState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingAnalysis, setIsSavingAnalysis] = useState(false);
  const [sandboxOverrideSnapshot, setSandboxOverrideSnapshot] = useState(() => loadDataSandboxOverrideSnapshot());
  const [isConfigPanelCollapsed, setIsConfigPanelCollapsed] = useState(false);
  const [tickerValidationStatus, setTickerValidationStatus] = useState<TickerInputValidationStatus>('empty');
  const [validatedTicker, setValidatedTicker] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const savedRunIdRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPersistedPayloadRef = useRef<string>('');
  const [hasRestoredSavedRun, setHasRestoredSavedRun] = useState(false);
  const initialWorkspaceRef = useRef(workspace);

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
        let restoredWorkspaceInputs = false;
        try {
          const latestRun = await stockAnalysisRunService.getLatestRun();
          if (latestRun) {
            savedRunIdRef.current = latestRun.id;
            if (!hasWorkspaceInput(initialWorkspaceRef.current)) {
              restoredWorkspaceInputs = true;
              patchWorkspace(
                restoreWorkspaceFromSavedInput(
                  latestRun.request_data || latestRun.ui_state,
                  agentList,
                  modelList,
                  defaultModel,
                  initialWorkspaceRef.current,
                ),
              );
            }
          }

          if (latestRun?.ui_state) {
            const restoredState = restoreStockAnalysisState(latestRun.ui_state);
            setAgentResults(restoredState.agentResults);
            setCompleteResult(restoredState.completeResult);
            setAnalysisGeneratedAt(
              restoredState.analysisGeneratedAt
              || latestRun.result_data?.analysis_generated_at
              || latestRun.created_at
              || null,
            );
            setExpandedAgents(restoredState.expandedAgents);
            setSelectedDetailReport(restoredState.selectedDetailReport);
            setErrorMessage(restoredState.errorMessage);
            restored = true;
          }
        } catch (restoreError) {
          console.warn('Failed to restore latest Stock Analysis run', restoreError);
        }

        if (!restored && !restoredWorkspaceInputs && !initialWorkspaceRef.current.selectedModel) {
          setSelectedModel(defaultModel);
        }
      } catch (err) {
        console.error('Failed to load agents/models', err);
      } finally {
        setHasRestoredSavedRun(true);
      }
    };
    load();
  }, []);

  const currentTicker = useMemo(() => {
    const rawTicker = tickers.split(',')[0]?.trim();
    return rawTicker ? resolveTickerValue(rawTicker).toUpperCase() : '';
  }, [tickers]);

  const sandboxOverrideForTicker = useMemo(() => (
    currentTicker ? getSandboxOverrideForTicker(sandboxOverrideSnapshot, currentTicker) : null
  ), [currentTicker, sandboxOverrideSnapshot]);

  const sandboxOverrideFieldCount = countSandboxOverrideFields(sandboxOverrideForTicker);

  const handleTickerValidationChange = useCallback((status: TickerInputValidationStatus, resolvedTicker?: string) => {
    setTickerValidationStatus(status);
    setValidatedTicker(status === 'valid' && resolvedTicker ? resolvedTicker : '');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const refreshSandboxOverrides = () => {
      setSandboxOverrideSnapshot(loadDataSandboxOverrideSnapshot());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === DATA_SANDBOX_OVERRIDES_STORAGE_KEY || event.key === null) {
        refreshSandboxOverrides();
      }
    };

    window.addEventListener(DATA_SANDBOX_OVERRIDES_EVENT, refreshSandboxOverrides);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', refreshSandboxOverrides);

    return () => {
      window.removeEventListener(DATA_SANDBOX_OVERRIDES_EVENT, refreshSandboxOverrides);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', refreshSandboxOverrides);
    };
  }, []);

  useEffect(() => {
    if (useDataSandboxOverrides && !sandboxOverrideForTicker) {
      setUseDataSandboxOverrides(false);
    }
  }, [sandboxOverrideForTicker, useDataSandboxOverrides]);

  const persistCurrentRun = useCallback(async () => {
    if (!hasRestoredSavedRun) return;

    const uiState = serializeStockAnalysisState({
      agentResults,
      completeResult,
      analysisGeneratedAt,
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
        use_data_sandbox_overrides: useDataSandboxOverrides,
      },
      result_data: {
        completeResult,
        agentResults: uiState.agentResults,
        analysis_generated_at: analysisGeneratedAt,
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
    analysisGeneratedAt,
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
    useDataSandboxOverrides,
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
    analysisGeneratedAt,
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
    useDataSandboxOverrides,
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
    toggleAgent(key);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
  };

  const handleRun = async () => {
    if (!tickers.trim() || selectedAgents.size === 0) return;
    if (tickerValidationStatus !== 'valid') {
      setErrorMessage(
        language === 'ko'
          ? '존재하는 종목을 자동완성에서 선택하거나 정확한 티커를 입력해 주세요.'
          : 'Choose an existing stock from autocomplete or enter an exact ticker.'
      );
      return;
    }

    // Use only the first ticker for single ticker analysis
    // 한국 기업명이 입력된 경우 티커 코드로 변환
    const rawTicker = tickers.split(',')[0].trim();
    const singleTicker = (validatedTicker || resolveTickerValue(rawTicker)).toUpperCase();
    if (!singleTicker) return;

    setTickers(rawTicker);
    setIsConfigPanelCollapsed(true);

    const latestSandboxSnapshot = loadDataSandboxOverrideSnapshot() || sandboxOverrideSnapshot;
    const sandboxMetricOverrides = useDataSandboxOverrides
      ? getSandboxOverrideForTicker(latestSandboxSnapshot, singleTicker)
      : null;

    if (latestSandboxSnapshot !== sandboxOverrideSnapshot) {
      setSandboxOverrideSnapshot(latestSandboxSnapshot);
    }

    if (useDataSandboxOverrides && !sandboxMetricOverrides) {
      setErrorMessage(t('dataSandboxOverridesUnavailable', language));
      return;
    }

    setIsRunning(true);
    setErrorMessage(null);
    setCompleteResult(null);
    setAnalysisGeneratedAt(null);
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

    const body: Record<string, any> = {
      tickers: tickerList,
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      agent_models: agentModels,
      start_date: startDate,
      end_date: endDate,
      language: language,
    };
    if (sandboxMetricOverrides) {
      body.metric_overrides = { [singleTicker]: sandboxMetricOverrides };
    }

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
              const completedAt = new Date().toISOString();
              setCompleteResult(completeData);
              setAnalysisGeneratedAt(completedAt);
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

  const handleSaveAnalysis = async () => {
    if (isSavingAnalysis) return;

    const agentResultList = Array.from(agentResults.values());
    const savedTicker =
      currentTicker
      || Object.keys(completeResult?.decisions || {})[0]
      || agentResultList.find(result => result.ticker)?.ticker
      || '';

    if (!savedTicker || (agentResultList.length === 0 && !completeResult)) return;

    setIsSavingAnalysis(true);

    try {
      await savedAnalysisService.saveAnalysis(
        'stock_analysis',
        savedTicker,
        language,
        {
          input_ticker: tickers,
          ticker: savedTicker,
          start_date: startDate,
          end_date: endDate,
          selected_model: selectedModel,
          selected_agent_keys: Array.from(selectedAgents),
          use_data_sandbox_overrides: useDataSandboxOverrides,
          sandbox_override: useDataSandboxOverrides ? sandboxOverrideForTicker : null,
        },
        {
          agent_results: agentResultList,
          complete_result: completeResult,
          analysis_generated_at: analysisGeneratedAt,
        },
      );

      success(t('savedToDbSuccess', language), 'stock-analysis-save-to-db');
    } catch (saveError) {
      console.error('Failed to save Stock Analysis result', saveError);
      error(t('savedToDbError', language), 'stock-analysis-save-to-db-error');
    } finally {
      setIsSavingAnalysis(false);
    }
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

  const canRun = tickerValidationStatus === 'valid' && selectedAgents.size > 0 && !isRunning;
  const agentResultList = Array.from(agentResults.values());
  const hasSavableResults = !isRunning && (agentResultList.length > 0 || !!completeResult);

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
        <div className={`${isConfigPanelCollapsed ? 'w-14 p-2' : 'w-72 p-4'} flex-shrink-0 space-y-4 overflow-y-auto border-r transition-all duration-200`}>
          <div className={`flex items-center ${isConfigPanelCollapsed ? 'justify-center' : 'justify-between gap-2'}`}>
            {!isConfigPanelCollapsed && (
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {language === 'ko' ? '분석 설정' : 'Analysis setup'}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0"
              aria-label={isConfigPanelCollapsed
                ? (language === 'ko' ? '분석 설정 패널 펼치기' : 'Expand analysis setup panel')
                : (language === 'ko' ? '분석 설정 패널 접기' : 'Collapse analysis setup panel')}
              onClick={() => setIsConfigPanelCollapsed(prev => !prev)}
            >
              {isConfigPanelCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          </div>

          {isConfigPanelCollapsed ? (
            <div className="flex flex-col items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-2 py-3 text-muted-foreground">
              <Search className="h-4 w-4" />
              {currentTicker && (
                <span className="font-mono text-[10px] font-semibold [writing-mode:vertical-rl]">
                  {currentTicker}
                </span>
              )}
            </div>
          ) : (
          <>
          {/* Tickers */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('tickers', language)}</label>
            <TickerInput
              placeholder={language === 'ko' ? '단일 종목 입력 (예: AAPL)' : 'Enter single ticker (e.g. AAPL)'}
              value={tickers}
              isActive={isTabActive}
              onChange={val => {
                 setTickers(val);
              }}
              onValidationChange={handleTickerValidationChange}
              onKeyDown={e => { if (e.key === 'Enter' && canRun) handleRun(); }}
            />
            <p className="text-xs text-muted-foreground">
              {language === 'ko' ? '단일 종목만 검색 및 분석이 가능합니다.' : 'Only a single ticker can be analyzed at a time.'}
            </p>
            {tickers.trim() && tickerValidationStatus !== 'valid' && (
              <p className={`text-xs ${tickerValidationStatus === 'invalid' ? 'text-red-500' : 'text-muted-foreground'}`}>
                {tickerValidationStatus === 'checking'
                  ? (language === 'ko' ? '종목 존재 여부 확인 중...' : 'Checking ticker...')
                  : (language === 'ko'
                      ? '자동완성 결과에 있는 실제 종목만 분석할 수 있습니다.'
                      : 'Only stocks found in autocomplete can be analyzed.')}
              </p>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs">{t('startDate', language)}</label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setDateRange(e.target.value, endDate)}
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs">{t('endDate', language)}</label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setDateRange(startDate, e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Data Sandbox Overrides */}
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="use-data-sandbox-overrides"
                checked={useDataSandboxOverrides && Boolean(sandboxOverrideForTicker)}
                disabled={!sandboxOverrideForTicker || isRunning}
                onCheckedChange={checked => setUseDataSandboxOverrides(checked === true)}
                className="mt-0.5"
              />
              <div className="min-w-0 space-y-1">
                <label
                  htmlFor="use-data-sandbox-overrides"
                  className={`text-sm font-medium ${sandboxOverrideForTicker && !isRunning ? 'cursor-pointer' : 'text-muted-foreground'}`}
                >
                  {t('useDataSandboxOverrides', language)}
                </label>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {sandboxOverrideForTicker
                    ? t('dataSandboxOverridesAvailable', language)
                        .replace('{ticker}', currentTicker)
                        .replace('{count}', String(sandboxOverrideFieldCount))
                    : t('dataSandboxOverridesUnavailable', language)}
                </p>
              </div>
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
          </>
          )}
        </div>

        {/* Right: Results */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {language === 'ko' ? '분석 결과' : 'Analysis Results'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {language === 'ko'
                  ? '현재 결과를 데이터베이스에 별도로 저장할 수 있습니다.'
                  : 'You can explicitly save the current results to the database.'}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveAnalysis}
              disabled={!hasSavableResults || isSavingAnalysis}
            >
              {isSavingAnalysis ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('saveToDbButton', language)}</>
              ) : (
                <><Database className="mr-2 h-4 w-4" />{t('saveToDbButton', language)}</>
              )}
            </Button>
          </div>

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

          {completeResult && completeResult.decisions && (
            <ResearchQuickLinks
              tickers={Object.keys(completeResult.decisions)}
              language={language}
            />
          )}

          {/* Final Decision */}
          {completeResult && completeResult.decisions && (() => {
            const firstTicker = Object.keys(completeResult.decisions)[0];
            if (!firstTicker) return null;
            const score = calculateCompositeScore(
              completeResult.analyst_signals,
              firstTicker,
              completeResult.decisions[firstTicker],
            );
            return (
              <AnalystReportDashboard
                ticker={firstTicker}
                completeResult={completeResult}
                agentResults={agentResults}
                language={language}
                compositeScore={score}
                analysisGeneratedAt={analysisGeneratedAt}
                onSave={handleSaveAnalysis}
                isSaving={isSavingAnalysis}
              />
            );
          })()}

          {/* Agent cards */}
          {agentResultList.map(result => {
            const isExpanded = expandedAgents.has(result.agentKey);
            return (
              <Card key={result.agentKey} className="overflow-hidden">
                <CardHeader
                  className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => result.analysis && toggleExpand(result.agentKey)}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Bot size={16} className={statusColor(result.status)} />
                    <div className="min-w-[140px] flex-1 inline-flex items-center gap-2">
                      <CardTitle className="text-sm font-medium">{result.agentName}</CardTitle>
                      <AgentFormulaTooltip agentKey={result.agentKey} language={language} />
                    </div>
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

          {/* Synthesized reasoning (if available) */}
          {completeResult?.reasoning && (
            <div className="rounded-lg border border-border/60 bg-muted/10 p-4">
              <h3 className="mb-2 text-sm font-semibold text-primary">
                {language === 'ko' ? '종합 분석 보고서' : 'Synthesized Analysis Report'}
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {completeResult.reasoning}
              </p>
            </div>
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
              {renderMarkdownBlocks(ensureParagraphBreaks(selectedDetailReport.markdown))}
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
        {renderMarkdownBlocks(ensureParagraphBreaks(formatDecisionReasoning(analysis)))}
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
        companyName: report.company_name || report.companyName || null,
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
              <span className="font-mono text-xs font-semibold text-primary">
                {entry.companyName ? (
                  <>{entry.companyName} <span className="font-normal text-muted-foreground">({entry.ticker})</span></>
                ) : (
                  entry.ticker
                )}
              </span>
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
                <ReportSentimentDashboard
                  markdown={formatDecisionReasoning(entry.reasoning)}
                  language={language}
                  className="mb-3"
                />
                <ReportToneLegend language={language} />
                {renderMarkdownBlocks(ensureParagraphBreaks(formatDecisionReasoning(entry.reasoning)))}
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
