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

  return language === 'ko'
    ? `${reports.length}개 에이전트 기준 강세 ${bullishCount}개, 약세 ${bearishCount}개, 중립 ${neutralCount}개입니다. 종합 판단은 ${band.label}이며, 판단 상태와 핵심 근거를 중심으로 해석하세요.`
    : `${reports.length} agents show ${bullishCount} bullish, ${bearishCount} bearish, and ${neutralCount} neutral views. The combined decision is ${band.label}; interpret it by the decision status and core rationale.`;
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

interface AgentFormulaGuide {
  title: string;
  summary: string;
  formulas: string[];
  thresholds: string[];
}

const AGENT_FORMULA_GUIDES: Record<string, { ko: AgentFormulaGuide; en: AgentFormulaGuide }> = {
  warren_buffett: {
    ko: {
      title: '워런 버핏 정량 공식',
      summary: '우량 사업, 보수적 재무구조, Owner Earnings(소유자 이익) 기반 내재가치와 Margin Of Safety(안전마진)를 함께 봅니다.',
      formulas: [
        'Owner Earnings(소유자 이익) = Net Income(순이익) + Depreciation And Amortization(감가상각비) - Maintenance CapEx(유지보수 자본지출) - Working Capital Change(운전자본 변동)',
        'Margin Of Safety(안전마진) = (Intrinsic Value(내재가치) - Market Cap(시가총액)) / Market Cap(시가총액)',
        'Debt-To-Equity(부채비율), Current Ratio(유동비율), ROE(자기자본이익률), Operating Margin(영업이익률)은 TTM 또는 Report Period(보고기간) 라벨과 함께 해석합니다.',
      ],
      thresholds: ['ROE 15% 이상 가점', 'Debt-To-Equity 0.50x 미만 가점', 'Current Ratio 1.50x 초과 가점', 'Margin Of Safety 양수일 때 강세 근거 강화'],
    },
    en: {
      title: 'Warren Buffett Quant Formula',
      summary: 'Combines business quality, conservative leverage, Owner Earnings intrinsic value, and Margin Of Safety.',
      formulas: [
        'Owner Earnings = Net Income + Depreciation And Amortization - Maintenance CapEx - Working Capital Change',
        'Margin Of Safety = (Intrinsic Value - Market Cap) / Market Cap',
        'Debt-To-Equity, Current Ratio, ROE, and Operating Margin are interpreted with TTM or Report Period labels.',
      ],
      thresholds: ['ROE above 15% adds points', 'Debt-To-Equity below 0.50x adds points', 'Current Ratio above 1.50x adds points', 'Positive Margin Of Safety strengthens bullish evidence'],
    },
  },
  ben_graham: {
    ko: {
      title: '벤 그레이엄 정량 공식',
      summary: 'Graham Number(그레이엄 넘버), NCAV(순유동자산가치), Current Ratio(유동비율), Debt-To-Equity(부채비율)로 보수적 안전마진을 확인합니다.',
      formulas: [
        'Graham Number(그레이엄 넘버) = sqrt(22.5 x EPS(주당순이익) x Book Value Per Share(주당순자산))',
        'Margin Of Safety(안전마진) = (Graham Number(그레이엄 넘버) - Current Price(현재가)) / Current Price(현재가)',
        'NCAV(순유동자산가치) = Current Assets(유동자산) - Total Liabilities(총부채)',
      ],
      thresholds: ['Current Ratio 2.00x 이상 선호', 'Debt-To-Equity 0.50x 이하 가점', 'Graham Number 대비 20~50% 할인 시 가점', 'NCAV가 시가총액보다 높으면 강한 딥밸류 신호'],
    },
    en: {
      title: 'Ben Graham Quant Formula',
      summary: 'Checks conservative Margin Of Safety through Graham Number, NCAV, Current Ratio, and Debt-To-Equity.',
      formulas: [
        'Graham Number = sqrt(22.5 x EPS x Book Value Per Share)',
        'Margin Of Safety = (Graham Number - Current Price) / Current Price',
        'NCAV = Current Assets - Total Liabilities',
      ],
      thresholds: ['Current Ratio of 2.00x or higher is preferred', 'Debt-To-Equity at or below 0.50x adds points', '20-50% discount to Graham Number adds points', 'NCAV above Market Cap is a strong deep-value signal'],
    },
  },
  charlie_munger: {
    ko: {
      title: '찰리 멍거 정량 공식',
      summary: 'ROIC(투하자본수익률), FCF Conversion(현금전환율), Moat(경쟁우위), 합리적 가격의 조합을 봅니다.',
      formulas: ['FCF Conversion(현금전환율) = Free Cash Flow(잉여현금흐름) / Net Income(순이익)', 'Fair Value Gap(적정가치 괴리율) = (Reasonable Value(합리가치) - Market Cap(시가총액)) / Market Cap(시가총액)'],
      thresholds: ['ROIC 15% 이상 반복 시 품질 가점', 'FCF가 순이익을 잘 따라오면 품질 가점', '적정가치 대비 30% 이상 할인 시 강세'],
    },
    en: {
      title: 'Charlie Munger Quant Formula',
      summary: 'Focuses on ROIC, FCF Conversion, Moat durability, and a fair price.',
      formulas: ['FCF Conversion = Free Cash Flow / Net Income', 'Fair Value Gap = (Reasonable Value - Market Cap) / Market Cap'],
      thresholds: ['Repeated ROIC above 15% adds quality points', 'FCF tracking Net Income adds quality points', '30%+ discount to fair value is bullish'],
    },
  },
  aswath_damodaran: {
    ko: {
      title: '다모다란 정량 공식',
      summary: 'FCFF(기업잉여현금흐름), WACC(가중평균자본비용), ROIC(투하자본수익률), 재투자율로 내재가치를 추정합니다.',
      formulas: ['Intrinsic Value(내재가치) = FCFF(기업잉여현금흐름) DCF + Terminal Value(영구가치)', 'Margin Of Safety(안전마진) = (Intrinsic Value(내재가치) - Market Cap(시가총액)) / Market Cap(시가총액)'],
      thresholds: ['안전마진 +25% 이상 강세', '안전마진 -25% 이하 약세', 'ROIC가 WACC를 초과하면 품질 근거 강화'],
    },
    en: {
      title: 'Damodaran Quant Formula',
      summary: 'Values the company through FCFF, WACC, ROIC, and reinvestment assumptions.',
      formulas: ['Intrinsic Value = FCFF DCF + Terminal Value', 'Margin Of Safety = (Intrinsic Value - Market Cap) / Market Cap'],
      thresholds: ['Margin Of Safety above +25% is bullish', 'Margin Of Safety below -25% is bearish', 'ROIC above WACC strengthens quality evidence'],
    },
  },
  cathie_wood: {
    ko: {
      title: '캐시 우드 정량 공식',
      summary: 'Revenue Growth(매출 성장률), R&D Intensity(R&D 집약도), Gross Margin(매출총이익률), 장기 DCF를 중시합니다.',
      formulas: ['R&D Intensity(R&D 집약도) = R&D Expense(R&D 비용) / Revenue(매출)', 'Innovation DCF(혁신 DCF) = 고성장 가정 현금흐름 현재가치'],
      thresholds: ['매출 성장률 20% 이상 가점', 'R&D와 마진이 함께 개선되면 혁신 품질 가점', '안전마진 20~50% 이상이면 강세 강화'],
    },
    en: {
      title: 'Cathie Wood Quant Formula',
      summary: 'Emphasizes Revenue Growth, R&D Intensity, Gross Margin, and long-horizon DCF.',
      formulas: ['R&D Intensity = R&D Expense / Revenue', 'Innovation DCF = Present Value of high-growth cash flows'],
      thresholds: ['Revenue growth above 20% adds points', 'R&D with improving margins supports innovation quality', '20-50%+ Margin Of Safety strengthens bullish evidence'],
    },
  },
  peter_lynch: {
    ko: { title: '피터 린치 정량 공식', summary: 'PEG Ratio(PEG 비율), EPS Growth(EPS 성장률), P/E(PER), 부채 부담으로 합리적 성장주를 찾습니다.', formulas: ['PEG Ratio(PEG 비율) = P/E(PER) / EPS Growth(EPS 성장률)', 'Growth Score(성장 점수) = 매출 성장 + EPS 성장 + PEG 매력도'], thresholds: ['PEG 1.00 미만 강한 가점', 'EPS 성장률 20% 이상 가점', 'D/E가 낮고 FCF가 양수면 품질 보강'] },
    en: { title: 'Peter Lynch Quant Formula', summary: 'Looks for reasonably priced growth through PEG Ratio, EPS Growth, P/E, and leverage.', formulas: ['PEG Ratio = P/E / EPS Growth', 'Growth Score = Sales Growth + EPS Growth + PEG Attractiveness'], thresholds: ['PEG below 1.00 is strongly positive', 'EPS growth above 20% adds points', 'Low D/E and positive FCF strengthen quality'] },
  },
  phil_fisher: {
    ko: { title: '필 피셔 정량 공식', summary: 'Sales Growth(매출 성장), R&D Intensity(R&D 집약도), Margin Stability(마진 안정성), ROE로 장기 품질을 봅니다.', formulas: ['R&D Intensity(R&D 집약도) = R&D Expense(R&D 비용) / Revenue(매출)', 'Margin Stability(마진 안정성) = 기간별 영업이익률 변동성'], thresholds: ['매출/EPS CAGR 20% 이상 강한 가점', '영업마진 하락이 작으면 품질 가점', 'ROE 20% 이상이면 우수 품질'] },
    en: { title: 'Phil Fisher Quant Formula', summary: 'Scores long-term quality with Sales Growth, R&D Intensity, Margin Stability, and ROE.', formulas: ['R&D Intensity = R&D Expense / Revenue', 'Margin Stability = Volatility of Operating Margin across periods'], thresholds: ['Sales/EPS CAGR above 20% is strongly positive', 'Stable operating margin adds quality points', 'ROE above 20% signals high quality'] },
  },
  bill_ackman: {
    ko: { title: '빌 애크먼 정량 공식', summary: 'Quality(사업 품질), Financial Discipline(재무 규율), Activism Potential(행동주의 가능성), DCF 안전마진을 봅니다.', formulas: ['Margin Of Safety(안전마진) = (Intrinsic Value(내재가치) - Market Cap(시가총액)) / Market Cap(시가총액)', 'Financial Discipline(재무 규율) = Debt-To-Equity(부채비율) + FCF + 배당/자사주'], thresholds: ['안전마진 30% 이상 강세', 'D/E 1.00x 미만 기간이 많으면 가점', 'FCF와 마진이 안정적이면 품질 가점'] },
    en: { title: 'Bill Ackman Quant Formula', summary: 'Combines Business Quality, Financial Discipline, Activism Potential, and DCF Margin Of Safety.', formulas: ['Margin Of Safety = (Intrinsic Value - Market Cap) / Market Cap', 'Financial Discipline = Debt-To-Equity + FCF + Dividends/Buybacks'], thresholds: ['Margin Of Safety above 30% is bullish', 'Most periods below 1.00x D/E add points', 'Stable FCF and margins support quality'] },
  },
  michael_burry: {
    ko: { title: '마이클 버리 정량 공식', summary: 'FCF Yield(FCF 수익률), EV/EBITDA, Short Interest(공매도 비중), 재무 리스크로 역발상 기회를 찾습니다.', formulas: ['FCF Yield(FCF 수익률) = Free Cash Flow(잉여현금흐름) / Market Cap(시가총액)', 'EV/EBITDA = Enterprise Value(기업가치) / EBITDA'], thresholds: ['FCF Yield 10% 이상 강한 가점', '낮은 EV/EBITDA와 낮은 D/E는 가치 근거', '과도한 레버리지와 취약한 유동성은 약세'] },
    en: { title: 'Michael Burry Quant Formula', summary: 'Looks for contrarian value through FCF Yield, EV/EBITDA, Short Interest, and balance-sheet risk.', formulas: ['FCF Yield = Free Cash Flow / Market Cap', 'EV/EBITDA = Enterprise Value / EBITDA'], thresholds: ['FCF Yield above 10% is strongly positive', 'Low EV/EBITDA with low D/E supports value', 'High leverage or weak liquidity is bearish'] },
  },
  mohnish_pabrai: {
    ko: { title: '모니시 파브라이 정량 공식', summary: 'Dhandho(단도) 방식으로 Downside Risk(하방위험), FCF Yield(FCF 수익률), 안전마진을 중시합니다.', formulas: ['Downside Protection(하방 보호) = Balance Sheet Strength(재무건전성) + FCF Durability(FCF 지속성)', 'Margin Of Safety(안전마진) = Intrinsic Value(내재가치) 대비 할인율'], thresholds: ['10점 만점 7.5점 이상 Buy 성향', '4.0점 이하 Sell 성향', '유동비율과 낮은 부채가 하방 보호'] },
    en: { title: 'Mohnish Pabrai Quant Formula', summary: 'Dhandho-style scoring emphasizes Downside Risk, FCF Yield, and Margin Of Safety.', formulas: ['Downside Protection = Balance Sheet Strength + FCF Durability', 'Margin Of Safety = Discount to Intrinsic Value'], thresholds: ['7.5/10 or higher leans Buy', '4.0/10 or below leans Sell', 'Liquidity and low leverage protect downside'] },
  },
  nassim_taleb: {
    ko: { title: '나심 탈레브 정량 공식', summary: 'Fragility(취약성), Tail Risk(꼬리위험), Convexity(볼록성), Antifragility(반취약성)를 점수화합니다.', formulas: ['Fragility(취약성) = Leverage(레버리지) + Cash Burn(현금소모) + Earnings Volatility(이익 변동성)', 'Convexity(볼록성) = 제한된 하방 + 큰 상방 가능성'], thresholds: ['50점 척도로 반취약성 우위 평가', 'D/E가 높고 현금흐름이 약하면 취약', '현금 보유와 낮은 부채는 강한 방어력'] },
    en: { title: 'Nassim Taleb Quant Formula', summary: 'Scores Fragility, Tail Risk, Convexity, and Antifragility.', formulas: ['Fragility = Leverage + Cash Burn + Earnings Volatility', 'Convexity = Limited Downside + Large Upside Potential'], thresholds: ['Uses a 50-point antifragility scale', 'High D/E and weak cash flow are fragile', 'Cash and low debt improve resilience'] },
  },
  rakesh_jhunjhunwala: {
    ko: { title: '라케시 준준왈라 정량 공식', summary: 'Revenue CAGR(매출 CAGR), Net Income CAGR(순이익 CAGR), FCF, 내재가치 괴리로 성장+가치를 평가합니다.', formulas: ['CAGR(연평균성장률) = (Latest(최신값) / Oldest(과거값))^(1/N) - 1', 'Margin Of Safety(안전마진) = (Intrinsic Value(내재가치) - Market Cap(시가총액)) / Market Cap(시가총액)'], thresholds: ['24점 척도 기반', '안전마진 30% 이상 강세', '성장성과 유동성이 함께 양호하면 가점'] },
    en: { title: 'Rakesh Jhunjhunwala Quant Formula', summary: 'Combines Revenue CAGR, Net Income CAGR, FCF, and intrinsic value gap.', formulas: ['CAGR = (Latest / Oldest)^(1/N) - 1', 'Margin Of Safety = (Intrinsic Value - Market Cap) / Market Cap'], thresholds: ['Uses a 24-point scale', '30%+ Margin Of Safety is bullish', 'Growth plus liquidity strengthens the case'] },
  },
  stanley_druckenmiller: {
    ko: { title: '스탠리 드러켄밀러 정량 공식', summary: 'Growth/Momentum(성장/모멘텀), Risk Reward(위험보상), Macro Context(거시 맥락)를 결합합니다.', formulas: ['Weighted Score(가중 점수) = Growth/Momentum 35% + Risk Reward + Macro/Trend Evidence', 'Risk Reward(위험보상) = Upside Potential(상방) / Downside Risk(하방)'], thresholds: ['성장/모멘텀 비중 35%', '강한 가격 모멘텀과 이익 성장 동반 시 가점', '손실 위험이 크면 신뢰도 하향'] },
    en: { title: 'Stanley Druckenmiller Quant Formula', summary: 'Combines Growth/Momentum, Risk Reward, and Macro Context.', formulas: ['Weighted Score = Growth/Momentum 35% + Risk Reward + Macro/Trend Evidence', 'Risk Reward = Upside Potential / Downside Risk'], thresholds: ['Growth/Momentum weight is 35%', 'Price momentum plus earnings growth adds points', 'Large downside risk lowers confidence'] },
  },
  technical_analyst: {
    ko: { title: '기술적 분석가 정량 공식', summary: 'Trend(추세), Momentum(모멘텀), Mean Reversion(평균회귀), Volatility(변동성)를 가중 결합합니다.', formulas: ['Weighted Signal(가중 신호) = Trend 25% + Momentum 25% + Mean Reversion + Volatility', 'RSI, MACD, ADX, 이동평균 교차를 함께 사용합니다.'], thresholds: ['가중 신호 +0.2 초과 강세', '-0.2 미만 약세', '추세/모멘텀 각 25% 비중'] },
    en: { title: 'Technical Analyst Quant Formula', summary: 'Combines Trend, Momentum, Mean Reversion, and Volatility.', formulas: ['Weighted Signal = Trend 25% + Momentum 25% + Mean Reversion + Volatility', 'Uses RSI, MACD, ADX, and moving-average crosses.'], thresholds: ['Weighted signal above +0.2 is bullish', 'Below -0.2 is bearish', 'Trend and Momentum each carry 25% weight'] },
  },
  fundamentals_analyst: {
    ko: { title: '기본적 분석가 정량 공식', summary: 'Profitability(수익성), Growth(성장성), Financial Health(재무건전성), Valuation(밸류에이션)을 종합합니다.', formulas: ['Financial Health(재무건전성) = Current Ratio(유동비율) + Debt-To-Equity(부채비율)', 'Valuation(밸류에이션) = P/E + P/B + P/S'], thresholds: ['ROE 15% 이상 가점', 'Current Ratio 1.50x 초과 가점', 'P/E 25 초과는 고평가 경고'] },
    en: { title: 'Fundamentals Analyst Quant Formula', summary: 'Scores Profitability, Growth, Financial Health, and Valuation.', formulas: ['Financial Health = Current Ratio + Debt-To-Equity', 'Valuation = P/E + P/B + P/S'], thresholds: ['ROE above 15% adds points', 'Current Ratio above 1.50x adds points', 'P/E above 25 is an overvaluation warning'] },
  },
  growth_analyst: {
    ko: { title: '성장 분석가 정량 공식', summary: 'Growth(성장) 40%, Quality(품질), Valuation(밸류에이션), Risk(위험)를 가중합니다.', formulas: ['Weighted Growth Score(가중 성장 점수) = Growth 40% + Quality 25% + Valuation 20% + Risk 15%', 'Growth(성장) = Revenue Growth(매출 성장) + EPS Growth(EPS 성장)'], thresholds: ['가중 점수 0.60 이상 강세', '성장 항목 40% 비중', '높은 부채와 낮은 유동성은 위험 감점'] },
    en: { title: 'Growth Analyst Quant Formula', summary: 'Weights Growth 40%, Quality, Valuation, and Risk.', formulas: ['Weighted Growth Score = Growth 40% + Quality 25% + Valuation 20% + Risk 15%', 'Growth = Revenue Growth + EPS Growth'], thresholds: ['Weighted score above 0.60 is bullish', 'Growth carries 40% weight', 'High debt and weak liquidity reduce risk score'] },
  },
  news_sentiment_analyst: {
    ko: { title: '뉴스 감성 분석가 정량 공식', summary: 'LLM Sentiment(LLM 감성) 70%와 기사 비율 30%를 결합합니다.', formulas: ['News Score(뉴스 점수) = LLM Confidence 70% + Positive/Negative Ratio 30%', 'Sentiment Ratio(감성 비율) = Positive News(긍정 기사) / Total News(전체 기사)'], thresholds: ['LLM 판단 70% 비중', '긍정 기사 비율이 높으면 강세', '기사 수가 적으면 신뢰도 보수 조정'] },
    en: { title: 'News Sentiment Analyst Quant Formula', summary: 'Combines LLM Sentiment 70% with article-ratio evidence 30%.', formulas: ['News Score = LLM Confidence 70% + Positive/Negative Ratio 30%', 'Sentiment Ratio = Positive News / Total News'], thresholds: ['LLM judgment carries 70% weight', 'Higher positive-news ratio is bullish', 'Low article count lowers confidence'] },
  },
  sentiment_analyst: {
    ko: { title: '시장 심리 분석가 정량 공식', summary: 'News Sentiment(뉴스 감성) 70%와 Insider Trades(내부자 거래) 30%를 결합합니다.', formulas: ['Sentiment Score(심리 점수) = News Sentiment 70% + Insider Trades 30%', 'Insider Signal(내부자 신호) = Net Insider Buying(내부자 순매수) - Net Insider Selling(내부자 순매도)'], thresholds: ['뉴스 70%, 내부자 30% 비중', '내부자 순매수는 강세', '내부자 순매도와 부정 뉴스는 약세'] },
    en: { title: 'Sentiment Analyst Quant Formula', summary: 'Combines News Sentiment 70% with Insider Trades 30%.', formulas: ['Sentiment Score = News Sentiment 70% + Insider Trades 30%', 'Insider Signal = Net Insider Buying - Net Insider Selling'], thresholds: ['News carries 70%; insiders carry 30%', 'Net insider buying is bullish', 'Insider selling plus negative news is bearish'] },
  },
  valuation_analyst: {
    ko: { title: '가치평가 분석가 정량 공식', summary: 'DCF, Owner Earnings(소유자 이익), EV/EBITDA, Residual Income(잔여이익)을 가중 평균합니다.', formulas: ['Blended Intrinsic Value(혼합 내재가치) = DCF 35% + Owner Earnings 35% + EV/EBITDA 20% + Residual Income 10%', 'Weighted Gap(가중 괴리율) = (Blended Value(혼합가치) - Market Cap(시가총액)) / Market Cap(시가총액)'], thresholds: ['가중 괴리율 +15% 초과 강세', '-15% 미만 약세', 'DCF와 Owner Earnings가 각각 35% 비중'] },
    en: { title: 'Valuation Analyst Quant Formula', summary: 'Blends DCF, Owner Earnings, EV/EBITDA, and Residual Income.', formulas: ['Blended Intrinsic Value = DCF 35% + Owner Earnings 35% + EV/EBITDA 20% + Residual Income 10%', 'Weighted Gap = (Blended Value - Market Cap) / Market Cap'], thresholds: ['Weighted gap above +15% is bullish', 'Below -15% is bearish', 'DCF and Owner Earnings each carry 35% weight'] },
  },
  default: {
    ko: {
      title: '에이전트 정량 공식',
      summary: '각 에이전트는 자신의 철학에 맞는 성장성, 수익성, 재무건전성, 밸류에이션 지표를 점수화합니다.',
      formulas: ['Composite Signal(종합 신호) = Agent Signal(에이전트 신호) + Confidence(신뢰도) + 정량 근거', 'Financial Ratios(재무비율)는 0.20x처럼 소수점과 단위를 보존합니다.'],
      thresholds: ['에이전트 원점수는 서로 다르며 최종 UI에서 0~100점으로 정규화됩니다.', 'N/A 수치는 임의 생성하지 않고 대체 지표와 원문 대조로 보완합니다.'],
    },
    en: {
      title: 'Agent Quant Formula',
      summary: 'Each agent scores growth, profitability, financial strength, and valuation according to its investment philosophy.',
      formulas: ['Composite Signal = Agent Signal + Confidence + Quant Evidence', 'Financial Ratios preserve decimals and x-units, such as 0.20x.'],
      thresholds: ['Raw agent scores differ and are normalized to 0-100 in the final UI.', 'N/A values are not invented; proxy metrics and source checks fill the context.'],
    },
  },
};

