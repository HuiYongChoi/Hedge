import type {
  AgentMeta,
  AgentReport,
  AgentResult,
  CanonicalMetric,
  CanonicalMetrics,
  Citation,
  CitationConfidence,
  CitationInference,
  CompleteResult,
  EvidenceItem,
  KeyNumber,
  NormalizedReport,
  OtherAgent,
  ReportLanguage,
  ReportTone,
  SectionDef,
  SectionId,
  SentenceClassification,
  TargetTile,
} from './types';
import { normalizeFinancialDisplayText } from '@/lib/financial-text-normalizer';

export function isInsufficient(score: number | null | undefined): boolean {
  return score === null || score === undefined;
}

export function formatScoreOrDash(score: number | null | undefined): string {
  if (isInsufficient(score)) return '—';
  return String(score);
}

export function dataCoverageLabel(coverage: number | null | undefined, language: 'ko' | 'en'): string {
  if (coverage === null || coverage === undefined) return '';
  const pct = Math.round(coverage * 100);
  return language === 'ko'
    ? `데이터 충실도 ${pct}%`
    : `Data coverage ${pct}%`;
}

export const SECTION_DEFS: SectionDef[] = [
  { id: 'section-01', number: '01', titleKo: '결론 요약', titleEn: 'Conclusion' },
  { id: 'section-02', number: '02', titleKo: '밸류에이션 — DCF', titleEn: 'Valuation — DCF' },
  { id: 'section-03', number: '03', titleKo: '멀티플 — 이익 정상화 가설', titleEn: 'Multiples — Earnings Normalisation' },
  { id: 'section-04', number: '04', titleKo: '리스크와 반대 근거', titleEn: 'Risks & Counterthesis' },
  { id: 'section-05', number: '05', titleKo: '크로스체크 가이드', titleEn: 'Cross-check Guide' },
  { id: 'section-06', number: '06', titleKo: '원문 추적 · 출처', titleEn: 'Source Tracking · Citations' },
];

export const AGENT_META: Record<string, { categoryKo: string; categoryEn: string; nameKo?: string; nameEn?: string }> = {
  aswath_damodaran: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '애스워스 다모다란', nameEn: 'Aswath Damodaran' },
  ben_graham: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '벤저민 그레이엄', nameEn: 'Ben Graham' },
  charlie_munger: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '찰리 멍거', nameEn: 'Charlie Munger' },
  mohnish_pabrai: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '모니시 파브라이', nameEn: 'Mohnish Pabrai' },
  peter_lynch: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '피터 린치', nameEn: 'Peter Lynch' },
  phil_fisher: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '필 피셔', nameEn: 'Phil Fisher' },
  warren_buffett: { categoryKo: '가치 투자', categoryEn: 'Value Investing', nameKo: '워런 버핏', nameEn: 'Warren Buffett' },
  cathie_wood: { categoryKo: '성장 투자', categoryEn: 'Growth Investing', nameKo: '캐시 우드', nameEn: 'Cathie Wood' },
  rakesh_jhunjhunwala: { categoryKo: '성장 투자', categoryEn: 'Growth Investing', nameKo: '라케시 준준왈라', nameEn: 'Rakesh Jhunjhunwala' },
  bill_ackman: { categoryKo: '거시 및 행동주의', categoryEn: 'Macro & Activist', nameKo: '빌 애크먼', nameEn: 'Bill Ackman' },
  michael_burry: { categoryKo: '거시 및 행동주의', categoryEn: 'Macro & Activist', nameKo: '마이클 버리', nameEn: 'Michael Burry' },
  nassim_taleb: { categoryKo: '거시 및 행동주의', categoryEn: 'Macro & Activist', nameKo: '나심 탈레브', nameEn: 'Nassim Taleb' },
  stanley_druckenmiller: { categoryKo: '거시 및 행동주의', categoryEn: 'Macro & Activist', nameKo: '스탠리 드러켄밀러', nameEn: 'Stanley Druckenmiller' },
  fundamentals_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '펀더멘털', nameEn: 'Fundamentals' },
  growth_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '성장성', nameEn: 'Growth Analyst' },
  news_sentiment_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '뉴스 심리', nameEn: 'News Sentiment' },
  sentiment_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '시장 심리', nameEn: 'Sentiment' },
  technical_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '기술 분석', nameEn: 'Technical' },
  valuation_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '밸류에이션', nameEn: 'Valuation' },
};

const KOREAN_TICKER_DISPLAY_NAMES: Record<string, string> = {
  '000660.KS': 'SK하이닉스',
  '005930.KS': '삼성전자',
  '035420.KS': 'NAVER',
  '035720.KS': '카카오',
  '005380.KS': '현대자동차',
  '000270.KS': '기아',
  '373220.KS': 'LG에너지솔루션',
  '247540.KQ': '에코프로비엠',
};

const DATA_TOKEN_PATTERN = /(\$\d[\d,]*(?:\.\d+)?[BMK]?|\d[\d,]*(?:\.\d+)?\s?(?:%|배|x|X|B|M|K)|-\d[\d,]*(?:\.\d+)?%)/g;

const LABEL_CANDIDATES: Array<{ pattern: RegExp; ko: string; en: string }> = [
  { pattern: /ROIC|투하자본/i, ko: 'ROIC', en: 'ROIC' },
  { pattern: /FCF\s*수익률|free cash flow yield|fcf yield/i, ko: 'FCF 수익률', en: 'FCF yield' },
  { pattern: /부채비율|debt-to-equity|D\/E/i, ko: '부채비율', en: 'Debt-to-equity' },
  { pattern: /내재가치|intrinsic value|fair value/i, ko: '1주당 내재가치', en: 'Intrinsic value' },
  { pattern: /현재가|current price|price/i, ko: '현재가', en: 'Current price' },
  { pattern: /안전마진|margin of safety/i, ko: '안전마진', en: 'Margin of safety' },
  { pattern: /wacc|discount rate|할인율/i, ko: 'WACC', en: 'WACC' },
  { pattern: /forward.*eps|전망.*eps|컨센.*eps|다음.*eps/i, ko: '다음분기 EPS', en: 'Forward EPS' },
  { pattern: /ttm.*eps|trailing.*eps/i, ko: 'TTM EPS', en: 'TTM EPS' },
  { pattern: /forward.*p\/?e|포워드.*p\/?e|forward per/i, ko: '포워드 P/E', en: 'Forward P/E' },
  { pattern: /trailing.*p\/?e|트레일링.*p\/?e/i, ko: '트레일링 P/E', en: 'Trailing P/E' },
  { pattern: /성장률|growth rate|growth/i, ko: '성장률', en: 'Growth' },
  { pattern: /이자보상|interest coverage/i, ko: '이자보상배율', en: 'Interest coverage' },
  { pattern: /베타|beta/i, ko: '베타', en: 'Beta' },
  { pattern: /시가총액|market cap/i, ko: '시가총액', en: 'Market cap' },
  { pattern: /매출|revenue/i, ko: '매출', en: 'Revenue' },
  { pattern: /영업이익|operating income/i, ko: '영업이익', en: 'Operating income' },
];

const SENTENCE_RULES: Array<{
  section: SectionId;
  high: string[];
  medium: string[];
}> = [
  {
    section: 'section-02',
    high: ['DCF', 'FCFF', '내재가치', 'intrinsic', 'WACC', 'discount cash flow', 'terminal value'],
    medium: ['valuation', 'fair value', '할인'],
  },
  {
    section: 'section-03',
    high: ['P/E', 'forward EPS', 'trailing', '포워드 멀티플', 'multiples'],
    medium: ['EPS', '이익', 'consensus'],
  },
  {
    section: 'section-04',
    high: ['risk', '약세', 'bear', '손실', '취약', 'downside', 'tail risk', 'bear thesis'],
    medium: ['위험', '반대 의견', '우려'],
  },
  {
    section: 'section-05',
    high: ['cross-check', '크로스체크', '원문 대조', 'MD&A', 'transcript'],
    medium: ['verify', '검증'],
  },
];

