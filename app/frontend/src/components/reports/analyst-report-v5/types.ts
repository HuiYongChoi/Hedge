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
  forwardEpsTtm?: CanonicalMetric;
  intrinsicValue?: CanonicalMetric;
  marginOfSafety?: CanonicalMetric;
  interestCoverage?: CanonicalMetric;
  beta?: CanonicalMetric;
  wacc?: CanonicalMetric;
  forwardPeFy0?: CanonicalMetric;
  forwardPe?: CanonicalMetric;
  currentPrice?: CanonicalMetric;
}

export interface CompleteResult {
  decisions?: Record<string, any>;
  analyst_signals?: Record<string, any>;
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
  onSave?: () => void;
  isSaving?: boolean;
}
