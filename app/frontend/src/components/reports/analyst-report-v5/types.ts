export type ReportLanguage = 'ko' | 'en';

export type ReportTone = 'bullish' | 'bearish' | 'neutral';

export type CitationConfidence = 'high' | 'medium' | 'low';

export type SectionId =
  | 'section-01'
  | 'section-02'
  | 'section-03'
  | 'section-04'
  | 'section-05'
  | 'section-06';

export interface SectionDef {
  id: SectionId;
  number: string;
  titleKo: string;
  titleEn: string;
}

export interface Citation {
  letter: string;
  label: string;
  type: string;
  labelKo: string;
  labelEn: string;
  typeKo: string;
  typeEn: string;
  href: string | null;
  hrefAvailable: boolean;
}

export interface CitationInference {
  letter: string;
  confidence: CitationConfidence;
  matchedKeyword: string;
}

export interface EvidenceItem {
  id: string;
  rawText: string;
  heading: string | null;
  body: string;
  tone: ReportTone;
  citationLetters: string[];
}

export interface KeyNumber {
  label: string;
  value: string;
}

export interface TargetTile {
  labelKey: string;
  sublabelKey: string;
  value: string;
  tone: ReportTone;
  sourceAgent?: { key: string; nameKo: string; nameEn: string };
  isFromActiveAgent: boolean;
}

export interface OtherAgent {
  key: string;
  displayNameKo: string;
  displayNameEn: string;
  tone: ReportTone;
  score: number;
  confidence: number | null;
}

export interface AgentReport {
  signal?: string;
  confidence?: number | string;
  reasoning?: unknown;
  data_coverage?: number | null;
  raw_max_score?: number | null;
  [key: string]: any;
}

export interface NormalizedReport {
  conclusion: string;
  valuationDcf: string;
  multiples: string;
  risks: string;
  crossCheck: string;
  sources: string;
}

export interface SentenceClassification {
  sentence: string;
  section: SectionId;
  confidence: CitationConfidence;
  matchedKeywords: string[];
}

export interface CanonicalMetric {
  value: number;
  sourceAgentKey: string;
  sourceAgentNameKo: string;
  sourceAgentNameEn: string;
  isFromActiveAgent: boolean;
}

export interface CanonicalMetrics {
  forwardEpsFy0?: CanonicalMetric;
  forwardEpsFy1?: CanonicalMetric;      // ▣ FY+N EPS
  forwardEpsTtm?: CanonicalMetric;
  intrinsicValue?: CanonicalMetric;
  marginOfSafety?: CanonicalMetric;
  interestCoverage?: CanonicalMetric;
  beta?: CanonicalMetric;
  wacc?: CanonicalMetric;
  forwardPeFy0?: CanonicalMetric;
  forwardPeFy1?: CanonicalMetric;       // ▣ FY+N PER
  forwardPe?: CanonicalMetric;
  currentPrice?: CanonicalMetric;
  fy0FiscalYear?: number | null;        // 예: 2026
  fy1FiscalYear?: number | null;        // 예: 2027
}

export interface CanonicalForwardSnapshot {
  ttmPer: number | null;
  currentFyPer: number | null;
  fwdPer: number | null;
  fwdEps: number | null;
  currentFyEps: number | null;
}

export interface RimBreakdown {
  bookValue: number;
  bookValuePerShare: number | null;
  roeImplied: number;
  costOfEquity: number;
  spreadRoeKe: number;
  bookValueGrowth: number;
  presentValueRi: number;
  terminalPvRi: number;
  intrinsicTotal: number;
  intrinsicPerShare: number | null;
  weightUsed: number;
  signal: 'bullish' | 'neutral' | 'bearish';
  details: string;
}

export interface PbrBand {
  currentPbr: number;
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  history: Array<{ period: string; pbr: number }>;
  bvps: number | null;
  fairPriceP10: number | null;
  fairPriceP25: number | null;
  fairPriceP50: number | null;
  fairPriceP75: number | null;
  fairPriceP90: number | null;
  currentPrice: number | null;
  positionLabel: 'below_p25' | 'p25_p50' | 'p50_p75' | 'above_p75';
  reratingNote: string | null;
  weightUsed: number;
  signal: 'bullish' | 'neutral' | 'bearish';
  details: string;
}

export interface ValuationModel {
  key: 'dcf' | 'owner_earnings' | 'ev_ebitda' | 'residual_income' | 'pbr_band';
  labelKey: string;
  intrinsicPerShare: number | null;
  intrinsicTotal: number | null;
  weight: number;
  signal: 'bullish' | 'neutral' | 'bearish';
  gapToMarket: number | null;
  medianMultiple?: number | null;
  currentMultiple?: number | null;
  ebitdaNow?: number | null;
  netDebt?: number | null;
}

export interface JustifiedPbrBreakdown {
  signal: 'bullish' | 'neutral' | 'bearish';
  gapToMarket: number | null;
  targetPrice: number | null;
  justifiedPbr: number | null;
  roeUsed: number | null;
  roeSource: 'forward_eps_implied' | 'trailing_avg' | null;
  roeWindow: string;
  costOfEquity: number | null;
  growthG: number | null;
  bvpsNow: number | null;
  bvpsForward: number | null;
  epsGrowth1y: number | null;
  details: string;
}

export interface ValuationDeepDive {
  regime: 'capex_heavy' | 'default';
  regimeNote: string | null;
  rim: RimBreakdown | null;
  pbr: PbrBand | null;
  justifiedPbr: JustifiedPbrBreakdown | null;
  models: ValuationModel[];
}

export interface CompleteResult {
  decisions?: Record<string, any>;
  analyst_signals?: Record<string, any>;
  current_prices?: Record<string, number>;
  reasoning?: string;
}

export interface AgentResult {
  agentKey: string;
  agentName: string;
  status: string;
  ticker?: string;
  analysis?: any;
  report?: Record<string, any>;
  timestamp?: string;
}

export interface AgentMeta {
  key: string;
  name: string;
  categoryKo: string;
  categoryEn: string;
  status?: string;
}

export interface AnalystReportDashboardProps {
  ticker: string;
  completeResult: CompleteResult;
  agentResults: Map<string, AgentResult>;
  language: ReportLanguage;
  compositeScore: number;
  analysisGeneratedAt?: string | null;
  onSave?: () => void;
  isSaving?: boolean;
}