export const CITATION_RULES: Array<{
  letter: string;
  highRegex: RegExp;
  mediumRegex: RegExp;
}> = [
  {
    letter: 'a',
    highRegex: /\b10-K\b|\b10-Q\b|MD&A|사업보고서|annual report|연간보고서|有価証券報告書|有報|四半期報告書|securities report/i,
    mediumRegex: /DCF|FCFF|내재가치|intrinsic|discounted|운전자본|capex/i,
  },
  {
    letter: 'b',
    highRegex: /earnings call|어닝콜|transcript|conference call/i,
    mediumRegex: /경영진|guidance|가이던스|management commentary/i,
  },
  {
    letter: 'c',
    highRegex: /consensus EPS|컨센서스 EPS|analyst estimate/i,
    mediumRegex: /EPS|컨센|예측|forecast|estimate/i,
  },
  {
    letter: 'd',
    highRegex: /Damodaran|stern\.nyu/i,
    mediumRegex: /WACC|discount rate|beta|β|자본비용|cost of capital/i,
  },
  {
    letter: 'e',
    highRegex: /TrendForce|Gartner|IDC|Statista/i,
    mediumRegex: /시장 규모|TAM|섹터|점유율|market share|industry/i,
  },
];

export function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

export function stripSuffix(key: string): string {
  const parts = key.split('_');
  const last = parts[parts.length - 1];
  const withoutRuntimeSuffix = parts.length > 1 && /^[a-z0-9]{6}$/i.test(last)
    ? parts.slice(0, -1).join('_')
    : key;
  return withoutRuntimeSuffix.replace(/_agent$/, '');
}

function isNarrativeAgentKey(key: string) {
  const baseKey = stripSuffix(key);
  return baseKey !== 'risk_management'
    && baseKey !== 'portfolio_manager'
    && baseKey !== 'forward_prefetch';
}

export function isJapaneseTicker(ticker: string) {
  const t = ticker.trim().toUpperCase();
  const code = t.split('.')[0];
  // .T \uC811\uBBF8\uC0AC\uC774\uAC70\uB098, 4\uC790\uB9AC \uC22B\uC790 \uCF54\uB4DC, \uB610\uB294 \uC601\uC22B\uC790 \uD63C\uD569 \uCF54\uB4DC(\uC608: 285A)
  if (t.endsWith('.T')) return true;
  if (/^\d{4}$/.test(code)) return true;
  // \uC601\uBB38\uC774 \uC11E\uC778 4\uC790 \uCF54\uB4DC (TSE \uC2E0\uADDC \uC601\uC22B\uC790 \uCF54\uB4DC) \u2014 \uD55C\uAD6D 6\uC790\uB9AC \uCF54\uB4DC\uC640 \uAD6C\uBD84
  if (/^\d{1,3}[A-Z]$/.test(code) || /^[A-Z]\d{1,3}$/.test(code) || /^\d{1,3}[A-Z]\d?$/.test(code)) return true;
  return false;
}

export function isKoreanTicker(ticker: string) {
  const trimmed = ticker.trim();
  if (/[\uAC00-\uD7A3]/.test(trimmed)) return true;
  // \uC77C\uBCF8 \uD2F0\uCEE4(.T, TSE 4\uC790\uB9AC, \uC601\uC22B\uC790 \uCF54\uB4DC)\uB294 \uD55C\uAD6D\uC73C\uB85C \uBD84\uB958\uD558\uC9C0 \uC54A\uB294\uB2E4.
  if (isJapaneseTicker(trimmed)) return false;
  return /^[0-9][0-9A-Z._-]*$/.test(normalizeTicker(trimmed));
}

export function getKoreanCode(ticker: string) {
  return ticker.trim().match(/\d+/)?.[0] || ticker.trim();
}

function cleanCompanyDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/\s*\(주\)\s*/g, '')
    .replace(/\s*주식회사\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || null;
}

export function getDisplayTickerLabel(ticker: string, report?: AgentReport | null) {
  const normalized = normalizeTicker(ticker);
  const mapped = KOREAN_TICKER_DISPLAY_NAMES[normalized];
  if (mapped) return mapped;

  const companyName = cleanCompanyDisplayName(
    report?.company_name || report?.companyName || report?.company || report?.name,
  );
  return companyName || ticker;
}

export function displayAgentName(agentKey: string, fallback?: string, language: ReportLanguage = 'ko') {
  const baseKey = stripSuffix(agentKey);
  const meta = AGENT_META[baseKey];
  if (language === 'ko') return meta?.nameKo || fallback || humanizeAgentKey(baseKey);
  return meta?.nameEn || fallback || humanizeAgentKey(baseKey);
}

export function getAgentMeta(agentKey: string, result?: AgentResult): AgentMeta {
  const baseKey = stripSuffix(agentKey);
  const meta = AGENT_META[baseKey];
  return {
    key: baseKey,
    name: displayAgentName(baseKey, result?.agentName, 'ko'),
    categoryKo: meta?.categoryKo || '종목 분석',
    categoryEn: meta?.categoryEn || 'Stock Analysis',
    status: result?.status,
  };
}

export function humanizeAgentKey(agentKey: string) {
  return stripSuffix(agentKey)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function normalizeConfidence(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function getSignalTone(signal: unknown): ReportTone {
  const raw = String(signal || '').toLowerCase();
  if (['bullish', 'buy', 'long', 'positive', 'cover'].includes(raw)) return 'bullish';
  if (['bearish', 'sell', 'short', 'negative', 'reduce'].includes(raw)) return 'bearish';
  return 'neutral';
}

export function scoreSignal(signal: unknown, confidence: unknown) {
  const tone = getSignalTone(signal);
  const conf = normalizeConfidence(confidence) ?? 50;
  if (tone === 'bullish') return 50 + conf / 2;
  if (tone === 'bearish') return 50 - conf / 2;
  return 50;
}

export function signalToVerdict(signal: string, language: ReportLanguage): string {
  const tone = getSignalTone(signal);
  if (tone === 'bullish') return language === 'ko' ? '↑매수·강세' : '↑Buy · Bull';
  if (tone === 'bearish') return language === 'ko' ? '↓매도·약세' : '↓Sell · Bear';
  return language === 'ko' ? '→보유·중립' : '→Hold · Neutral';
}

export function getScoreBand(score: number, language: ReportLanguage) {
  if (score >= 80) return { label: language === 'ko' ? '강력 매수' : 'Strong Buy', tone: 'bullish' as ReportTone };
  if (score >= 60) return { label: language === 'ko' ? '매수' : 'Buy', tone: 'bullish' as ReportTone };
  if (score >= 40) return { label: language === 'ko' ? '관망' : 'Watch', tone: 'neutral' as ReportTone };
  if (score >= 20) return { label: language === 'ko' ? '비중 축소' : 'Reduce', tone: 'bearish' as ReportTone };
  return { label: language === 'ko' ? '강력 매도' : 'Strong Sell', tone: 'bearish' as ReportTone };
}

export function toneToClasses(tone: ReportTone): { border: string; bg: string; text: string; badge: string } {
  if (tone === 'bullish') {
    return {
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-600 dark:text-emerald-400',
      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    };
  }
  if (tone === 'bearish') {
    return {
      border: 'border-red-500/30',
      bg: 'bg-red-500/10',
      text: 'text-red-600 dark:text-red-400',
      badge: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
    };
  }
  return {
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-600 dark:text-yellow-400',
    badge: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  };
}

export function extractReasoningText(reasoning: unknown): string {
  if (!reasoning) return '';
  if (typeof reasoning === 'string') return reasoning;
  if (Array.isArray(reasoning)) return reasoning.map(extractReasoningText).filter(Boolean).join('\n\n');
  if (typeof reasoning === 'object') {
    const record = reasoning as Record<string, any>;
    const fields = ['reasoning', 'summary', 'analysis', 'details', 'explanation', 'detail_report', 'cross_check_guide'];
    const chunks = fields.map(field => extractReasoningText(record[field])).filter(Boolean);
    if (chunks.length > 0) return chunks.join('\n\n');

    const primitiveLines: string[] = [];
    for (const [key, value] of Object.entries(record)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'string' && value.trim()) {
        primitiveLines.push(`- ${key.replace(/_/g, ' ')}: ${value}`);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        primitiveLines.push(`- ${key.replace(/_/g, ' ')}: ${value}`);
      }
    }
    if (primitiveLines.length > 0) return primitiveLines.join('\n');
  }
  return '';
}

function isLikelyAgentReport(value: unknown): value is AgentReport {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return 'reasoning' in record
    || 'signal' in record
    || 'confidence' in record
    || 'structured_view' in record
    || 'sections' in record;
}

function pickTickerReport(value: unknown, ticker: string): AgentReport | null {
  if (!value || typeof value !== 'object') return null;
  if (isLikelyAgentReport(value)) return value;

  const normalized = normalizeTicker(ticker);
  const record = value as Record<string, unknown>;
  const exact = record[ticker] || record[normalized];
  if (isLikelyAgentReport(exact)) return exact;

  for (const [key, nested] of Object.entries(record)) {
    if (normalizeTicker(key) !== normalized) continue;
    if (isLikelyAgentReport(nested)) return nested;
  }
  return null;
}

export function getAgentReport(
  analystSignals: Record<string, any> | undefined,
  agentKey: string,
  ticker: string,
  agentResult?: AgentResult,
): AgentReport | null {
  const baseAgentKey = stripSuffix(agentKey);
  const candidates = Array.from(new Set([agentKey, baseAgentKey, `${baseAgentKey}_agent`]));
  if (analystSignals) {
    for (const key of candidates) {
      const signals = analystSignals[key];
      const report = pickTickerReport(signals, ticker);
      if (report) return report;
    }

    // Suffix-aware fallback: live SSE keys look like "aswath_damodaran_codx01".
    const wantedBase = stripSuffix(agentKey);
    for (const [key, signals] of Object.entries(analystSignals)) {
      if (stripSuffix(key) !== wantedBase) continue;
      const report = pickTickerReport(signals, ticker);
      if (report) return report;
    }
  }

  let analysis = agentResult?.analysis as unknown;
  if (typeof analysis === 'string') {
    try {
      analysis = JSON.parse(analysis);
    } catch {
      analysis = null;
    }
  }
  const analysisReport = pickTickerReport(analysis, ticker);
  if (analysisReport) return analysisReport;

  const storedReport = pickTickerReport(agentResult && agentResult.report, ticker);
  if (storedReport) return storedReport;
  return null;
}

export function pickDefaultAgent(agentResults: Map<string, AgentResult>, activeTicker: string): string {
  // risk_management nodes expose portfolio limit metrics, not analyst narrative text.
  const completeForTicker = Array.from(agentResults.entries()).filter(([key, result]) => (
    result.status === 'complete'
    && isNarrativeAgentKey(key)
    && (!result.ticker || normalizeTicker(result.ticker) === normalizeTicker(activeTicker))
  ));
  const scopedValuation = completeForTicker.find(([key]) => stripSuffix(key) === 'valuation_analyst');
  if (scopedValuation) return scopedValuation[0];

  const complete = completeForTicker.length > 0
    ? completeForTicker
    : Array.from(agentResults.entries()).filter(([key, result]) => (
      result.status === 'complete' && isNarrativeAgentKey(key)
    ));
  if (complete.length === 0) return Array.from(agentResults.keys())[0] || 'valuation_analyst';
  return complete[0][0];
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?다요음됨함])\s+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function normalizedEmpty(): NormalizedReport {
  return {
    conclusion: '',
    valuationDcf: '',
    multiples: '',
    risks: '',
    crossCheck: '',
    sources: '',
  };
}