const AGENT_FORMULA_ALIASES: Record<string, keyof typeof AGENT_FORMULA_GUIDES> = {
  warren_buffett: 'warren_buffett',
  ben_graham: 'ben_graham',
  charlie_munger: 'charlie_munger',
  aswath_damodaran: 'aswath_damodaran',
  cathie_wood: 'cathie_wood',
  peter_lynch: 'peter_lynch',
  phil_fisher: 'phil_fisher',
  bill_ackman: 'bill_ackman',
  michael_burry: 'michael_burry',
  mohnish_pabrai: 'mohnish_pabrai',
  nassim_taleb: 'nassim_taleb',
  rakesh_jhunjhunwala: 'rakesh_jhunjhunwala',
  stanley_druckenmiller: 'stanley_druckenmiller',
  technical_analyst: 'technical_analyst',
  fundamentals_analyst: 'fundamentals_analyst',
  growth_analyst: 'growth_analyst',
  news_sentiment_analyst: 'news_sentiment_analyst',
  sentiment_analyst: 'sentiment_analyst',
  valuation_analyst: 'valuation_analyst',
};

function getAgentFormulaGuide(agentKey: string, language: 'ko' | 'en') {
  const baseKey = extractBaseAgentKey(agentKey);
  const guideKey = AGENT_FORMULA_ALIASES[baseKey] || 'default';
  return AGENT_FORMULA_GUIDES[guideKey][language];
}

function AgentFormulaTooltip({ agentKey, language }: { agentKey: string; language: 'ko' | 'en' }) {
  const guide = getAgentFormulaGuide(agentKey, language);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={language === 'ko' ? '에이전트 정량 공식 보기' : 'View agent quant formula'}
            onClick={(event) => event.stopPropagation()}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-md space-y-3 text-xs leading-relaxed">
          <div>
            <div className="font-semibold text-foreground">{guide.title}</div>
            <p className="mt-1 text-muted-foreground">{guide.summary}</p>
          </div>
          <div className="space-y-1">
            {guide.formulas.map((formula) => (
              <div key={formula}>{formula}</div>
            ))}
          </div>
          <div className="space-y-1 border-t border-border/70 pt-2">
            {guide.thresholds.map((threshold) => (
              <div key={threshold}>{threshold}</div>
            ))}
          </div>
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
                      language,
                    );

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
