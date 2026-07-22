import type {
  AgentMeta,
  AgentReport,
  AgentResult,
  CanonicalForwardSnapshot,
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
  PbrBand,
  ReportLanguage,
  ReportTone,
  RimBreakdown,
  SectionDef,
  SectionId,
  SentenceClassification,
  TargetTile,
  CashFlowInsight,
  ValuationDeepDive,
  ValuationModel,
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
  valuation_analyst: { categoryKo: '기술 및 분석', categoryEn: 'Technical & Analysis', nameKo: '가치평가 분석가', nameEn: 'Valuation Analyst' },
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

// %·배·통화 토큰에 더해, PER 6.2 / ROIC 21.4 처럼 지표 라벨 뒤 배수도 칩으로 강조한다
// (하이라이트 유무 비일관 해소 — 뒤에 %·배 등 단위가 붙으면 기존 분기가 우선 매칭).
// 지표명 뒤 배수는 콤마 자릿수 그룹까지 통째로 매칭한다 — "EPS 393,030.8"이
// "[393]" + ",030.8"로 쪼개지지 않도록 한다. 부정 lookahead는 "미소비 자릿수(,\d)"만
// 거부하고 문장 구두점 콤마("41.1, ")는 허용해야 "41.1"이 "41"로 백트래킹되지 않는다.
const DATA_TOKEN_PATTERN = /(\$\d[\d,]*(?:\.\d+)?[BMK]?|\d[\d,]*(?:\.\d+)?\s?(?:%|배|x|X|B|M|K)|-\d[\d,]*(?:\.\d+)?%|(?<=\b(?:PER|PBR|PSR|ROE|ROIC|WACC|EPS|EV\/EBITDA)\s{0,2})-?\d{1,4}(?:,\d{3})*(?:\.\d+)?(?![%배xXBMK\d]|,\d))/g;

const LABEL_CANDIDATES: Array<{ pattern: RegExp; ko: string; en: string }> = [
  { pattern: /신뢰도|confidence|컨센서스\s*신뢰/i, ko: '신뢰도', en: 'Confidence' },
  // '선행 PER'·'TTM PER'는 한글 표기라 아래 forward/trailing p/e 영어 패턴에 안 걸린다.
  // 결론 카드의 "선행 PER 4.5 … TTM PER 39.5"가 '값 N'으로 표기되던 문제.
  { pattern: /선행\s*PER|선행\s*P\/?E|fwd\s*per/i, ko: '선행 PER', en: 'Fwd P/E' },
  { pattern: /TTM\s*PER|TTM\s*P\/?E/i, ko: 'TTM PER', en: 'TTM P/E' },
  { pattern: /ROIC|투하자본/i, ko: 'ROIC', en: 'ROIC' },
  { pattern: /FCF\s*수익률|free cash flow yield|fcf yield/i, ko: 'FCF 수익률', en: 'FCF yield' },
  // Interest-bearing debt/equity (debt_to_equity field). Must precede the plain
  // 부채비율 candidate so "이자부채비율 14%" is never mislabeled as the Korean-
  // convention 부채비율 (total liabilities/equity).
  { pattern: /이자부채비율|debt-to-equity|D\/E/i, ko: '이자부채비율', en: 'Debt/Equity (int-bearing)' },
  { pattern: /부채비율/i, ko: '부채비율', en: 'Debt ratio' },
  { pattern: /내재가치|intrinsic value|fair value/i, ko: '1주당 내재가치', en: 'Intrinsic value' },
  // P/E ratio labels before the generic '현재가' so "Price-to-Earnings" context matches here first
  { pattern: /forward.*p\/?e|포워드.*p\/?e|forward per/i, ko: '포워드 P/E', en: 'Forward P/E' },
  { pattern: /trailing.*p\/?e|트레일링.*p\/?e/i, ko: '트레일링 P/E', en: 'Trailing P/E' },
  { pattern: /forward.*eps|전망.*eps|컨센.*eps|다음.*eps|선행.*eps/i, ko: '선행 EPS', en: 'Forward EPS' },
  { pattern: /ttm.*eps|trailing.*eps/i, ko: 'TTM EPS', en: 'TTM EPS' },
  // Narrowed: require a qualifier before 'price' so "Price-to-Earnings" won't match here
  { pattern: /현재가|주가\s*수준|share\s*price|stock\s*price|market\s*price|current\s*price/i, ko: '현재가', en: 'Current price' },
  { pattern: /안전마진|margin of safety/i, ko: '안전마진', en: 'Margin of safety' },
  { pattern: /wacc|discount rate|할인율/i, ko: 'WACC', en: 'WACC' },
  { pattern: /성장률|growth rate|growth/i, ko: '성장률', en: 'Growth' },
  { pattern: /이자보상|interest coverage/i, ko: '이자보상배율', en: 'Interest coverage' },
  { pattern: /베타|beta/i, ko: '베타', en: 'Beta' },
  { pattern: /시가총액|market cap/i, ko: '시가총액', en: 'Market cap' },
  { pattern: /매출|revenue/i, ko: '매출', en: 'Revenue' },
  { pattern: /영업이익|operating income/i, ko: '영업이익', en: 'Operating income' },
  // 제네릭 지표명 — 위의 구체 라벨(선행/TTM/포워드 등)이 먼저·우선 매칭되고, 없을 때만 쓴다.
  // DATA_TOKEN이 값을 뽑는 컨텍스트(PBR/PSR/ROE/EV\/EBITDA/EPS/PER 바로 뒤)에 이름을 붙여
  // "값 N" 표기를 최소화한다("최대한 그 값의 이름을 표기").
  { pattern: /\bPBR\b|주가\s*순자산|price[- ]?to[- ]?book|\bP\/?B\b/i, ko: 'PBR', en: 'PBR' },
  { pattern: /\bPSR\b|주가\s*매출|price[- ]?to[- ]?sales|\bP\/?S\b/i, ko: 'PSR', en: 'PSR' },
  { pattern: /\bROE\b|자기자본이익률/i, ko: 'ROE', en: 'ROE' },
  { pattern: /EV\s*\/\s*EBITDA|이브이\s*에비타/i, ko: 'EV/EBITDA', en: 'EV/EBITDA' },
  { pattern: /\bEPS\b|주당\s*순이익/i, ko: 'EPS', en: 'EPS' },
  { pattern: /\bPER\b|\bP\/?E\b|주가\s*수익비율/i, ko: 'PER', en: 'P/E' },
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

// 헤드라인 결론의 단일 진실원천. 표시 중인 에이전트의 신호가 종합점수 밴드와 반대 방향이면
// 종합점수 밴드 결론(라벨 포함)을 그대로 사용해 한 화면 안의 신호↔점수 모순을 없앤다.
export function resolveHeadlineVerdict(
  signal: unknown,
  compositeScore: number | null | undefined,
  language: ReportLanguage,
): { kind: 'buy' | 'sell' | 'hold' | 'on_hold'; label: string | null } {
  const tone = getSignalTone(signal);
  const normalized = String(signal ?? '').toLowerCase().trim();
  const kind: 'buy' | 'sell' | 'hold' | 'on_hold' =
    tone === 'bullish' ? 'buy'
      : tone === 'bearish' ? 'sell'
        : ['neutral', 'hold'].includes(normalized) ? 'hold' : 'on_hold';

  const score = typeof compositeScore === 'number' && Number.isFinite(compositeScore) ? compositeScore : null;
  if (score === null) return { kind, label: null };
  const band = getScoreBand(score, language);
  if (band.tone !== 'neutral' && tone !== 'neutral' && band.tone !== tone) {
    return { kind: band.tone === 'bullish' ? 'buy' : 'sell', label: band.label };
  }
  return { kind, label: null };
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

export interface PbrTrend {
  direction: 'up' | 'down' | 'flat';
  pctChange: number;
  pctText: string;
  label: string;
  icon: '↑' | '↓' | '→';
  tone: string;
  windowText: string;
}

export function computePbrTrend(
  history: Array<{ period: string; pbr: number }>,
  language: ReportLanguage = 'ko',
): PbrTrend | null {
  if (!history || history.length < 4) return null;

  const n = history.length;
  const half = Math.floor(n / 2);
  const recent = history.slice(0, half).map(item => item.pbr).filter(Number.isFinite);
  const older = history.slice(half).map(item => item.pbr).filter(Number.isFinite);
  if (recent.length === 0 || older.length === 0) return null;

  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const recentAvg = average(recent);
  const olderAvg = average(older);
  if (!Number.isFinite(recentAvg) || !Number.isFinite(olderAvg) || olderAvg === 0) return null;

  const pctChange = (recentAvg - olderAvg) / olderAvg;
  const direction: PbrTrend['direction'] = pctChange > 0.05
    ? 'up'
    : pctChange < -0.05
      ? 'down'
      : 'flat';

  return {
    direction,
    pctChange,
    pctText: `${pctChange > 0 ? '+' : ''}${(pctChange * 100).toFixed(0)}%`,
    label: language === 'ko'
      ? (direction === 'up' ? '상승국면' : direction === 'down' ? '하락국면' : '횡보')
      : (direction === 'up' ? 'Uptrend' : direction === 'down' ? 'Downtrend' : 'Sideways'),
    icon: direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→',
    tone: direction === 'up'
      ? 'text-emerald-500'
      : direction === 'down'
        ? 'text-red-500'
        : 'text-muted-foreground',
    windowText: language === 'ko' ? `${n}분기` : `${n}q`,
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

    const nestedDetailLines = Object.entries(record)
      .map(([key, value]) => {
        if (!value || typeof value !== 'object') return '';
        const nested = value as Record<string, unknown>;
        const detail = extractReasoningText(nested.details || nested.summary || nested.explanation).trim();
        if (!detail) return '';
        return `### ${key.replace(/_/g, ' ')}\n${detail}`;
      })
      .filter(Boolean);
    if (nestedDetailLines.length > 0) return nestedDetailLines.join('\n\n');

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

export function hasRenderableAgentReport(report: AgentReport | null | undefined): boolean {
  if (!report) return false;

  const reasoning = normalizeFinancialDisplayText(extractReasoningText(report.reasoning || report)).trim();
  if (reasoning.length >= 12) return true;

  const structured = report.structured_view || report.sections;
  if (!structured || typeof structured !== 'object') return false;
  return Object.values(structured as Record<string, unknown>).some(value => (
    typeof value === 'string' && stripMarkdownNoise(value).length >= 12
  ));
}

function getRenderableReportForAgent(
  completeResult: CompleteResult | undefined,
  agentKey: string,
  ticker: string,
  agentResult?: AgentResult,
): AgentReport | null {
  const report = getAgentReport(completeResult?.analyst_signals, agentKey, ticker, agentResult);
  return hasRenderableAgentReport(report) ? report : null;
}

export function findFirstRenderableAgentKey(
  completeResult: CompleteResult | undefined,
  activeAgentKey: string,
  ticker: string,
  agentResults?: Map<string, AgentResult>,
): string {
  const activeReport = getRenderableReportForAgent(
    completeResult,
    activeAgentKey,
    ticker,
    agentResults?.get(activeAgentKey),
  );
  if (activeReport && isNarrativeAgentKey(activeAgentKey)) return activeAgentKey;

  const entries = agentResults
    ? Array.from(agentResults.entries()).filter(([key, result]) => (
      result.status === 'complete'
      && isNarrativeAgentKey(key)
      && (!result.ticker || normalizeTicker(result.ticker) === normalizeTicker(ticker))
    ))
    : [];
  for (const [key, result] of entries) {
    if (getRenderableReportForAgent(completeResult, key, ticker, result)) return key;
  }

  for (const [key, value] of Object.entries(completeResult?.analyst_signals || {})) {
    const baseKey = stripSuffix(key);
    if (!isNarrativeAgentKey(baseKey)) continue;
    const report = pickTickerReport(value, ticker);
    if (hasRenderableAgentReport(report)) return key;
  }

  return activeAgentKey;
}

export function pickDefaultAgent(agentResults: Map<string, AgentResult>, activeTicker: string): string {
  // risk_management nodes expose portfolio limit metrics, not analyst narrative text.
  const completeForTicker = Array.from(agentResults.entries()).filter(([key, result]) => (
    result.status === 'complete'
    && isNarrativeAgentKey(key)
    && (!result.ticker || normalizeTicker(result.ticker) === normalizeTicker(activeTicker))
  ));
  const renderableForTicker = completeForTicker.find(([key, result]) => (
    hasRenderableAgentReport(getAgentReport(undefined, key, activeTicker, result))
  ));
  if (renderableForTicker) return renderableForTicker[0];

  const complete = completeForTicker.length > 0
    ? completeForTicker
    : Array.from(agentResults.entries()).filter(([key, result]) => (
      result.status === 'complete' && isNarrativeAgentKey(key)
    ));
  const renderable = complete.find(([key, result]) => (
    hasRenderableAgentReport(getAgentReport(undefined, key, activeTicker, result))
  ));
  if (renderable) return renderable[0];

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

function inferDirectionalToneFromText(text: string): ReportTone {
  const source = text.toLowerCase();
  const bearish = (source.match(/약세|매도|비중\s*축소|부정|위험|리스크|고평가|취약|bearish|sell|reduce|downside|negative|risk|overvalued/giu) || []).length;
  const bullish = (source.match(/강세|매수|긍정|상승|저평가|양호|bullish|buy|upside|positive|undervalued|strong/giu) || []).length;
  if (bearish > bullish) return 'bearish';
  if (bullish > bearish) return 'bullish';
  return 'neutral';
}

function buildConciseConclusion(
  report: AgentReport,
  sections: NormalizedReport,
  reasoning: string,
  language: ReportLanguage,
) {
  const parts: string[] = [];
  const conf = normalizeConfidence(report.confidence);
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
  const conclusionContext = [existingConclusion, valuation, multiples, risks].filter(Boolean).join(' ');
  const signalTone = getSignalTone(report.signal);
  const conclusionTone = inferDirectionalToneFromText(conclusionContext);
  const hasDirectionalConflict = signalTone !== 'neutral'
    && conclusionTone !== 'neutral'
    && signalTone !== conclusionTone;

  if (report.signal && !hasDirectionalConflict) {
    parts.push(
      `${signalToVerdict(String(report.signal), language)}${conf !== null ? ` (${language === 'ko' ? '신뢰도' : 'confidence'} ${conf}%)` : ''}`,
    );
  }

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
    // 닫는 괄호가 빠진 손상 마커("[?선행…", "[+매출…")를 복구한다 — 그대로 두면
    // 마커로 인식되지 않아 제목이 만들어지지 않는다(제목 누락).
    .replace(/\[([+\-~?])(?=[^\]\s])/gu, '[$1] ')
    // Restore breaks before inline headings and verdict markers produced by dense model output.
    // [?](검증 조건)는 분리하지 않는다 — 선행 문장("아래 중 하나가 확인돼야...")의 목록이므로
    // 부모 카드에 붙여야 본문이 유실되지 않는다.
    .replace(/([^\n])\s+(?=#{2,3}\s+)/gu, '$1\n\n')
    // "- [+] …"처럼 하이픈 불릿 뒤에 마커가 오면 하이픈까지 삼켜서 분리한다.
    // 하이픈을 남기면 "-" 하나만 든 고아 블록(빈 카드)이 생긴다.
    .replace(/(?:\s+[-*•])?\s+(?=(?:\d+[.)]\s+)?\[[+\-~]\])/gu, '\n\n')
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
    .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s*)/u, '')
    .trim();
  // "### 다운사이드 시나리오(…)"처럼 콜론 없는 헤딩도 본문과 붙인다 —
  // 그대로 두면 제목만 있고 본문이 빈 카드가 된다.
  return /^\[[+\-~?]\]\s*[^.!?。？！\n]{2,90}[:：]\s*$/u.test(clean)
    || /^#{2,3}\s*[^.!?。？！\n]{2,90}[:：]?\s*$/u.test(clean);
}

function mergeOrphanEvidenceHeadings(blocks: string[]) {
  const merged: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (next && isOrphanEvidenceHeading(block)) {
      // 다음 블록이 자체 마커([+]/[-]/[~]/[?])를 가지면 병합하지 않는다 — 병합하면
      // "핵심 근거 [+] 매출…"처럼 마커가 문장 중간에 묻혀 제목 인식이 깨진다.
      // 소제목("### 핵심 근거")은 그대로 두면 빈 카드 필터가 제거한다.
      const nextStartsWithMarker = /^\s*(?:[-*•]\s+|\d+[.)]\s*)?\[[+\-~?]\]/u.test(next);
      if (!nextStartsWithMarker) {
        merged.push(`${block} ${next}`);
        index += 1;
        continue;
      }
      // 다음이 마커 카드면 소제목은 목차와 중복이므로 버린다(본문으로 새어나오지 않게).
      continue;
    }
    merged.push(block);
  }
  return merged;
}

// 모델이 같은 문장을 두 번 이어 쓴 경우("…낮습니다. …낮습니다.") 한 번만 남긴다.
// 소수점(6.2)의 마침표는 문장 경계로 보지 않는다 — 잘게 쪼개지면 중복 감지 임계(20자)에 못 미친다.
function dedupeRepeatedSentences(text: string): string {
  const sentences = text.match(/(?:[^.!?。？！]|(?<=\d)\.(?=\d))+[.!?。？！]?\s*/gu);
  if (!sentences || sentences.length < 2) return text;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.replace(/\s+/g, ' ').trim();
    if (key.length >= 20) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(sentence);
  }
  return kept.join('');
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
    body: dedupeRepeatedSentences(body),
    tone: classifyItemTone(clean),
    citationLetters: [],
  };
}

function isMarkerOnlyEvidenceText(text: string) {
  const clean = text
    .replace(/^\s*\[[+\-~?]\]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 숫자 번호·구두점·불릿 기호만 남은 블록은 내용이 없는 고아 조각이다("2.", "2.3.", "..", "•").
  return /^(?:\d+[.)]?\s*)+$|^[.)\-–—·•]+$/u.test(clean);
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
  const bodyBlank = body.length === 0 || isMarkerOnlyEvidenceText(body) || isHeadingOnlyEvidenceText(body);
  // 본문이 비어도 제목이 실질 내용(핵심문구)이면 카드를 유지한다 — 단문 근거 카드는
  // splitLeadSentenceHeading이 문장을 제목으로 올리고 본문을 비우므로 여기서 지우면 안 된다.
  const heading = (item.heading || '').replace(/\s+/g, ' ').trim();
  const headingBlank = heading.length === 0
    || isMarkerOnlyEvidenceText(heading)
    || isHeadingOnlyEvidenceText(heading);
  return bodyBlank && headingBlank;
}