function mapStructuredView(report: AgentReport): NormalizedReport | null {
  const view = report.structured_view || report.sections;
  if (!view || typeof view !== 'object') return null;
  const record = view as Record<string, unknown>;
  return {
    conclusion: String(record.conclusion || ''),
    valuationDcf: String(record.valuation_dcf || record.valuationDcf || ''),
    multiples: String(record.multiples || ''),
    risks: String(record.risks || ''),
    crossCheck: String(record.cross_check || record.crossCheck || ''),
    sources: String(record.sources || ''),
  };
}

function splitByMarkdownHeadings(reasoning: string): NormalizedReport | null {
  const headingRegex = /^(#{2,3})\s*(결론|conclusion|밸류에이션|valuation|멀티플|multiples|리스크|risk|크로스\s*체크|cross.?check|출처|source).*$/gim;
  const matches = Array.from(reasoning.matchAll(headingRegex));
  if (matches.length === 0) return null;

  const report = normalizedEmpty();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const heading = String(match[2] || '').toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? reasoning.length;
    const body = reasoning.slice(start, end).trim();
    if (/결론|conclusion/.test(heading)) report.conclusion = body;
    else if (/밸류에이션|valuation/.test(heading)) report.valuationDcf = body;
    else if (/멀티플|multiples/.test(heading)) report.multiples = body;
    else if (/리스크|risk/.test(heading)) report.risks = body;
    else if (/크로스|cross/.test(heading)) report.crossCheck = body;
    else if (/출처|source/.test(heading)) report.sources = body;
  }
  return report;
}

function stripMarkdownNoise(text: string) {
  return text
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/\[[+\-~?]\]/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWeakConclusion(text: string | null | undefined) {
  const clean = stripMarkdownNoise(String(text || ''));
  const withoutLabels = clean
    .replace(/핵심\s*판단|핵심\s*결론|결론\s*요약|key\s*judg(e)?ment|conclusion/gi, '')
    .trim();
  return withoutLabels.length < 14 || /^(없음|none|n\/a|na|[-–—]+)$/i.test(withoutLabels);
}

function joinConclusionParts(parts: string[]) {
  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(' · ');
}

function selectMeaningfulSentence(
  sources: Array<string | null | undefined>,
  preferredPattern?: RegExp,
) {
  const candidates = sources
    .flatMap(source => splitSentences(stripMarkdownNoise(String(source || ''))))
    .map(sentence => sentence.replace(/^[\d.)\s-]+/u, '').trim())
    .filter(sentence => !isWeakConclusion(sentence));
  const preferred = preferredPattern
    ? candidates.find(sentence => preferredPattern.test(sentence))
    : null;
  return preferred || candidates[0] || '';
}

function buildConciseConclusion(
  report: AgentReport,
  sections: NormalizedReport,
  reasoning: string,
  language: ReportLanguage,
) {
  const parts: string[] = [];
  const conf = normalizeConfidence(report.confidence);
  if (report.signal) {
    parts.push(
      `${signalToVerdict(String(report.signal), language)}${conf !== null ? ` (${language === 'ko' ? '신뢰도' : 'confidence'} ${conf}%)` : ''}`,
    );
  }

  const existingConclusion = selectMeaningfulSentence([sections.conclusion]);
  const valuation = selectMeaningfulSentence(
    [sections.valuationDcf, reasoning],
    /DCF|FCFF|내재가치|안전마진|margin|WACC|valuation|fair value/i,
  );
  const multiples = selectMeaningfulSentence(
    [sections.multiples, reasoning],
    /forward|EPS|P\/?E|이익|멀티플|consensus|컨센/i,
  );
  const risks = selectMeaningfulSentence(
    [sections.risks, reasoning],
    /risk|리스크|약세|bear|downside|고평가|위험|취약/i,
  );

  [existingConclusion, valuation, multiples, risks].forEach(sentence => {
    if (sentence && !parts.some(part => part.includes(sentence) || sentence.includes(part))) {
      parts.push(sentence);
    }
  });

  return joinConclusionParts(parts);
}

function keywordMatches(sentence: string, keywords: string[]) {
  const lower = sentence.toLowerCase();
  return keywords.filter(keyword => lower.includes(keyword.toLowerCase()));
}

function classifySentence(sentence: string, previousSection: SectionId | null): SentenceClassification {
  for (const rule of SENTENCE_RULES) {
    const matchedKeywords = keywordMatches(sentence, rule.high);
    if (matchedKeywords.length > 0) {
      return { sentence, section: rule.section, confidence: 'high', matchedKeywords };
    }
  }
  for (const rule of SENTENCE_RULES) {
    const matchedKeywords = keywordMatches(sentence, rule.medium);
    if (matchedKeywords.length > 0) {
      return { sentence, section: rule.section, confidence: 'medium', matchedKeywords };
    }
  }
  return {
    sentence,
    section: previousSection || 'section-01',
    confidence: 'low',
    matchedKeywords: [],
  };
}

export function normalizeAgentReport(
  report: AgentReport | null,
  _ticker: string,
  language: ReportLanguage,
): NormalizedReport {
  if (!report) return normalizedEmpty();

  const structured = mapStructuredView(report);
  if (structured) {
  const reasoningText = normalizeFinancialDisplayText(extractReasoningText(report.reasoning || report)).trim();
    return {
      ...structured,
      conclusion: buildConciseConclusion(report, structured, reasoningText, language)
        || stripMarkdownNoise(structured.conclusion),
      sources: structured.sources || buildSourceTrackingText(report),
    };
  }

  const reasoning = normalizeFinancialDisplayText(extractReasoningText(report.reasoning || report)).trim();
  if (!reasoning) return normalizedEmpty();
  if (reasoning.length < 60) {
    return { ...normalizedEmpty(), conclusion: stripMarkdownNoise(reasoning), sources: buildSourceTrackingText(report) };
  }

  const headed = splitByMarkdownHeadings(reasoning);
  if (headed) {
    return {
      ...headed,
      conclusion: buildConciseConclusion(report, headed, reasoning, language)
        || stripMarkdownNoise(headed.conclusion),
      crossCheck: extractCrossCheckGuideText(report) || headed.crossCheck,
      sources: buildSourceTrackingText(report),
    };
  }

  const sentences = splitSentences(reasoning);
  const classified: SentenceClassification[] = [];
  let previousSection: SectionId | null = null;
  for (const sentence of sentences) {
    const result = classifySentence(sentence, previousSection);
    classified.push(result);
    previousSection = result.section;
  }

  const anyMatched = classified.some(item => item.confidence !== 'low');
  if (!anyMatched) {
    const fallbackSections = { ...normalizedEmpty(), conclusion: reasoning };
    return {
      ...normalizedEmpty(),
      conclusion: buildConciseConclusion(report, fallbackSections, reasoning, language)
        || stripMarkdownNoise(reasoning),
      sources: buildSourceTrackingText(report),
    };
  }

  const sections: Record<SectionId, string[]> = {
    'section-01': [],
    'section-02': [],
    'section-03': [],
    'section-04': [],
    'section-05': [],
    'section-06': [],
  };
  classified.forEach(item => sections[item.section].push(item.sentence));

  if (sections['section-01'].length === 0) {
    const conf = normalizeConfidence(report.confidence);
    const prefix = report.signal
      ? `${signalToVerdict(String(report.signal), language)}${conf !== null ? ` (${language === 'ko' ? '신뢰도' : 'confidence'} ${conf}%)` : ''}`
      : '';
    sections['section-01'] = [prefix, ...sentences.slice(0, 2)].filter(Boolean);
  }

  const normalized = {
    conclusion: sections['section-01'].join(' '),
    valuationDcf: sections['section-02'].join(' '),
    multiples: sections['section-03'].join(' '),
    risks: sections['section-04'].join(' '),
    crossCheck: extractCrossCheckGuideText(report) || sections['section-05'].join(' ') || buildFallbackCrossCheckGuideFromReport(report),
    sources: buildSourceTrackingText(report),
  };
  return {
    ...normalized,
    conclusion: buildConciseConclusion(report, normalized, reasoning, language)
      || stripMarkdownNoise(normalized.conclusion),
  };
}

/** @deprecated Use normalizeAgentReport. Kept for Phase 1 compatibility. */
export function splitReasoningIntoSections(
  reasoning: string,
  options: { agentReport?: AgentReport | null; crossCheckGuide?: string | null; language?: ReportLanguage } = {},
): Record<SectionId, string> {
  const normalized = normalizeAgentReport(
    options.agentReport || { reasoning },
    '',
    options.language || 'ko',
  );
  if (options.crossCheckGuide) normalized.crossCheck = options.crossCheckGuide;
  return {
    'section-01': normalized.conclusion,
    'section-02': normalized.valuationDcf,
    'section-03': normalized.multiples,
    'section-04': normalized.risks,
    'section-05': normalized.crossCheck,
    'section-06': normalized.sources,
  };
}

function pickMetricSummary(report: AgentReport | null | undefined, keys: string[]) {
  if (!report) return '';
  const values = keys
    .map(key => {
      const value = readMetricValue(report, [key]);
      if (value === null) return null;
      return `${key.replace(/_/g, ' ')}: ${String(value)}`;
    })
    .filter(Boolean)
    .slice(0, 4);
  return values.length > 0 ? values.join('\n') : '';
}

function buildFallbackCrossCheckGuideFromReport(
  report: AgentReport | null | undefined,
  ticker?: string,
) {
  const isKorean = ticker ? isKoreanTicker(ticker) : false;
  const isJapan  = ticker ? isJapaneseTicker(ticker) : false;
  const sourceRef = isKorean
    ? 'DART 사업보고서의 「사업의 내용」, 「재무에 관한 사항」'
    : isJapan
      ? 'EDINET 유가증권보고서(사업 현황, 재무 현황 섹션)'
      : '사업보고서/10-K의 MD&A, 재무제표 주석';
  const snippets = pickMetricSummary(report, ['signal', 'confidence', 'intrinsic_value', 'wacc', 'forward_pe', 'margin_of_safety']);
  if (snippets) {
    return `1. **핵심 타겟 데이터:** ${snippets}.\n2. **원문 추적 섹션:** ${sourceRef}, 리스크 요인을 대조하십시오.\n3. **경영진 멘트 검증:** 숫자 변화가 경영진 설명과 일치하는지 확인하십시오.`;
  }
  return `1. **핵심 타겟 데이터:** 전처리 데이터의 신호, 신뢰도, 밸류에이션 가정을 확인하십시오.\n2. **원문 추적 섹션:** ${sourceRef}와 최근 어닝콜을 대조하십시오.\n3. **경영진 멘트 검증:** 투자 논거와 리스크 문구가 원문과 일치하는지 확인하십시오.`;
}

export function buildSourceTrackingText(report: AgentReport | null | undefined) {
  const confidence = normalizeConfidence(report?.confidence);
  return [
    `1. **10-K · MD&A:** 사업 모델, 현금흐름, 리스크 요인을 원문 기준으로 확인합니다.`,
    `2. **컨센서스 EPS:** forward EPS와 forward P/E는 데이터 출처별 시점 차이를 확인합니다.`,
    `3. **WACC 추정:** 할인율, 베타, 터미널 성장률은 자동 추정 분류입니다.${confidence !== null ? ` 신뢰도 ${confidence}% 기준으로 우선순위를 둡니다.` : ''}`,
  ].join('\n');
}