// 목차(섹션) 간 반복 문장 제거: 모델이 같은 근거 문장을 여러 목차에 재서술해
// 리포트의 26%가 중복되는 문제(실측). 섹션 순서대로 문장 지문을 누적해,
// 앞 목차에 이미 나온 30자 이상 문장은 뒤 목차에서 지운다(첫 등장 위치에만 남음).
// 짧은 수치 병기 문장(<30자)과 마커/헤딩은 보존되고, 문장이 모두 지워져 빈
// 카드가 되면 기존 isBlankEvidenceItem 필터가 카드째 제거한다.
export function dedupeSentencesAcrossSections(sectionTexts: string[]): string[] {
  const seen = new Set<string>();
  // 지문 계산 시 선두 마커([+]/###/번호)와 짧은 헤딩("결론:", "[+] 근거:")을 벗긴다 —
  // 같은 본문이 목차마다 다른 헤딩을 달고 반복되는 패턴을 잡기 위함.
  const fingerprint = (sentence: string) => sentence
    .replace(/^\s*(?:#{2,3}\s+|[-*•]\s+|\d+[.)]\s*|\[[+\-~?]\]\s*)+/u, '')
    .replace(/^[^:：.!?。]{0,40}[:：]\s*/u, '')
    .replace(/\s+/g, '')
    .trim();
  return sectionTexts.map(text => {
    if (!text) return text;
    const sentences = text.match(/(?:[^.!?。？！]|(?<=\d)\.(?=\d))+[.!?。？！]?\s*/gu);
    if (!sentences || sentences.length < 2) return text;
    const kept: string[] = [];
    for (const sentence of sentences) {
      const key = fingerprint(sentence);
      if (key.length >= 30) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      kept.push(sentence);
    }
    return kept.join('');
  });
}

// 선행/TTM PER 격차 비교("선행 PER 4.x < TTM PER 39.5")가 중립·약세 등 여러 섹션에
// 반복 서술되는 문제 — 모델이 같은 데이터 포인트를 각 섹션에서 재서술한다. 한 종목의
// (선행 PER, TTM PER) 비교는 본질적으로 하나이므로, 그 비교를 담은 블록 중 "가장 상세한
// (긴)" 하나만 남기고 나머지는 제거한다. 요약(섹션 01)은 요지 반복이 정상이라 제외.
// (사용자 선택: "가장 상세한 1개만")
const PER_GAP_FWD = /선행\s*P(?:ER|\/?E)|forward\s*p\/?e|fwd\s*per/i;
const PER_GAP_TTM = /TTM\s*P(?:ER|\/?E)|trailing\s*p\/?e/i;
const PER_GAP_BLOCK_SPLIT = /(\n{2,}|\n(?=\s*(?:#{2,3}\s+|\d+[.)]|[-*•]\s+|\[[+\-~]\])))/u;

export function dedupePerGapComparisons(sectionTexts: string[]): string[] {
  const isPerGapBlock = (block: string) =>
    Boolean(block) && PER_GAP_FWD.test(block) && PER_GAP_TTM.test(block);

  const parts = sectionTexts.map(text => (text ? text.split(PER_GAP_BLOCK_SPLIT) : []));
  const candidates: Array<{ s: number; b: number; len: number }> = [];
  parts.forEach((arr, s) => {
    if (s === 0) return; // 결론 요약(섹션 01)은 보존
    for (let b = 0; b < arr.length; b += 2) { // 짝수 인덱스 = 블록, 홀수 = 구분자
      if (isPerGapBlock(arr[b])) candidates.push({ s, b, len: arr[b].trim().length });
    }
  });
  if (candidates.length <= 1) return sectionTexts; // 반복 없음 → 그대로

  // 가장 상세한(긴) 블록을 keeper로, 같은 비교의 나머지 블록은 제거
  const keeper = candidates.reduce((a, c) => (c.len > a.len ? c : a));
  const remove = new Set(candidates.filter(c => c !== keeper).map(c => `${c.s}:${c.b}`));
  if (remove.size === 0) return sectionTexts;

  return sectionTexts.map((text, s) => {
    if (!text || s === 0) return text;
    const arr = parts[s];
    let changed = false;
    for (let b = 0; b < arr.length; b += 2) {
      if (remove.has(`${s}:${b}`)) { arr[b] = ''; changed = true; }
    }
    return changed ? arr.join('') : text;
  });
}

export function parseEvidenceItems(sectionText: string): EvidenceItem[] {
  const normalized = prepareEvidenceLayoutText(sectionText);
  if (!normalized) return [];

  const rawBlocks = normalized
    .split(/\n{2,}|\n(?=\s*(?:#{2,3}\s+|\d+[.)]|[-*•]\s+|\[[+\-~]\]))/u)
    .map(item => item.trim())
    .filter(Boolean);

  const source = (rawBlocks.length > 0 ? mergeOrphanEvidenceHeadings(rawBlocks) : [normalized])
    .flatMap(splitLongEvidenceBlock);

  const items = source
    .map(buildEvidenceItem)
    .filter((item): item is EvidenceItem => !isBlankEvidenceItem(item));

  return sortEvidenceItemsByTone(items);
}

// 근거 카드를 강세 → 중립 → 약세 순으로 정렬해 방향별로 순차 보고한다.
// '결론' 카드는 섹션의 요지이므로 톤과 무관하게 항상 맨 앞에 고정.
// 같은 톤 안에서는 원문 순서를 보존(안정 정렬).
const EVIDENCE_TONE_ORDER: Record<ReportTone, number> = { bullish: 0, neutral: 1, bearish: 2 };

export function sortEvidenceItemsByTone(items: EvidenceItem[]): EvidenceItem[] {
  const rank = (item: EvidenceItem) =>
    (item.heading ?? '').trim().startsWith('결론') ? -1 : (EVIDENCE_TONE_ORDER[item.tone] ?? 1);
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.order - b.order)
    .map(({ item }) => item);
}

export function classifyItemTone(itemText: string): ReportTone {
  const text = itemText.toLowerCase();
  const bear = (text.match(/bearish|sell|downside|negative|risk|overvalued|약세|매도|부정|위험|리스크|고평가|취약|부담|하락|둔화|악화|불확실/g) || []).length;
  const bull = (text.match(/bullish|buy|upside|positive|undervalued|strong|강세|매수|긍정|상승|저평가|양호|우위|호조|증가|개선|확장|회복/g) || []).length;
  // 강세·약세 근거가 모두 짙게 섞인 항목은 마커가 있어도 한 방향으로 단정하지 않는다.
  // 예: "[-] 괴리 리스크… 다만 선행 PER < TTM PER은 이익 확장 신호" → 혼합 → 중립
  const isMixed = bull >= 2 && bear >= 2;

  // 1) 명시적 마커가 최우선([?]는 검증 조건이므로 중립) — 단, 혼합 신호면 중립으로 강등
  if (/^\s*\[-\]/.test(text)) return isMixed ? 'neutral' : 'bearish';
  if (/^\s*\[\+\]/.test(text)) return isMixed ? 'neutral' : 'bullish';
  if (/^\s*\[[~?]\]/.test(text)) return 'neutral';
  // 2) 명시적 결론 단어(관망/중립/보류)는 방향 키워드보다 우선.
  //    "'확신 매수'로 가기엔 불리 → 관망" 같은 부정 문맥이 강세로 새는 것을 막는다.
  if (/관망|중립|보류|neutral|\bhold\b/.test(text)) return 'neutral';
  // 3) 방향 키워드 가중 집계 — 한쪽이 우세할 때만 방향 판정, 혼합·동률이면 중립
  if (isMixed) return 'neutral';
  if (bear > bull) return 'bearish';
  if (bull > bear) return 'bullish';
  return 'neutral';
}

// 모델이 강조(**)를 문장 중간에서 잘못 닫으면(예: "**…낮음(Confidence** low)으로…")
// 제목이 문장 조각("…(Confidence")이 되고 본문이 그 뒤를 잇는 파편("low)으로…")이 된다.
// 이런 '문장 중간 끊김'을 감지해 강조를 제목 경계로 인정하지 않는다.
function looksLikeMidSentenceBoldSplit(heading: string, body: string): boolean {
  if (!body) return false;
  // 여는 괄호가 제목에서 안 닫히고 본문으로 넘어감 → 한 구(句)가 갈렸다는 신호
  const opens = (heading.match(/[(（[]/gu) || []).length;
  const closes = (heading.match(/[)）\]]/gu) || []).length;
  if (opens > closes) return true;
  // 본문이 소문자 라틴·닫는 괄호로 시작 → 앞 제목 단어의 연속("Confidence" + "low)")
  if (/^[a-z)\]）]/u.test(body)) return true;
  // 본문이 한국어 조사/연결어미로 시작 → 앞 제목의 문법적 연속(완결된 제목이 아님)
  if (/^(?:으로|은|는|이|가|을|를|와|과|의|에서|에게|보다|처럼|만큼|까지|부터|이며|하며|이고|라고|지만|면서)\b/u.test(body)) return true;
  return false;
}

export function extractItemHeading(itemText: string): { heading: string | null; body: string } {
  const normalizedItemText = normalizeFinancialDisplayText(itemText);
  const bold = normalizedItemText.match(/^\*\*([^*]{2,80})\*\*:?\s*(.*)$/su);
  if (bold) {
    const boldHeading = bold[1].trim();
    const boldBody = bold[2].trim();
    if (!looksLikeMidSentenceBoldSplit(boldHeading, boldBody)) {
      return { heading: boldHeading, body: boldBody };
    }
    // 잘못 닫힌 강조: 마커만 제거하고 한 문장으로 이어 붙인 뒤 정상 경계에서 분리
    const merged = normalizedItemText.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return splitLeadSentenceHeading(merged);
  }

  // 결론 카드: "→보유·중립 (신뢰도 52%) · 실제 결론…"에서 판정을 볼드 제목으로 올린다.
  // (긴 결론 문단이라 첫 문장 제목화가 안 걸려 제목이 비던 문제)
  const verdict = normalizedItemText.match(
    /^\s*[→↑↓]?\s*((?:강력\s*)?(?:매수|매도)|보유(?:\s*·\s*중립)?|중립|관망|비중\s*축소|매수\s*·\s*강세|매도\s*·\s*약세)\s*(\([^)]*\))?\s*·\s+(.+)$/su,
  );
  if (verdict) {
    const heading = `${verdict[1].replace(/\s+/g, ' ').trim()}${verdict[2] ? ` ${verdict[2].trim()}` : ''}`;
    return { heading, body: verdict[3].trim() };
  }

  const colon = normalizedItemText.match(/^([^:：]{2,42})[:：]\s+(.+)$/su);
  if (colon) return { heading: colon[1].replace(/^\[[+\-~?]\]\s*/u, '').trim(), body: colon[2].trim() };

  const marker = normalizedItemText.match(/^\[[+\-~?]\]\s*(.+)$/su);
  if (marker) {
    const bodyText = marker[1].trim();
    if (/[:：]\s*$/u.test(bodyText)) {
      return { heading: bodyText.replace(/[:：]\s*$/u, '').trim(), body: '' };
    }
    return splitLeadSentenceHeading(bodyText);
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
      // 비교격 조사 '보다'(예: "39.5보다 낮습니다")는 서술어 종결이 아니므로
      // 제목/본문 경계로 삼지 않는다 — 한 문장이 "…보다"에서 잘려 제목이
      // 문장 조각이 되던 문제. 뒤 서술어까지 이어져야 완결된 제목이 된다.
      const word = (text.slice(0, index + 1).match(/[가-힣]+$/u) || [''])[0];
      if (/보다$/u.test(word)) continue;
      return index + 1;
    }
  }
  return -1;
}

// 근거 카드의 첫 문장을 '핵심 문구' 제목(볼드, 톤 배지 옆)으로 올리고, 그 문장을
// 본문에서 제거한 나머지만 본문(일반 굵기)으로 남긴다. 이렇게 해야:
//  (1) 단문 카드의 제목=본문 중복이 사라지고(본문이 비워짐)
//  (2) 다문장 카드는 볼드 핵심문구 + 일반 이어지는 문구로 굵기 구분이 살고
//  (3) 모든 마커 카드가 제목을 갖는다(제목 누락 방지).
function splitLeadSentenceHeading(bodyText: string): { heading: string | null; body: string } {
  const clean = bodyText.replace(/\s+/g, ' ').trim();
  if (!clean) return { heading: null, body: '' };
  const boundary = findSafeHeadingBoundary(clean);
  const stripTail = (s: string) => s.replace(/[.!?。？！]\s*$/u, '').trim();

  // 단일 문장: 문장 자체가 핵심문구 → 제목으로만, 본문은 비운다(중복 방지)
  if (boundary <= 0 || boundary >= clean.length) {
    const only = stripTail(clean);
    return only.length <= 90 ? { heading: only, body: '' } : { heading: null, body: clean };
  }

  // 다문장: 첫 문장 = 제목, 나머지 = 본문
  const heading = stripTail(clean.slice(0, boundary));
  const body = clean.slice(boundary).trim();
  if (!heading || heading.length > 90) return { heading: null, body: clean };
  return { heading, body };
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
  // DART는 autoSearch=true + option=corp가 있어야 종목코드로 자동 검색이 실행된다.
  // (파라미터 없이 textCrpNm만 주면 검색이 실행되지 않아 빈 검색 화면이 뜬다 — 실검증 완료)
  const reportHref = isKoreanStock
    ? `https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&option=corp&textCrpNm=${encodeURIComponent(code)}`
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
      // KR 컨센서스의 실제 데이터 소스(FnGuide)의 해당 종목 페이지로 연결 — 실검증 완료.
      // US는 내부 데이터 API가 소스라 사용자용 확인 페이지가 없어 링크를 두지 않는다.
      href: isKoreanStock
        ? `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${encodeURIComponent(code)}`
        : null,
    },
    {
      letter: 'd',
      labelKo: 'WACC 추정 · Damodaran',
      labelEn: 'WACC · Damodaran',
      typeKo: '학술',
      typeEn: 'Academic',
      // 홈이 아니라 업종별 WACC 데이터 표 페이지로 직행 — 실검증 완료.
      href: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.htm',
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

// Unit guard: values ending in 배/x/X are multiples (P/E, PBR, etc.),
// never absolute prices. If a candidate label is a price/amount category,
// fall back to a generic label to avoid e.g. "현재가 30.06배".
const MULTIPLE_VALUE_PATTERN = /[\d.,]\s?(?:배|x|X)$/;
const PRICE_LABEL_KO = new Set(['현재가', '시가총액', '매출', '영업이익', '1주당 내재가치']);
const PRICE_LABEL_EN = new Set(['Current price', 'Market cap', 'Revenue', 'Operating income', 'Intrinsic value']);

const RATIO_PERCENT_LABEL_KO = new Set([
  'ROIC',
  'FCF 수익률',
  '부채비율',
  '이자부채비율',
  '안전마진',
  '성장률',
  'WACC',
]);
const RATIO_PERCENT_LABEL_EN = new Set([
  'ROIC',
  'FCF yield',
  'Debt ratio',
  'Debt/Equity (int-bearing)',
  'Margin of safety',
  'Growth',
  'WACC',
]);

function isMultipleValue(rawValue: string): boolean {
  return MULTIPLE_VALUE_PATTERN.test(rawValue.trim());
}

function isAbsoluteAmountLabel(label: string): boolean {
  return PRICE_LABEL_KO.has(label) || PRICE_LABEL_EN.has(label);
}

function isRatioPercentLabel(label: string): boolean {
  return RATIO_PERCENT_LABEL_KO.has(label) || RATIO_PERCENT_LABEL_EN.has(label);
}

export function extractKeyNumbers(
  itemText: string,
  language: ReportLanguage,
): KeyNumber[] {
  const results: KeyNumber[] = [];
  const usedLabels = new Set<string>();
  const usedValues = new Set<string>();
  DATA_TOKEN_PATTERN.lastIndex = 0;

  for (const match of itemText.matchAll(DATA_TOKEN_PATTERN)) {
    if (results.length >= 4) break;
    const value = match[0].trim();
    if (/^\d$/.test(value)) continue;
    // "12M 선행 컨센 EPS" 같은 기간 표기(3M/6M/12M)는 핵심 숫자가 아니다
    if (/^(?:3|6|12)\s?M$/.test(value)) continue;
    // 같은 숫자가 문장에 두 번 나와도 한 번만("TTM PER 39.5"가 두 번 → 값3·값4 중복 방지)
    const valueKey = value.replace(/\s+/g, '');
    if (usedValues.has(valueKey)) continue;

    // 라벨은 숫자 "바로 앞" 근접 텍스트에서만 인정한다. 넓은 창(±80자)은
    // 항목 안의 다른 지표명("다음분기 EPS…")을 엉뚱한 숫자에 붙이는 오표기를 만든다.
    const index = match.index ?? 0;
    const before = itemText.slice(Math.max(0, index - 28), index);

    let label: string;
    // 분기 태그가 붙은 EPS(예: "2025Q4 EPS 4,803")는 분기명을 라벨로 삼는다 — '값N'을 피하고,
    // 같은 'EPS' 라벨로 뭉쳐 두 분기 값 중 하나가 라벨 중복으로 버려지는 것도 막는다.
    const quarterEps = before.match(/((?:20)?\d{2}\s*Q\s*[1-4]|[1-4]\s*Q\s*(?:20)?\d{2})\s*EPS\s*$/i);
    if (quarterEps) {
      label = `${quarterEps[1].replace(/\s+/g, '').toUpperCase()} EPS`;
    } else {
      // 숫자에 "가장 가까운"(=before 끝에 근접한, 매칭 끝 위치가 가장 큰) 지표명을 고른다.
      // 끝 위치가 같으면 배열에서 먼저 나온(더 구체적인) 라벨이 이긴다.
      // 예: "신뢰도 52% … 선행 PER 4.5"의 4.5는 앞쪽 '신뢰도'가 아니라 인접한 '선행 PER'로.
      let candidate: (typeof LABEL_CANDIDATES)[number] | undefined;
      let bestPos = -1;
      for (const c of LABEL_CANDIDATES) {
        const m = before.match(c.pattern);
        if (m && m.index !== undefined) {
          const end = m.index + m[0].length;
          if (end > bestPos) {
            bestPos = end;
            candidate = c;
          }
        }
      }
      label = candidate ? (language === 'ko' ? candidate.ko : candidate.en) : (language === 'ko' ? `값 ${results.length + 1}` : `Value ${results.length + 1}`);
    }
    // Unit guard: 배/x/X values are multiples, never absolute prices
    // Unit guard: 배/x/X values are multiples, never absolute prices
    if (isMultipleValue(value) && (isAbsoluteAmountLabel(label) || isRatioPercentLabel(label))) {
      label = language === 'ko' ? `값 ${results.length + 1}` : `Value ${results.length + 1}`;
    }

    if (usedLabels.has(label)) continue;
    usedLabels.add(label);
    usedValues.add(valueKey);
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

function formatOneDecimalMultiple(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}` : null;
}

function buildForwardPeComparisonNote(
  fwd: string,
  ttm: string | null,
  snapshot: CanonicalForwardSnapshot,
  language: ReportLanguage,
) {
  if (!ttm || snapshot.ttmPer === null || snapshot.fwdPer === null) return null;
  if (snapshot.fwdPer < snapshot.ttmPer) {
    return language === 'ko'
      ? `선행 PER ${fwd}는 TTM PER ${ttm}보다 낮습니다. 컨센서스가 향후 EPS와 영업이익 개선을 반영한다는 뜻으로, 이를 “비싸졌다”는 신호로 해석하지 않습니다.`
      : `Forward P/E ${fwd} is below TTM P/E ${ttm}. Consensus is pricing future EPS / operating-income expansion, not valuation pressure.`;
  }
  return language === 'ko'
    ? `선행 PER ${fwd}는 TTM PER ${ttm}보다 높습니다. 컨센서스 기준 이익 개선 폭보다 가격 부담이 더 크다는 신호로 읽습니다.`
    : `Forward P/E ${fwd} is above TTM P/E ${ttm}. Valuation pressure exceeds the consensus earnings improvement.`;
}

// Developer-only tokens that LLMs sometimes echo from the system prompt.
// These must never reach the analyst-facing report.
const DEVELOPER_TOKEN_PATTERNS: Array<{ pattern: RegExp; ko: string; en: string }> = [
  // Strip standalone "canonical" English word when it precedes a Korean PER/EPS phrase
  // or English forward/per/eps/multiple — common LLM leak after FwdPER got replaced.
  { pattern: /\bcanonical\s+(?=(?:선행|포워드|컨센|forward|fwd|per|p\/?e|eps|standard|multiple|consensus|baseline|estimate|FwdPER))/gi, ko: '', en: '' },
  { pattern: /\bcanonical\s*FwdPER\b/gi, ko: '선행 PER', en: 'forward P/E' },
  { pattern: /\bcanonical_multiples(?:\.[a-z_]+)?/gi, ko: '표준 배수', en: 'standard multiples' },
  { pattern: /\bcanonical\s*forward\s*(?:p\/?e|per|eps)\b/gi, ko: '선행 컨센서스 추정', en: 'forward consensus estimate' },
  { pattern: /\bforward_outlook(?:\.[a-z_]+)*/gi, ko: '포워드 전망', en: 'forward outlook' },
  { pattern: /\bprice\s*compass(?:\s*기준)?(?:\s*(?:baseline|standard))?/gi, ko: '선행 컨센서스 기준', en: 'forward consensus baseline' },
  { pattern: /\b(?:the\s+)?only\s+canonical\s+FwdPER\s+shown\s+in\s+Price\s+Compass\b/gi, ko: '선행 컨센서스 기준 FwdPER', en: 'baseline forward P/E' },
  { pattern: /\braw\s*_?\s*spliced\s*_?\s*forward\s*_?\s*(?:pe|p\/?e|per)\b/gi, ko: '원천 분기 스플라이스', en: 'raw spliced forward P/E' },
  { pattern: /\bpe_change_pct\b/gi, ko: 'PER 변동률', en: 'P/E change' },
  { pattern: /\binterpretation_hint\b/gi, ko: '해석 메모', en: 'interpretation note' },
];

// Raw-value patterns: e.g. “( 36.05x vs 30.06x )” with no label nearby.
const RAW_PE_VS_BLOCK_PATTERN =
  /\(?\s*(-?\d{1,3}(?:[.,]\d+)?)\s*(?:x|X|배)\s*(?:vs|대비|보다)\s*(-?\d{1,3}(?:[.,]\d+)?)\s*(?:x|X|배)\s*\)?/gi;

// Tone-correction: drop incorrect “더 비싸진/비쌈” qualifiers when FwdPER < TTM.
const FALSE_EXPENSIVE_TONE_KO = /(?:이\s*있어|상태(?:라서|이라서|이며)?)\s*(?:더\s*)?(?:비싸|비싼|고평가|높|상승)[^.!?。？！\n]*[.!?。？！]?/gi;
// Inverted word-order: “비싸진/비싼/고평가(된) 상태(라서)” — verb-before-noun.
// Captures the entire short clause to drop subject+tone+causal-particle together.
const FALSE_EXPENSIVE_INVERTED_KO = /(?:포워드\s*PER이?\s*|선행\s*PER이?\s*|FwdPER이?\s*)?(?:더\s*)?(?:비싸진?|비싼|고평가(?:된)?)\s*상태(?:라서|이라서|이며)?\s*/gi;

// ── Investor-name normalization ─────────────────────────────────────────────
// The model spells the same person inconsistently across a report. Canonicalize
// the variants the analyst flagged so one report never shows two spellings.
// Stanley Druckenmiller → 드러켄밀러 (variants: 드루켄밀러 / 드러큰밀러 / 드러컨밀러).
function normalizeInvestorNames(text: string): string {
  return text.replace(/드\s*[러루]\s*[켄큰컨]\s*밀러/g, '드러켄밀러');
}

// ── Daily-volatility canonicalization ───────────────────────────────────────
// "%/d" daily-volatility figures are LLM narrative (no deterministic chip emits
// them), so the model often prints two different values in one report. The one
// true daily σ is the annualized realized σ divided by √252. Rewrite every
// "NN%/d" (or "NN%/일") occurrence to that single canonical value so body text
// and the extracted key-number chip always agree.
function normalizeDailyVolatility(
  text: string,
  snapshot: CanonicalForwardSnapshot | null | undefined,
): string {
  const sigmaAnnual = snapshot?.sigmaAnnual;
  if (typeof sigmaAnnual !== 'number' || !Number.isFinite(sigmaAnnual) || sigmaAnnual <= 0) {
    return text;
  }
  const dailyPct = (sigmaAnnual / Math.sqrt(252)) * 100;
  if (!Number.isFinite(dailyPct) || dailyPct <= 0) return text;
  const daily = dailyPct.toFixed(1);
  return text.replace(/(-?\d+(?:\.\d+)?)\s*%\s*\/\s*(?:d\b|일)/gi, `${daily}%/d`);
}

// ── Trailing (TTM) P/E canonicalization ─────────────────────────────────────
// Normalize every trailing-P/E mention — including the model's Korean metaphor
// "TTM 체력 NN" and the "PER(TTM) NN" / "P/E(TTM) NN" word order — to the single
// canonical TTM PER. Runs independently of forward-PE availability so it still
// fires for tickers that lack a forward P/E.
function normalizeTtmPerMentions(text: string, ttm: string): string {
  let next = text;
  // (a) "trailing/ttm P/E NN" or "TTM PER NN"
  next = next.replace(
    /\b(?:trailing|ttm)\s*(?:p\/?e|per)\s*(?:\([^)]+\)\s*)?\(?\s*(?:[:=]|(?:은|는|이|가|을|를))?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:x|배)?\s*\)?/giu,
    `TTM PER ${ttm}`,
  );
  // (b) Korean metaphor "TTM 체력 NN"
  next = next.replace(
    /\bTTM\s*체력\s*(?:[:=]|은|는|이|가)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:x|배)?/giu,
    `TTM PER ${ttm}`,
  );
  // (c) "PER(TTM) NN" / "P/E(TTM) NN" / "PER (TTM) NN" (label-before-qualifier)
  next = next.replace(
    /\b(?:p\/?e|per)\s*\(\s*ttm\s*\)\s*(?:[:=]|은|는|이|가)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:x|배)?/giu,
    `TTM PER ${ttm}`,
  );
  return next;
}

export function sanitizeForwardPeNarrative(
  text: string,
  snapshot: CanonicalForwardSnapshot | null | undefined,
  language: ReportLanguage,
): string {
  if (!text) return text;

  // ── Always-on passes (independent of forward-PE availability) ──────────────
  // These must run BEFORE the fwdPer early-return so they still fire for tickers
  // that have no forward P/E.
  let next = normalizeInvestorNames(text);
  next = normalizeDailyVolatility(next, snapshot);
  const ttm = formatOneDecimalMultiple(snapshot?.ttmPer);
  if (ttm) {
    next = normalizeTtmPerMentions(next, ttm);
  }

  if (!snapshot?.fwdPer || !Number.isFinite(snapshot.fwdPer)) return next;

  const fwd = formatOneDecimalMultiple(snapshot.fwdPer);
  if (!fwd) return next;

  // ── Pass 1: replace any “( A x vs B x )” block with the canonicalFwdPER ─────
  next = next.replace(RAW_PE_VS_BLOCK_PATTERN, (_match, _a, _b) => {
    return language === 'ko' ? ` 선행 PER ${fwd} ` : ` forward P/E ${fwd} `;
  });

  // ── Pass 2: existing labelled-PE replacement ────────────────────────────────
  next = next.replace(
    /\b(?:forward\s*p\/?e|fwd\s*p\/?e|fwdper|포워드\s*p\/?e|포워드\s*per)\s*(?:\((?:ttm|fy0|fy\+?1|현fy|current\s*fy)\)\s*)?\(?\s*(?:[:=]|(?:은|는|이|가|을|를))?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:x|배)?\s*\)?/giu,
    language === 'ko' ? `선행 PER ${fwd}` : `forward P/E ${fwd}`,
  );

  // (Trailing-P/E normalization already ran in the always-on block above.)

  // ── Pass 3: drop false-expensive tone when FwdPER < TTM ──────────────────────
  if (ttm && snapshot.ttmPer !== null && snapshot.fwdPer < snapshot.ttmPer) {
    if (language === 'ko') {
      // 1) Strip "포워드 PER이 비싸진 상태라서" inverted-order clause entirely
      next = next.replace(FALSE_EXPENSIVE_INVERTED_KO, '');
      // 2) Strip "상태라서 비싸" original-order clause
      next = next.replace(FALSE_EXPENSIVE_TONE_KO, '');
    }
    next = next.replace(/\b(?:more\s+expensive|valuation\s+pressure)\b/gi, 'consensus-driven');
  }

  // ── Pass 4: replace comparison sentences with the natural-language note ──────
  const mentionsForward = /선행 PER|forward\s*P\/?E|FwdPER/iu.test(next);
  const comparisonNote = buildForwardPeComparisonNote(fwd, ttm, snapshot, language);
  if (mentionsForward && comparisonNote) {
    const comparisonPattern = /[^.!?。？！\n]*(?:선행 PER|FwdPER|forward\s*p\/?e|fwd\s*p\/?e)[^.!?。？！\n]*(?:TTM PER|trailing\s*p\/?e|ttm\s*p\/?e|트레일링\s*p\/?e)[^.!?。？！\n]*[.!?。？！]?/giu;
    next = next.replace(comparisonPattern, comparisonNote);
  }

  // ── Pass 4b: drop "alternate forward-PER value + splice" asides ─────────────
  // There is exactly one investor-facing 선행 PER. The model sometimes still
  // leaks an internal cross-check such as
  //   "전방 PER의 다른 산출값 (24.4)과 스플라이스 정보가 함께 존재해, …"
  // which only confuses the reader. Strip the alternate-value / splice clause
  // while leaving the surrounding (valid) sentence intact.
  next = next
    .replace(
      /(?:,\s*)?(?:또한\s*)?(?:기록에\s*따르면\s*)?(?:전방|선행)?\s*P(?:ER|\/?E)?의?\s*다른\s*산출값\s*\([^)]*\)\s*(?:(?:과|와)\s*스플라이스\s*정보가?\s*함께\s*존재[^,.!?。\n]*)?[,，]?/giu,
      '',
    )
    .replace(
      /(?:,\s*)?(?:또한\s*)?(?:기록에\s*따르면\s*)?스플라이스\s*정보가?\s*함께\s*존재[^,.!?。\n]*[,，]?/giu,
      '',
    )
    .replace(/\ban?\s+alternate\s+forward\s+p\/?e[^,.!?\n]*[,.]?/gi, '')
    .replace(/[,，]?\s*(?:also\s+)?(?:per\s+the\s+record\s+)?spliced?\s+(?:value|figure|data)[^,.!?\n]*[,.]?/gi, '');

  // ── Pass 5: strip developer tokens (Price Compass / canonical / etc.) ────────
  for (const { pattern, ko, en } of DEVELOPER_TOKEN_PATTERNS) {
    next = next.replace(pattern, language === 'ko' ? ko : en);
  }

  // ── Pass 6: insert missing spaces between concatenated Korean tokens ────────
  // e.g. "선행 컨센서스 기준선행 PER" → "선행 컨센서스 기준 선행 PER"
  //      "라서선행 PER" → "라서 선행 PER"
  next = next.replace(/(기준|배수|전망|메모|추정|스플라이스|변동률|라서|이라서|이며)(?=(?:선행|포워드|컨센|FwdPER|forward|fwd|TTM|trailing|P\/?E|PER))/g, '$1 ');
  // also handle leading whitespace lost after stripping
  next = next.replace(/([가-힣A-Za-z0-9])\s*\(\s*-?\d/g, (match, prefix) => match.startsWith(' ') ? match : `${prefix} ${match.slice(prefix.length).trimStart()}`);

  // collapse double spaces / orphan particles caused by replacement
  next = next
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    // tidy leftover punctuation after stripping a clause (", ," / ". ," / "（ ,")
    .replace(/([,，])\s*([,，])/g, '$1')
    .replace(/([.!?。！？])\s*[,，]/g, '$1')
    .replace(/(^|[.!?。！？]\s*)[,，]\s*/g, '$1');

  // ── Pass 7: drop verbatim-duplicate sentences within the section ────────────
  next = dropDuplicateSentences(next);

  return next;
}

// Remove sentences that repeat verbatim earlier in the same section. Keeps the
// first occurrence and drops later exact duplicates so the narrative reads
// without the boilerplate echoes the model tends to emit. Short fragments
// (≤ 12 chars, e.g. list markers) are never deduplicated.
function dropDuplicateSentences(text: string): string {
  if (!text) return text;
  // Split at two kinds of zero-width boundaries:
  //   (a) right after sentence-ending punctuation that is followed by
  //       whitespace, and
  //   (b) at a newline → non-whitespace transition (paragraph / header edge).
  // Both are lookaround-only, so join('') reproduces the input exactly when
  // nothing is dropped. Because (a)'s lookahead requires whitespace, a period
  // inside a decimal (e.g. "30.0") is never a boundary, and every original
  // space/newline stays attached to the segment that follows it — so
  // parseEvidenceItems' newline-based block splitting keeps working after a
  // round-trip through this function.
  const parts = text.split(/(?<=[.!?。！？])(?=\s)|(?<=\n)(?=\S)/u);
  if (parts.length < 2) return text;

  const seen = new Set<string>();
  const out: string[] = [];
  let dropped = false;
  for (const part of parts) {
    const key = part.replace(/\s+/g, ' ').trim();
    // Only dedupe full sentences (> 12 chars); short fragments such as list
    // markers or labels are always kept.
    if (key.length > 12 && seen.has(key)) {
      dropped = true;
      continue;
    }
    if (key.length > 12) seen.add(key);
    out.push(part);
  }
  if (!dropped) return text; // byte-exact round-trip when nothing was removed

  // Dropping a block leaves its separator behind (e.g. "\n\n" + "\n\n"). Tidy
  // the resulting whitespace artifacts; collapsing 3+ newlines to 2 is safe
  // because parseEvidenceItems treats any run of 2+ as one block boundary.
  return out
    .join('')
    .replace(/[ \t]*\n{3,}[ \t]*/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+$/g, '');
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number'
    ? v
    : Number(String(v).replace(/[,%$₩¥]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseValuationSignal(v: unknown): 'bullish' | 'neutral' | 'bearish' {
  if (v === 'bullish' || v === 'bearish') return v;
  return 'neutral';
}

function parseRimBreakdown(raw: Record<string, unknown>): RimBreakdown | null {
  const bookValue = safeNum(raw.book_value);
  if (bookValue === null || bookValue <= 0) return null;
  return {
    bookValue,
    bookValuePerShare: safeNum(raw.book_value_per_share),
    roeImplied: safeNum(raw.roe_implied) ?? 0,
    costOfEquity: safeNum(raw.cost_of_equity) ?? 0.10,
    spreadRoeKe: safeNum(raw.spread_roe_ke) ?? 0,
    bookValueGrowth: safeNum(raw.book_value_growth) ?? 0.03,
    presentValueRi: safeNum(raw.present_value_ri) ?? 0,
    terminalPvRi: safeNum(raw.terminal_pv_ri) ?? 0,
    intrinsicTotal: safeNum(raw.intrinsic_total) ?? bookValue,
    intrinsicPerShare: safeNum(raw.intrinsic_per_share),
    weightUsed: safeNum(raw.weight_used) ?? 0,
    signal: parseValuationSignal(raw.signal),
    details: safeStr(raw.details),
  };
}

function parsePbrBand(raw: Record<string, unknown>): PbrBand | null {
  const currentPbr = safeNum(raw.current_pbr);
  if (currentPbr === null) return null;
  const pcts = raw.percentiles as Record<string, unknown> | undefined;
  if (!pcts) return null;
  const p10 = safeNum(pcts.p10);
  const p25 = safeNum(pcts.p25);
  const p50 = safeNum(pcts.p50);
  const p75 = safeNum(pcts.p75);
  const p90 = safeNum(pcts.p90);
  if (p10 === null || p25 === null || p50 === null || p75 === null || p90 === null) return null;

  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map((item: unknown) => {
      const record = item as Record<string, unknown>;
      const pbr = safeNum(record.pbr);
      return pbr !== null ? { period: safeStr(record.period), pbr } : null;
    })
    .filter((item): item is { period: string; pbr: number } => item !== null);

  const posLabel = raw.position_label as string | undefined;
  const positionLabel = (
    posLabel === 'below_p25' || posLabel === 'p25_p50' ||
    posLabel === 'p50_p75' || posLabel === 'above_p75'
  ) ? posLabel : 'p50_p75';

  return {
    currentPbr,
    percentiles: { p10, p25, p50, p75, p90 },
    history,
    bvps: safeNum(raw.bvps),
    fairPriceP10: safeNum(raw.fair_price_p10),
    fairPriceP25: safeNum(raw.fair_price_p25),
    fairPriceP50: safeNum(raw.fair_price_p50),
    fairPriceP75: safeNum(raw.fair_price_p75),
    fairPriceP90: safeNum(raw.fair_price_p90),
    currentPrice: safeNum(raw.current_price),
    positionLabel,
    reratingNote: typeof raw.rerating_note === 'string' ? raw.rerating_note : null,
    weightUsed: safeNum(raw.weight_used) ?? 0,
    signal: parseValuationSignal(raw.signal),
    details: safeStr(raw.details),
  };
}

const MODEL_LABEL_MAP: Record<string, string> = {
  dcf: 'DCF',
  owner_earnings: 'Owner Earnings',
  ev_ebitda: 'EV/EBITDA',
  ev_ebit: 'EV/EBIT',
  ebitda_valuation: 'EBITDA (정규화)',
  roic_wacc_valuation: 'ROIC−WACC EVA',
  residual_income: 'RIM',
  pbr_band: 'PBR Band',
};

// Headline 1주당 내재가치 should track the DCF model's per-share value, not the
// regex-scraped narrative number, which drifts free of the actual model output.
export function extractValuationDcfPerShare(
  valuationReport: AgentReport | null,
): number | null {
  const rawReasoning = valuationReport?.reasoning;
  if (!rawReasoning || typeof rawReasoning !== 'object') return null;
  const reasoning = rawReasoning as Record<string, unknown>;
  const dcf = reasoning.dcf_analysis as Record<string, unknown> | undefined;
  if (!dcf || typeof dcf !== 'object') return null;
  return safeNum(dcf.intrinsic_per_share);
}

// Headline 1주당 내재가치: prefer the backend-computed headline per-share, which
// switches from the DCF value to the blended (non-outlier weighted-average)
// value whenever DCF is flagged as a low-confidence peer outlier. Falls back to
// the DCF per-share for older reports that predate the headline field.
export function extractValuationHeadlinePerShare(
  valuationReport: AgentReport | null,
): number | null {
  const rawReasoning = valuationReport?.reasoning;
  if (!rawReasoning || typeof rawReasoning !== 'object') {
    return extractValuationDcfPerShare(valuationReport);
  }
  const reasoning = rawReasoning as Record<string, unknown>;
  const headline = safeNum(reasoning.headline_intrinsic_per_share);
  if (headline !== null) return headline;
  return extractValuationDcfPerShare(valuationReport);
}

export function buildValuationDeepDive(
  valuationReport: AgentReport | null,
  currentPrice: number | null,
): ValuationDeepDive | null {
  const rawReasoning = valuationReport?.reasoning;
  if (!rawReasoning || typeof rawReasoning !== 'object') return null;
  const reasoning = rawReasoning as Record<string, unknown>;

  const rim = reasoning.rim_analysis && typeof reasoning.rim_analysis === 'object'
    ? parseRimBreakdown(reasoning.rim_analysis as Record<string, unknown>)
    : null;
  const pbr = reasoning.pbr_band_analysis && typeof reasoning.pbr_band_analysis === 'object'
    ? parsePbrBand(reasoning.pbr_band_analysis as Record<string, unknown>)
    : null;

  const models: ValuationModel[] = [];
  (['dcf', 'owner_earnings', 'ev_ebitda', 'ev_ebit', 'ebitda_valuation', 'roic_wacc_valuation', 'residual_income', 'pbr_band'] as const).forEach(key => {
    const raw = reasoning[`${key}_analysis`] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return;
    const intrinsicPerShare = safeNum(raw.intrinsic_per_share);
    const intrinsicTotal = safeNum(raw.intrinsic_total ?? raw.value);
    if (intrinsicPerShare === null && intrinsicTotal === null) return;
    let extraFields: Partial<ValuationModel> = {};
    if (key === 'ev_ebitda') {
      extraFields = {
        medianMultiple: safeNum(raw.median_multiple),
        currentMultiple: safeNum(raw.current_multiple),
        ebitdaNow: safeNum(raw.ebitda_now),
        netDebt: safeNum(raw.net_debt),
      };
    } else if (key === 'ev_ebit') {
      extraFields = {
        medianMultiple: safeNum(raw.median_multiple),
        currentMultiple: safeNum(raw.current_multiple),
        ebitNow: safeNum(raw.ebit_now),
        netDebt: safeNum(raw.net_debt),
      };
    } else if (key === 'ebitda_valuation') {
      extraFields = {
        normalizedEbitda: safeNum(raw.normalized_ebitda),
        currentEbitda: safeNum(raw.current_ebitda),
        targetMultiple: safeNum(raw.target_multiple),
        multipleBasis: safeStr(raw.multiple_basis),
        netDebt: safeNum(raw.net_debt),
      };
    } else if (key === 'roic_wacc_valuation') {
      extraFields = {
        investedCapital: safeNum(raw.invested_capital),
        roic: safeNum(raw.roic),
        wacc: safeNum(raw.wacc),
        spread: safeNum(raw.spread),
        eva0: safeNum(raw.eva_0),
        mva: safeNum(raw.mva),
        enterpriseValue: safeNum(raw.enterprise_value),
        icBasis: safeStr(raw.ic_basis),
      };
    }
    models.push({
      key,
      labelKey: MODEL_LABEL_MAP[key] ?? key,
      intrinsicPerShare,
      intrinsicTotal,
      weight: safeNum(raw.weight_used) ?? 0,
      signal: parseValuationSignal(raw.signal),
      gapToMarket: currentPrice && currentPrice > 0 && intrinsicPerShare !== null
        ? (intrinsicPerShare - currentPrice) / currentPrice
        : safeNum(raw.gap_to_market ?? raw.gap),
      isOutlier: raw.is_outlier === true,
      outlierNote: typeof raw.outlier_note === 'string' ? raw.outlier_note : null,
      ...extraFields,
    });
  });

  const cfRaw = reasoning.cash_flow_insight && typeof reasoning.cash_flow_insight === 'object'
    ? reasoning.cash_flow_insight as Record<string, unknown>
    : null;
  const cashFlow = cfRaw
    ? {
        fcff: safeNum(cfRaw.fcff),
        fcfe: safeNum(cfRaw.fcfe),
        fcffYield: safeNum(cfRaw.fcff_yield),
        fcfeYield: safeNum(cfRaw.fcfe_yield),
        fcfGrowth: safeNum(cfRaw.fcf_growth),
        fcfeIntrinsicPerShare: safeNum(cfRaw.fcfe_intrinsic_per_share),
        evEbitdaMultiple: safeNum(cfRaw.ev_ebitda_multiple),
        costOfEquity: safeNum(cfRaw.cost_of_equity),
        valueTrapFlag: (['trap_risk', 'genuine_value', 'neutral'].includes(String(cfRaw.value_trap_flag))
          ? cfRaw.value_trap_flag : null) as CashFlowInsight['valueTrapFlag'],
        shareholderCapacity: (['strong', 'moderate', 'limited', 'negative'].includes(String(cfRaw.shareholder_capacity))
          ? cfRaw.shareholder_capacity : null) as CashFlowInsight['shareholderCapacity'],
      }
    : null;

  if (models.length === 0 && !rim && !pbr && !cashFlow) return null;
  return {
    regime: reasoning.regime === 'capex_heavy' ? 'capex_heavy' : 'default',
    regimeNote: typeof reasoning.regime_note === 'string' ? reasoning.regime_note : null,
    rim,
    pbr,
    models,
    cashFlow,
  };
}

export function extractTargetTiles(
  metrics: CanonicalMetrics,
  activeAgentKey: string,
  _language: ReportLanguage,
  currency = 'USD',
): TargetTile[] {
  const safetyMarginPrice = buildSafetyMarginPrice(metrics);
  const candidates: Array<{ labelKey: string; sublabelKey: string; metric?: CanonicalMetric; tone: ReportTone; formatter?: (value: number) => string }> = [
    { labelKey: 'targetIntrinsicLabel', sublabelKey: 'targetIntrinsicSubtitle', metric: metrics.intrinsicValue, tone: intrinsicTone(metrics.intrinsicValue?.value ?? null, metrics.currentPrice?.value ?? null), formatter: value => formatCurrency(value, currency) },
    { labelKey: 'targetMarginLabel', sublabelKey: 'targetMarginSubtitle', metric: safetyMarginPrice, tone: marginTone(metrics.marginOfSafety?.value ?? null), formatter: value => formatMarginTarget(value, metrics.currentPrice?.value ?? null, metrics.marginOfSafety?.value ?? null, currency) },
    { labelKey: 'targetEpsLabel', sublabelKey: 'targetEpsSubtitle', metric: metrics.forwardEpsTtm || metrics.forwardEpsFy0, tone: 'neutral', formatter: formatPlain },
    { labelKey: 'targetCoverageLabel', sublabelKey: 'targetCoverageSubtitle', metric: metrics.interestCoverage, tone: coverageTone(metrics.interestCoverage?.value ?? null), formatter: formatMultiple },
    { labelKey: 'targetBetaLabel', sublabelKey: 'targetBetaSubtitle', metric: metrics.beta, tone: 'neutral', formatter: formatPlain },
    { labelKey: 'targetWaccLabel', sublabelKey: 'targetWaccSubtitle', metric: metrics.wacc, tone: 'neutral', formatter: formatPercentSmart },
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
  if (intrinsic && Number.isFinite(intrinsic.value) && intrinsic.value > 0) {
    return {
      ...intrinsic,
      value: intrinsic.value * (1 - SAFETY_MARGIN_PRICE_BUFFER),
    };
  }

  const current = finiteNumber(metrics.currentPrice?.value);
  const margin = finiteNumber(metrics.marginOfSafety?.value);
  if (current === null || current <= 0 || margin === null) return undefined;

  const impliedIntrinsicValue = current * (1 + margin);
  if (!Number.isFinite(impliedIntrinsicValue) || impliedIntrinsicValue <= 0) return undefined;

  const source = metrics.marginOfSafety ?? metrics.currentPrice;
  if (!source) return undefined;
  return {
    ...source,
    value: impliedIntrinsicValue * (1 - SAFETY_MARGIN_PRICE_BUFFER),
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
  const relativeToCurrent = finiteNumber(rawMarginOfSafety)
    ?? (current !== null && current > 0 ? (safetyMarginPrice - current) / current : null);
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
  return value.toFixed(1);
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