export function prepareEvidenceLayoutText(sectionText: string) {
  return normalizeFinancialDisplayText(sectionText)
    .replace(/\r\n?/g, '\n')
    // Restore breaks before inline headings and verdict markers produced by dense model output.
    .replace(/([^\n])\s+(?=#{2,3}\s+)/gu, '$1\n\n')
    .replace(/\s+(?=(?:\d+[.)]\s+)?\[[+\-~?]\])/gu, '\n\n')
    .replace(/\s+(?=[-*•]\s+\[[+\-~?]\])/gu, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLongEvidenceBlock(block: string): string[] {
  if (block.length <= 620) return [block];

  const sentences = splitSentences(block);
  if (sentences.length <= 1) return [block];

  const chunks: string[] = [];
  let current = '';

  sentences.forEach(sentence => {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && next.length > 520) {
      chunks.push(current);
      current = sentence;
      return;
    }
    current = next;
  });

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [block];
}

function isOrphanEvidenceHeading(block: string) {
  const clean = block
    .replace(/^\s*(?:#{2,3}\s+|[-*•]\s+|\d+[.)]\s*)/u, '')
    .trim();
  return /^\[[+\-~?]\]\s*[^.!?。？！\n]{2,90}[:：]\s*$/u.test(clean)
    || /^#{2,3}\s*[^.!?。？！\n]{2,90}[:：]\s*$/u.test(clean);
}

function mergeOrphanEvidenceHeadings(blocks: string[]) {
  const merged: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (next && isOrphanEvidenceHeading(block)) {
      merged.push(`${block} ${next}`);
      index += 1;
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function buildEvidenceItem(raw: string, index: number): EvidenceItem {
  const clean = raw
    .replace(/^\s*(?:#{2,3}\s+|[-*•]\s+|\d+[.)]\s*)/u, '')
    .trim();
  const { heading, body } = extractItemHeading(clean);
  return {
    id: `evidence-${index + 1}`,
    rawText: clean,
    heading,
    body,
    tone: classifyItemTone(clean),
    citationLetters: [],
  };
}

function isMarkerOnlyEvidenceText(text: string) {
  const clean = text
    .replace(/^\s*\[[+\-~?]\]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:\d+[.)]?|[.)]+)$/u.test(clean);
}

const HEADING_ONLY_EVIDENCE_PATTERNS = [
  /^핵심\s*(판단|가치|결론|수치|숫자|타겟\s*데이터)$/u,
  /^결론(?:\s*요약)?$/u,
  /^핵심\s*판단$/u,
  /^포워드\s*아웃룩(?:\s*\([^)]*\))?$/iu,
  /^forward\s*outlook(?:\s*\([^)]*\))?$/iu,
  /^상대가치\s*sanity\s*check$/iu,
  /^sanity\s*check$/iu,
  /^원문\s*(?:대조\s*)?체크리스트$/u,
  /^원문\s*추적\s*섹션$/u,
  /^경영진\s*멘트\s*검증$/u,
  /^불확실성의\s*핵심$/u,
  /^제\s*가치\s*\([^)]*\)\s*와\s*해석$/u,
];

const HEADING_ONLY_EVIDENCE_LABELS = new Set([
  '핵심 판단',
  '핵심판단',
  '핵심 가치',
  '핵심가치',
  '핵심 결론',
  '핵심결론',
  '핵심 수치',
  '핵심수치',
  '핵심 숫자',
  '핵심숫자',
  '핵심 타겟 데이터',
  '핵심타겟데이터',
  '결론',
  '결론 요약',
  '포워드 아웃룩',
  '포워드아웃룩',
  '상대가치 sanity check',
  'sanity check',
  '원문 대조 체크리스트',
  '원문대조체크리스트',
  '원문 체크리스트',
  '원문체크리스트',
  '원문 추적 섹션',
  '원문추적섹션',
  '경영진 멘트 검증',
  '경영진멘트검증',
  '불확실성의 핵심',
  '불확실성의핵심',
]);

function hasDataToken(text: string) {
  DATA_TOKEN_PATTERN.lastIndex = 0;
  const found = DATA_TOKEN_PATTERN.test(text);
  DATA_TOKEN_PATTERN.lastIndex = 0;
  return found;
}

function stripEvidenceLabelNoise(text: string) {
  return text
    .replace(/^\s*(?:#{2,3}\s+|[-*•]\s+|\d+[.)]\s*)/u, '')
    .replace(/^\s*\[[+\-~?]\]\s*/u, '')
    .replace(/\*\*/g, '')
    .replace(/[:：.!?。？！]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePredicate(text: string) {
  return /(다|요|임|함|됨|한다|했다|된다|이다|입니다|합니다|있습니다|없습니다|보입니다|낮습니다|높습니다)$/u.test(text);
}

function isHeadingOnlyEvidenceText(text: string) {
  const clean = stripEvidenceLabelNoise(text);
  if (!clean || hasDataToken(clean)) return false;
  if (HEADING_ONLY_EVIDENCE_LABELS.has(clean)) return true;
  if (HEADING_ONLY_EVIDENCE_PATTERNS.some(pattern => pattern.test(clean))) return true;

  return clean.length <= 24
    && /[\uAC00-\uD7A3]/u.test(clean)
    && !/[.!?。？！]/u.test(clean)
    && !looksLikePredicate(clean);
}

function isBlankEvidenceItem(item: EvidenceItem) {
  const body = item.body
    .replace(/^\s*\[[+\-~?]\]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return body.length === 0 || isMarkerOnlyEvidenceText(body) || isHeadingOnlyEvidenceText(body);
}

export function parseEvidenceItems(sectionText: string): EvidenceItem[] {
  const normalized = prepareEvidenceLayoutText(sectionText);
  if (!normalized) return [];

  const rawBlocks = normalized
    .split(/\n{2,}|\n(?=\s*(?:#{2,3}\s+|\d+[.)]|[-*•]\s+|\[[+\-~?]\]))/u)
    .map(item => item.trim())
    .filter(Boolean);

  const source = (rawBlocks.length > 0 ? mergeOrphanEvidenceHeadings(rawBlocks) : [normalized])
    .flatMap(splitLongEvidenceBlock);

  return source
    .map(buildEvidenceItem)
    .filter((item): item is EvidenceItem => !isBlankEvidenceItem(item));
}

export function classifyItemTone(itemText: string): ReportTone {
  const text = itemText.toLowerCase();
  if (/^\s*\[-\]|bearish|sell|downside|negative|risk|overvalued|약세|매도|부정|위험|리스크|고평가|취약/.test(text)) {
    return 'bearish';
  }
  if (/^\s*\[\+\]|bullish|buy|upside|positive|undervalued|strong|강세|매수|긍정|상승|저평가|양호/.test(text)) {
    return 'bullish';
  }
  return 'neutral';
}

export function extractItemHeading(itemText: string): { heading: string | null; body: string } {
  const normalizedItemText = normalizeFinancialDisplayText(itemText);
  const bold = normalizedItemText.match(/^\*\*([^*]{2,80})\*\*:?\s*(.*)$/su);
  if (bold) return { heading: bold[1].trim(), body: bold[2].trim() };

  const colon = normalizedItemText.match(/^([^:：]{2,42})[:：]\s+(.+)$/su);
  if (colon) return { heading: colon[1].replace(/^\[[+\-~?]\]\s*/u, '').trim(), body: colon[2].trim() };

  const marker = normalizedItemText.match(/^\[[+\-~?]\]\s*(.+)$/su);
  if (marker) {
    const bodyText = marker[1].trim();
    if (/[:：]\s*$/u.test(bodyText)) {
      return { heading: bodyText.replace(/[:：]\s*$/u, '').trim(), body: '' };
    }
    return { heading: deriveMarkerHeading(bodyText), body: bodyText };
  }

  return { heading: null, body: normalizedItemText };
}

function isDecimalPoint(text: string, index: number) {
  return text[index] === '.' && /\d/u.test(text[index - 1] || '') && /\d/u.test(text[index + 1] || '');
}

function findSafeHeadingBoundary(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === '.' || char === '!' || char === '?') && !isDecimalPoint(text, index)) {
      return index + 1;
    }
    if (char === '다' && (index === text.length - 1 || /\s/u.test(text[index + 1] || ''))) {
      return index + 1;
    }
  }
  return -1;
}

function deriveMarkerHeading(bodyText: string) {
  const boundary = findSafeHeadingBoundary(bodyText);
  const source = boundary > 0 ? bodyText.slice(0, boundary) : bodyText;
  const compact = source
    .replace(/[.!?]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return null;
  if (compact.length <= 60) return compact;
  return null;
}

export function getDataTokenPattern() {
  return DATA_TOKEN_PATTERN;
}

export function classifyDataTokenTone(
  token: string,
  surroundingText: string,
  itemTone: ReportTone,
): ReportTone {
  const context = surroundingText.toLowerCase();
  if (/안전마진|margin|upside|저평가|할인/.test(context)) return 'bullish';
  if (/risk|downside|손실|고평가|overvalued/.test(context)) return 'bearish';
  if (token.startsWith('-')) return 'bearish';
  return itemTone;
}

export function splitTextIntoDataTokenParts(text: string): Array<
  | { kind: 'text'; value: string }
  | { kind: 'token'; value: string; tone: ReportTone }
> {
  const parts: Array<
    | { kind: 'text'; value: string }
    | { kind: 'token'; value: string; tone: ReportTone }
  > = [];
  let lastIndex = 0;
  let chipCount = 0;
  DATA_TOKEN_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(DATA_TOKEN_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ kind: 'text', value: text.slice(lastIndex, index) });
    const chipEligible = chipCount < 4 && !/^\d$/.test(token.trim());
    if (chipEligible) {
      const context = text.slice(Math.max(0, index - 60), Math.min(text.length, index + token.length + 60));
      parts.push({ kind: 'token', value: token, tone: classifyDataTokenTone(token, context, 'neutral') });
      chipCount += 1;
    } else {
      parts.push({ kind: 'text', value: token });
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) parts.push({ kind: 'text', value: text.slice(lastIndex) });
  return parts.length > 0 ? parts : [{ kind: 'text', value: text }];
}

export function findDataTokenReferences(text: string): Array<{
  index: number;
  length: number;
  raw: string;
  tone: ReportTone;
}> {
  DATA_TOKEN_PATTERN.lastIndex = 0;
  return Array.from(text.matchAll(DATA_TOKEN_PATTERN)).map(match => {
    const index = match.index ?? 0;
    const raw = match[0];
    const context = text.slice(Math.max(0, index - 60), Math.min(text.length, index + raw.length + 60));
    return {
      index,
      length: raw.length,
      raw,
      tone: classifyDataTokenTone(raw, context, 'neutral'),
    };
  });
}

function regexKeyword(regex: RegExp) {
  const source = regex.source;
  return source.split('|')[0].replace(/\\b|\\/g, '');
}

export function inferCitationInferences(
  sentence: string,
  _sectionId: SectionId,
): CitationInference[] {
  return CITATION_RULES
    .map(rule => {
      if (rule.highRegex.test(sentence)) {
        return { letter: rule.letter, confidence: 'high' as CitationConfidence, matchedKeyword: regexKeyword(rule.highRegex) };
      }
      if (rule.mediumRegex.test(sentence)) {
        return { letter: rule.letter, confidence: 'medium' as CitationConfidence, matchedKeyword: regexKeyword(rule.mediumRegex) };
      }
      return null;
    })
    .filter((item): item is CitationInference => Boolean(item))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}

export function annotateTextWithCitations(
  text: string,
  sectionId: SectionId,
): Array<{ sentence: string; inferences: CitationInference[] }> {
  return splitSentences(text).map(sentence => ({
    sentence,
    inferences: inferCitationInferences(sentence, sectionId),
  }));
}

export function inferCitationLetters(itemText: string, sectionId: SectionId): string[] {
  const all = splitSentences(itemText).flatMap(sentence => inferCitationInferences(sentence, sectionId));
  return Array.from(new Set(all.map(item => item.letter))).sort();
}

export function insertCitationChipsIntoText(text: string, letters: string[]): string {
  if (letters.length === 0) return text;
  const annotated = annotateTextWithCitations(text, 'section-01');
  if (annotated.length === 0) return text;
  return annotated.map(({ sentence, inferences }, index) => {
    const applied = inferences.map(item => item.letter).filter(letter => letters.includes(letter));
    const fallback = index === annotated.length - 1 && applied.length === 0 ? letters : applied;
    return fallback.length > 0 ? `${sentence} ${fallback.map(letter => `[${letter}]`).join(' ')}` : sentence;
  }).join(' ');
}

export function buildCitations(
  ticker: string,
  isKoreanStock: boolean,
  language: ReportLanguage,
): Citation[] {
  const code = getKoreanCode(ticker);
  const normalized = normalizeTicker(ticker);
  const isJapan = isJapaneseTicker(ticker);

  // citation 'a' 라벨은 시장별로 분기
  const reportLabelKo = isKoreanStock
    ? '사업보고서 · 재무에 관한 사항'
    : isJapan
      ? '유가증권보고서 · 재무현황'
      : '10-K · MD&A';
  const reportLabelEn = isKoreanStock
    ? 'Korean Annual Report (DART)'
    : isJapan
      ? 'EDINET Securities Report'
      : '10-K · MD&A';
  const reportTypeKo = isKoreanStock ? 'DART' : isJapan ? 'EDINET' : 'SEC';
  const reportTypeEn = isKoreanStock ? 'DART' : isJapan ? 'EDINET' : 'SEC';
  const reportHref = isKoreanStock
    ? `https://dart.fss.or.kr/dsab001/main.do?textCrpNm=${encodeURIComponent(code)}`
    : isJapan
      ? `https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx`
      : `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(normalized)}&owner=exclude`;

  const labels = [
    {
      letter: 'a',
      labelKo: reportLabelKo,
      labelEn: reportLabelEn,
      typeKo: reportTypeKo,
      typeEn: reportTypeEn,
      href: reportHref,
    },
    {
      letter: 'b',
      labelKo: '최근 어닝콜',
      labelEn: 'Latest earnings call',
      typeKo: 'IR',
      typeEn: 'IR',
      href: isKoreanStock
        ? `https://finance.naver.com/item/news.naver?code=${encodeURIComponent(code)}`
        : isJapan
          ? `https://finance.yahoo.co.jp/quote/${encodeURIComponent(normalized)}/news`
          : `https://seekingalpha.com/symbol/${encodeURIComponent(normalized)}/earnings/transcripts`,
    },
    {
      letter: 'c',
      labelKo: '컨센서스 EPS',
      labelEn: 'Consensus EPS',
      typeKo: '데이터',
      typeEn: 'Data',
      href: null,
    },
    {
      letter: 'd',
      labelKo: 'WACC 추정 · Damodaran',
      labelEn: 'WACC · Damodaran',
      typeKo: '학술',
      typeEn: 'Academic',
      href: 'https://pages.stern.nyu.edu/~adamodar/',
    },
    {
      letter: 'e',
      labelKo: '섹터 리포트',
      labelEn: 'Sector report',
      typeKo: '섹터',
      typeEn: 'Sector',
      href: null,
    },
  ];

  return labels.map(citation => ({
    ...citation,
    label: language === 'ko' ? citation.labelKo : citation.labelEn,
    type: language === 'ko' ? citation.typeKo : citation.typeEn,
    hrefAvailable: Boolean(citation.href),
  }));
}

export function extractKeyNumbers(
  itemText: string,
  language: ReportLanguage,
): KeyNumber[] {
  const results: KeyNumber[] = [];
  const usedLabels = new Set<string>();
  DATA_TOKEN_PATTERN.lastIndex = 0;

  for (const match of itemText.matchAll(DATA_TOKEN_PATTERN)) {
    if (results.length >= 4) break;
    const value = match[0].trim();
    if (/^\d$/.test(value)) continue;

    const index = match.index ?? 0;
    const contextStart = Math.max(0, index - 80);
    const contextEnd = Math.min(itemText.length, index + value.length + 80);
    const context = itemText.slice(contextStart, contextEnd);
    const candidate = LABEL_CANDIDATES.find(label => label.pattern.test(context));
    const label = candidate ? (language === 'ko' ? candidate.ko : candidate.en) : (language === 'ko' ? `값 ${results.length + 1}` : `Value ${results.length + 1}`);

    if (usedLabels.has(label)) continue;
    usedLabels.add(label);
    results.push({ label, value });
  }

  return results;
}

function readNested(record: Record<string, any>, key: string): unknown {
  if (record[key] !== null && record[key] !== undefined && record[key] !== '') return record[key];
  const reasoning = record.reasoning;
  if (reasoning && typeof reasoning === 'object') {
    const reasoningRecord = reasoning as Record<string, any>;
    if (reasoningRecord[key] !== null && reasoningRecord[key] !== undefined && reasoningRecord[key] !== '') return reasoningRecord[key];
    for (const nested of Object.values(reasoningRecord)) {
      if (!nested || typeof nested !== 'object') continue;
      const value = (nested as Record<string, any>)[key];
      if (value !== null && value !== undefined && value !== '') return value;
    }
  }
  return null;
}

function readMetricValue(report: AgentReport | null | undefined, keys: string[]): number | null {
  if (!report) return null;
  for (const key of keys) {
    const value = readNested(report, key);
    if (value === null || value === undefined || value === '') continue;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,%$x]/gi, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeExtractedNumber(raw: string | undefined, isPercent: boolean | undefined, scalePercentLike = false) {
  if (!raw) return null;
  const n = Number(raw.replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (isPercent) return n / 100;
  if (scalePercentLike && Math.abs(n) > 2 && Math.abs(n) <= 100) return n / 100;
  return n;
}

const marginOfSafetyPatterns = [
  /(?:margin[_\s-]?of[_\s-]?safety|safety\s*margin|안전마진|마진\s*오브\s*세이프티)[^-\d%$]{0,120}(-?\d[\d,]*(?:\.\d+)?)\s*(%)?(?=\s*(?:로|으로|입니다|임|,|\.|$))/gi,
  /(-?\d[\d,]*(?:\.\d+)?)\s*(%)?[^.\n]{0,80}(?:margin[_\s-]?of[_\s-]?safety|safety\s*margin|안전마진|마진\s*오브\s*세이프티)/gi,
];

const perShareIntrinsicValuePatterns = [
  /(?:내재가치\s*1주당|내재가치\s*\/\s*주당|1주당\s*내재가치|주당\s*내재가치|intrinsic\s*value\s*per\s*share|per-share\s*intrinsic\s*value)[^-\d$₩¥]{0,80}[$₩¥]?(-?\d[\d,]*(?:\.\d+)?)(?=\s*(?:달러|원|엔|krw|usd|jpy|,|\.|$))/gi,
  /(?:fair\s*value\s*per\s*share|dcf\s*value\s*per\s*share|1주당\s*적정가|주당\s*적정가)[^-\d$₩¥]{0,80}[$₩¥]?(-?\d[\d,]*(?:\.\d+)?)(?=\s*(?:달러|원|엔|krw|usd|jpy|,|\.|$))/gi,
];

const SAFETY_MARGIN_PRICE_BUFFER = 0.25;

function extractPatternValue(
  text: string,
  patterns: RegExp[],
  scalePercentLike = false,
): number | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = normalizeExtractedNumber(match[1], match[2] === '%', scalePercentLike);
      if (value !== null) return value;
    }
  }
  return null;
}

export function extractReasoningMetricValue(report: AgentReport | null | undefined, keys: string[]): number | null {
  if (!report) return null;
  const text = extractReasoningText(report.reasoning || report);
  if (!text) return null;
  const normalizedText = text.replace(/\u2212/g, '-');

  if (keys.some(key => ['margin_of_safety', 'safety_margin'].includes(key))) {
    return extractPatternValue(normalizedText, marginOfSafetyPatterns, true);
  }
  if (keys.some(key => ['intrinsic_value', 'fair_value', 'dcf_value'].includes(key))) {
    return extractPatternValue(normalizedText, perShareIntrinsicValuePatterns);
  }
  return null;
}

export function extractMetricValue(report: AgentReport | null | undefined, keys: string[]): number | null {
  return readMetricValue(report, keys);
}

export function calcMarginOfSafety(intrinsic: number | null, current: number | null): number | null {
  if (intrinsic === null || current === null || current === 0) return null;
  return (intrinsic - current) / current;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizePerShareReferencePrice(
  value: number | null | undefined,
  currentPrice: number | null | undefined,
): number | null {
  const n = finiteNumber(value);
  if (n === null || n <= 0) return null;

  const current = finiteNumber(currentPrice);
  if (current !== null && current > 0 && Math.abs(n / current) > 1000) return null;
  return n;
}

export function chooseIntrinsicReferencePrice(
  candidates: Array<number | null | undefined>,
  currentPrice: number | null | undefined,
): number | null {
  for (const candidate of candidates) {
    const normalized = normalizePerShareReferencePrice(candidate, currentPrice);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function resolveMarginOfSafetySnapshot({
  currentPrice,
  intrinsicValue,
  reportedMargin,
  reasoningMargin,
  calculatedMarginOfSafety,
}: {
  currentPrice: number | null | undefined;
  intrinsicValue: number | null | undefined;
  reportedMargin?: number | null;
  reasoningMargin?: number | null;
  calculatedMarginOfSafety?: number | null;
}): { referencePrice: number | null; safetyMarginPrice: number | null; margin: number | null } {
  const referencePrice = normalizePerShareReferencePrice(intrinsicValue, currentPrice);
  const safetyMarginPrice = referencePrice !== null
    ? referencePrice * (1 - SAFETY_MARGIN_PRICE_BUFFER)
    : null;
  const calculated = finiteNumber(calculatedMarginOfSafety)
    ?? calcMarginOfSafety(referencePrice, finiteNumber(currentPrice));
  if (calculated !== null) {
    return { referencePrice, safetyMarginPrice, margin: calculated };
  }

  const fallbackMargin = finiteNumber(reasoningMargin) ?? finiteNumber(reportedMargin);
  return { referencePrice: null, safetyMarginPrice: null, margin: fallbackMargin };
}

function metricFromReport(
  report: AgentReport | null,
  activeAgentKey: string,
  sourceAgentKey: string,
  keys: string[],
): CanonicalMetric | undefined {
  const value = readMetricValue(report, keys) ?? extractReasoningMetricValue(report, keys);
  if (value === null) return undefined;
  return {
    value,
    sourceAgentKey,
    sourceAgentNameKo: displayAgentName(sourceAgentKey, undefined, 'ko'),
    sourceAgentNameEn: displayAgentName(sourceAgentKey, undefined, 'en'),
    isFromActiveAgent: sourceAgentKey === activeAgentKey,
  };
}

function metricFromCandidates(
  reports: Record<string, AgentReport | null>,
  activeAgentKey: string,
  candidates: string[],
  keys: string[],
): CanonicalMetric | undefined {
  for (const key of candidates) {
    const report = reports[key];
    const metric = metricFromReport(report, activeAgentKey, key, keys);
    if (metric) return metric;
  }

  for (const [key, report] of Object.entries(reports)) {
    const metric = metricFromReport(report, activeAgentKey, key, keys);
    if (metric) return metric;
  }
  return undefined;
}

export function buildCanonicalMetrics(
  activeAgentKey: string,
  completeResult: CompleteResult,
  ticker: string,
): CanonicalMetrics {
  const signals = completeResult.analyst_signals;
  const reports: Record<string, AgentReport | null> = {
    [activeAgentKey]: getAgentReport(signals, activeAgentKey, ticker),
    valuation_analyst: getAgentReport(signals, 'valuation_analyst', ticker),
    aswath_damodaran: getAgentReport(signals, 'aswath_damodaran', ticker),
    fundamentals_analyst: getAgentReport(signals, 'fundamentals_analyst', ticker),
    charlie_munger: getAgentReport(signals, 'charlie_munger', ticker),
    nassim_taleb: getAgentReport(signals, 'nassim_taleb', ticker),
  };

  const activeFirst = [activeAgentKey, 'valuation_analyst'];
  const metrics: CanonicalMetrics = {
    forwardEpsFy0: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_eps_fy0']),
    forwardEpsFy1: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_eps_fy1']),
    forwardEpsTtm: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_eps_ttm', 'forward_eps']),
    intrinsicValue: metricFromCandidates(reports, activeAgentKey, [activeAgentKey, 'valuation_analyst', 'aswath_damodaran'], ['intrinsic_value', 'fair_value', 'dcf_value']),
    marginOfSafety: metricFromCandidates(reports, activeAgentKey, activeFirst, ['margin_of_safety']),
    interestCoverage: metricFromCandidates(reports, activeAgentKey, [activeAgentKey, 'fundamentals_analyst'], ['interest_coverage', 'interest_coverage_ratio']),
    beta: metricFromCandidates(reports, activeAgentKey, [activeAgentKey, 'fundamentals_analyst', 'charlie_munger', 'nassim_taleb'], ['beta']),
    wacc: metricFromCandidates(reports, activeAgentKey, [activeAgentKey, 'valuation_analyst', 'aswath_damodaran'], ['wacc', 'discount_rate']),
    forwardPeFy0: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_pe_fy0']),
    forwardPeFy1: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_pe_fy1']),
    forwardPe: metricFromCandidates(reports, activeAgentKey, activeFirst, ['forward_pe', 'forward_pe_ttm']),
    currentPrice: metricFromCandidates(reports, activeAgentKey, Object.keys(reports), ['current_price', 'price', 'close_price', 'market_price']),
  };

  // Fiscal year labels (scalar integers, not CanonicalMetric)
  const activeReport = reports[activeAgentKey];
  const fy0Year = readMetricValue(activeReport, ['fy0_fiscal_year']);
  const fy1Year = readMetricValue(activeReport, ['fy1_fiscal_year']);
  metrics.fy0FiscalYear = fy0Year !== null ? Math.round(fy0Year) : null;
  metrics.fy1FiscalYear = fy1Year !== null ? Math.round(fy1Year) : null;

  if (!metrics.marginOfSafety && metrics.intrinsicValue && metrics.currentPrice) {
    metrics.marginOfSafety = {
      value: calcMarginOfSafety(metrics.intrinsicValue.value, metrics.currentPrice.value) ?? 0,
      sourceAgentKey: metrics.intrinsicValue.sourceAgentKey,
      sourceAgentNameKo: metrics.intrinsicValue.sourceAgentNameKo,
      sourceAgentNameEn: metrics.intrinsicValue.sourceAgentNameEn,
      isFromActiveAgent: metrics.intrinsicValue.isFromActiveAgent,
    };
  }

  return metrics;
}

export function extractTargetTiles(
  metrics: CanonicalMetrics,
  activeAgentKey: string,
  _language: ReportLanguage,
  currency = 'USD',
): TargetTile[] {
  const safetyMarginPrice = buildSafetyMarginPrice(metrics);
  const candidates: Array<{ labelKey: string; sublabelKey: string; metric?: CanonicalMetric; tone: ReportTone; formatter?: (value: number) => string }> = [
    { labelKey: 'targetEpsLabel', sublabelKey: 'targetEpsSubtitle', metric: metrics.forwardEpsFy0 || metrics.forwardEpsTtm, tone: 'neutral', formatter: formatPlain },
    { labelKey: 'targetIntrinsicLabel', sublabelKey: 'targetIntrinsicSubtitle', metric: metrics.intrinsicValue, tone: intrinsicTone(metrics.intrinsicValue?.value ?? null, metrics.currentPrice?.value ?? null), formatter: value => formatCurrency(value, currency) },
    { labelKey: 'targetMarginLabel', sublabelKey: 'targetMarginSubtitle', metric: safetyMarginPrice, tone: marginTone(metrics.marginOfSafety?.value ?? null), formatter: value => formatMarginTarget(value, metrics.currentPrice?.value ?? null, metrics.marginOfSafety?.value ?? null, currency) },
    { labelKey: 'targetCoverageLabel', sublabelKey: 'targetCoverageSubtitle', metric: metrics.interestCoverage, tone: coverageTone(metrics.interestCoverage?.value ?? null), formatter: formatMultiple },
    { labelKey: 'targetBetaLabel', sublabelKey: 'targetBetaSubtitle', metric: metrics.beta, tone: 'neutral', formatter: formatPlain },
    { labelKey: 'targetWaccLabel', sublabelKey: 'targetWaccSubtitle', metric: metrics.wacc, tone: 'neutral', formatter: formatPercentSmart },
    { labelKey: 'targetForwardPeLabel', sublabelKey: 'targetForwardPeSubtitle', metric: metrics.forwardPeFy0 || metrics.forwardPe, tone: 'neutral', formatter: formatMultiple },
  ];

  return candidates
    .filter(candidate => candidate.metric)
    .slice(0, 7)
    .map(candidate => {
      const metric = candidate.metric as CanonicalMetric;
      return {
        labelKey: candidate.labelKey,
        sublabelKey: candidate.sublabelKey,
        value: candidate.formatter ? candidate.formatter(metric.value) : formatPlain(metric.value),
        tone: candidate.tone,
        sourceAgent: {
          key: metric.sourceAgentKey,
          nameKo: metric.sourceAgentNameKo,
          nameEn: metric.sourceAgentNameEn,
        },
        isFromActiveAgent: metric.sourceAgentKey === activeAgentKey && metric.isFromActiveAgent,
      };
    });
}

function buildSafetyMarginPrice(metrics: CanonicalMetrics): CanonicalMetric | undefined {
  const intrinsic = metrics.intrinsicValue;
  if (!intrinsic || !Number.isFinite(intrinsic.value) || intrinsic.value <= 0) return undefined;
  return {
    ...intrinsic,
    value: intrinsic.value * (1 - SAFETY_MARGIN_PRICE_BUFFER),
  };
}

function intrinsicTone(intrinsic: number | null, current: number | null): ReportTone {
  if (intrinsic !== null && current !== null && intrinsic > current) return 'bullish';
  if (intrinsic !== null && current !== null) return 'bearish';
  return 'neutral';
}

function marginTone(value: number | null): ReportTone {
  if (value === null) return 'neutral';
  if (value > 0) return 'bullish';
  if (value < 0) return 'bearish';
  return 'neutral';
}

function coverageTone(value: number | null): ReportTone {
  if (value === null) return 'neutral';
  if (value > 5) return 'bullish';
  if (value < 1.5) return 'bearish';
  return 'neutral';
}

function formatCurrency(value: number, currency = 'USD') {
  const normalized = currency.toUpperCase();
  if (normalized === 'KRW') return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  if (normalized === 'JPY') return `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatMarginTarget(
  safetyMarginPrice: number,
  currentPrice: number | null | undefined,
  rawMarginOfSafety: number | null | undefined,
  currency: string,
) {
  return formatSafetyMarginTarget(safetyMarginPrice, currentPrice, rawMarginOfSafety, currency);
}

function formatSafetyMarginTarget(
  safetyMarginPrice: number,
  currentPrice: number | null | undefined,
  rawMarginOfSafety: number | null | undefined,
  currency: string,
) {
  const current = finiteNumber(currentPrice);
  const relativeToCurrent = current !== null && current > 0
    ? (safetyMarginPrice - current) / current
    : finiteNumber(rawMarginOfSafety);
  const pct = relativeToCurrent !== null
    ? ` (${relativeToCurrent > 0 ? '+' : ''}${(relativeToCurrent * 100).toFixed(1)}%)`
    : '';
  return `${formatCurrency(safetyMarginPrice, currency)}${pct}`;
}

function formatPercentSmart(value: number) {
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  return `${pct.toFixed(2)}%`;
}

function formatMultiple(value: number) {
  return `${value.toFixed(2)}x`;
}

function formatPlain(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function extractSensitivityMatrix(
  report: AgentReport | null,
): Array<Array<{ wacc: number; growth: number; safetyMargin: number; intrinsicValue: number }>> | null {
  const reasoning = report?.reasoning && typeof report.reasoning === 'object'
    ? report.reasoning as Record<string, any>
    : null;
  const matrix = report?.sensitivity_matrix || reasoning?.sensitivity_matrix || reasoning?.forward_per_analysis?.sensitivity_matrix;
  if (!Array.isArray(matrix) || matrix.length < 3) return null;
  const parsed = matrix.map((row: any) => {
    if (!Array.isArray(row) || row.length < 3) return null;
    return row.map((cell: any) => {
      const wacc = Number(cell?.wacc);
      const growth = Number(cell?.growth ?? cell?.g);
      const safetyMargin = Number(cell?.safety_margin ?? cell?.safetyMargin);
      const intrinsicValue = Number(cell?.intrinsic_value ?? cell?.intrinsicValue);
      if (![wacc, growth, safetyMargin, intrinsicValue].every(Number.isFinite)) return null;
      return { wacc, growth, safetyMargin, intrinsicValue };
    });
  });
  if (parsed.some(row => !row || row.some(cell => !cell))) return null;
  return parsed as Array<Array<{ wacc: number; growth: number; safetyMargin: number; intrinsicValue: number }>>;
}

export function shouldShowSensitivity(
  activeAgentKey: string,
  matrix: ReturnType<typeof extractSensitivityMatrix>,
): boolean {
  if (!matrix) return false;
  if (matrix.length < 3 || matrix[0].length < 3) return false;
  if (activeAgentKey !== 'valuation_analyst' && activeAgentKey !== 'aswath_damodaran') return false;
  return true;
}

export function listOtherAgents(
  completeResult: CompleteResult,
  activeAgentKey: string,
  ticker: string,
  agentMetaMap: Map<string, AgentMeta>,
  language: ReportLanguage,
): OtherAgent[] {
  const signals = completeResult.analyst_signals || {};
  return Object.entries(signals)
    .map(([key, value]) => {
      const baseKey = stripSuffix(key);
      if (baseKey === stripSuffix(activeAgentKey) || !isNarrativeAgentKey(baseKey)) return null;
      const report = pickTickerReport(value, ticker);
      if (!report) return null;
      const meta = agentMetaMap.get(baseKey) || getAgentMeta(baseKey);
      const tone = getSignalTone(report.signal);
      return {
        key: baseKey,
        displayNameKo: displayAgentName(baseKey, meta.name, 'ko'),
        displayNameEn: displayAgentName(baseKey, meta.name, 'en'),
        tone,
        score: Math.round(scoreSignal(report.signal, report.confidence)),
        confidence: normalizeConfidence(report.confidence),
      };
    })
    .filter((agent): agent is OtherAgent => Boolean(agent))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 5)
    .map(agent => ({
      ...agent,
      displayNameKo: language === 'ko' ? agent.displayNameKo : agent.displayNameKo,
    }));
}

export function getDetailReportMarkdown(report: AgentReport | null, agentMeta: AgentMeta, ticker: string) {
  const reasoning = extractReasoningText(report?.reasoning || report);
  if (reasoning) return reasoning;
  return `# ${ticker} · ${agentMeta.name}\n\n${buildFallbackCrossCheckGuideFromReport(report, ticker)}`;
}

export function extractCrossCheckGuideText(report: AgentReport | null | undefined) {
  const text = extractReasoningText(report?.reasoning || report);
  if (!text) return null;
  const headingIndex = text.search(/원문 대조 체크리스트|Cross-check|핵심 타겟 데이터|Source Tracking/i);
  if (headingIndex < 0) return null;
  return text.slice(headingIndex).trim();
}
