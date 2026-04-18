import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { cn } from '@/lib/utils';
import { TabService } from '@/services/tab-service';
import { BarChart3, Bot, Brain, ChevronDown, ChevronUp, Database, FileText, GitBranch, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TabContentProps {
  className?: string;
}

interface AgentScoringGuide {
  nameKo: string;
  nameEn: string;
  styleKo: string;
  styleEn: string;
  summaryKo: string;
  summaryEn: string;
  weightsKo: string[];
  weightsEn: string[];
  buyRuleKo: string;
  buyRuleEn: string;
  sellRuleKo: string;
  sellRuleEn: string;
  buySignalsKo: string[];
  buySignalsEn: string[];
  sellSignalsKo: string[];
  sellSignalsEn: string[];
}

const agentScoringGuides: AgentScoringGuide[] = [
  {
    nameKo: '워런 버핏',
    nameEn: 'Warren Buffett',
    styleKo: '우량 기업 + 안전마진',
    styleEn: 'Quality business + margin of safety',
    summaryKo: '사업의 질, 이익 지속성, 해자, 경영진, 가격 결정력, 장부가치 성장을 합산한 뒤 내재가치 대비 할인 여부를 확인합니다.',
    summaryEn: 'Combines business quality, earnings consistency, moat, management, pricing power, and book value growth, then checks valuation against intrinsic value.',
    weightsKo: ['펀더멘털', '이익 일관성', '경쟁우위', '경영진', '가격 결정력', '장부가치 성장'],
    weightsEn: ['Fundamentals', 'Consistency', 'Moat', 'Management', 'Pricing power', 'Book value growth'],
    buyRuleKo: '강한 사업 품질과 양(+)의 안전마진이 함께 확인될 때 Buy 쪽으로 기웁니다.',
    buyRuleEn: 'Leans Buy when strong business quality and a positive margin of safety are both present.',
    sellRuleKo: '사업 품질이 낮거나 내재가치 대비 명백히 비싸면 Sell 쪽으로 기웁니다.',
    sellRuleEn: 'Leans Sell when business quality is weak or valuation is clearly above intrinsic value.',
    buySignalsKo: ['ROE 15% 초과, 낮은 부채비율, 영업마진 15% 초과를 우선 가점합니다.', '5개 이상 기간의 높은 ROE/ROIC와 안정적인 마진은 해자 점수로 반영됩니다.', 'FCF 기반 내재가치가 시가총액보다 높으면 안전마진을 계산합니다.'],
    buySignalsEn: ['Awards points for ROE above 15%, conservative leverage, and operating margin above 15%.', 'High multi-period ROE/ROIC and stable margins improve moat scoring.', 'Calculates margin of safety when FCF-based intrinsic value exceeds market cap.'],
    sellSignalsKo: ['이익 추세가 들쭉날쭉하거나 FCF가 약하면 일관성 점수가 낮아집니다.', '부채 부담과 약한 유동성은 경영 안정성 평가를 깎습니다.', '안전마진이 없으면 정성 분석이 좋아도 보수적으로 중립 또는 매도 쪽을 봅니다.'],
    sellSignalsEn: ['Inconsistent earnings or weak FCF lowers consistency scoring.', 'Heavy debt and weak liquidity hurt management quality.', 'Without margin of safety, even good qualitative traits are treated cautiously.'],
  },
  {
    nameKo: '찰리 멍거',
    nameEn: 'Charlie Munger',
    styleKo: '위대한 기업 + 예측가능성',
    styleEn: 'Great business + predictability',
    summaryKo: '품질 기준이 가장 엄격한 편입니다. 해자와 경영진, 예측가능성을 훨씬 더 크게 보고 현재 밸류에이션은 보조적으로 봅니다.',
    summaryEn: 'Uses one of the strictest quality bars. Moat, management, and predictability dominate; valuation is a secondary check.',
    weightsKo: ['해자: 35%', '경영진: 25%', '예측가능성: 25%', '밸류에이션: 15%'],
    weightsEn: ['Moat: 35%', 'Management: 25%', 'Predictability: 25%', 'Valuation: 15%'],
    buyRuleKo: '10점 만점 기준 7.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 10-point scale, 7.5 or above leans Buy.',
    sellRuleKo: '10점 만점 기준 5.5점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 10-point scale, 5.5 or below leans Sell.',
    buySignalsKo: ['ROIC가 15%를 꾸준히 넘으면 해자 점수가 크게 올라갑니다.', 'FCF 전환율, 낮은 부채, 주식 수 관리가 경영진 점수에 반영됩니다.', '매출, 영업이익, 마진, FCF가 안정적이면 예측가능성이 높아집니다.'],
    buySignalsEn: ['Consistent ROIC above 15% is a major moat signal.', 'FCF conversion, low debt, and share-count discipline support management scoring.', 'Stable revenue, operating income, margins, and FCF increase predictability.'],
    sellSignalsKo: ['ROIC가 15%를 넘지 못하거나 마진이 불안정하면 멍거 기준을 통과하기 어렵습니다.', '높은 레버리지와 낮은 현금창출력은 즉시 감점됩니다.', '사업이 복잡하고 예측이 어려우면 밸류에이션 매력이 있어도 보수적으로 봅니다.'],
    sellSignalsEn: ['ROIC below 15% or unstable margins make it hard to pass Munger’s bar.', 'High leverage and weak cash generation are immediate negatives.', 'Hard-to-predict businesses stay conservative even with apparent valuation appeal.'],
  },
  {
    nameKo: '애스워스 다모다란',
    nameEn: 'Aswath Damodaran',
    styleKo: '내재가치 + 위험 조정',
    styleEn: 'Intrinsic value + risk adjustment',
    summaryKo: '성장과 재투자, 위험, 상대가치를 점수화하고 DCF 내재가치 대비 안전마진이 있는지 확인합니다.',
    summaryEn: 'Scores growth/reinvestment, risk, and relative valuation, then checks DCF intrinsic value against market cap.',
    weightsKo: ['성장/재투자: 4점', '위험 프로필: 3점', '상대가치: 1점'],
    weightsEn: ['Growth/reinvestment: 4 pts', 'Risk profile: 3 pts', 'Relative value: 1 pt'],
    buyRuleKo: 'DCF 내재가치가 시가총액보다 25% 이상 높으면 Buy 성향입니다.',
    buyRuleEn: 'Leans Buy when DCF intrinsic value is at least 25% above market cap.',
    sellRuleKo: 'DCF 내재가치가 시가총액보다 25% 이상 낮으면 Sell 성향입니다.',
    sellRuleEn: 'Leans Sell when DCF intrinsic value is at least 25% below market cap.',
    buySignalsKo: ['매출 CAGR 8% 초과, FCFF 성장, ROIC 10% 초과를 성장/재투자 가점으로 봅니다.', 'Beta 1.3 미만, D/E 1 미만, 이자보상배율 3배 초과를 위험 점수에 반영합니다.', 'P/E가 과거 중위값 대비 낮으면 상대가치 보조점수를 줍니다.'],
    buySignalsEn: ['Revenue CAGR above 8%, FCFF growth, and ROIC above 10% improve growth/reinvestment scoring.', 'Beta below 1.3, D/E below 1, and interest coverage above 3x improve risk scoring.', 'A P/E below its historical median adds relative valuation support.'],
    sellSignalsKo: ['성장 이력이 부족하면 FCFF와 수익성 대체지표로 보수적으로 해석합니다.', '높은 Beta, 높은 D/E, 낮은 이자보상배율은 할인율 리스크로 봅니다.', '내재가치 안전마진이 없으면 점수가 좋아도 중립에 머물 수 있습니다.'],
    sellSignalsEn: ['Sparse growth history is handled conservatively through FCFF and profitability proxies.', 'High beta, high D/E, and weak interest coverage are treated as discount-rate risk.', 'Without intrinsic-value margin of safety, good sub-scores may still end neutral.'],
  },
  {
    nameKo: '캐시 우드',
    nameEn: 'Cathie Wood',
    styleKo: '파괴적 혁신 + 장기 성장',
    styleEn: 'Disruptive innovation + long-term growth',
    summaryKo: '파괴적 잠재력, 혁신 성장, 고성장 밸류에이션 시나리오를 각각 5점 축으로 정규화해 15점 만점으로 봅니다.',
    summaryEn: 'Normalizes disruptive potential, innovation-driven growth, and high-growth valuation into a 15-point framework.',
    weightsKo: ['파괴적 잠재력: 5점', '혁신 성장: 5점', '고성장 밸류에이션: 5점'],
    weightsEn: ['Disruptive potential: 5 pts', 'Innovation growth: 5 pts', 'High-growth valuation: 5 pts'],
    buyRuleKo: '15점 만점 기준 70% 이상, 즉 10.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 15-point scale, 70% or higher, meaning 10.5+, leans Buy.',
    sellRuleKo: '15점 만점 기준 30% 이하, 즉 4.5점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 15-point scale, 30% or lower, meaning 4.5 or below, leans Sell.',
    buySignalsKo: ['매출 성장 가속, 매출 성장률 50~100% 이상 구간, 매출 대비 R&D 15% 초과를 강하게 봅니다.', '매출보다 비용 증가가 느린 양(+)의 영업 레버리지를 가점합니다.', '20% 성장률, 15% 할인율, 25배 터미널 멀티플 기반 고성장 DCF를 참고합니다.'],
    buySignalsEn: ['Strongly rewards revenue acceleration, 50-100%+ growth zones, and R&D above 15% of revenue.', 'Positive operating leverage, where revenue grows faster than expenses, adds points.', 'Uses a high-growth DCF with 20% growth, 15% discount rate, and 25x terminal multiple as a scenario check.'],
    sellSignalsKo: ['R&D 데이터가 없거나 혁신 투자 강도가 낮으면 핵심 가설이 약해집니다.', '매출 성장이 둔화되고 총마진이 축소되면 파괴적 잠재력 점수가 낮아집니다.', 'FCF가 음수이면 고성장 밸류에이션 계산 자체가 제한됩니다.'],
    sellSignalsEn: ['Missing R&D data or weak innovation intensity weakens the core thesis.', 'Slowing revenue growth and shrinking gross margins lower disruptive potential.', 'Negative FCF limits the high-growth valuation calculation itself.'],
  },
  {
    nameKo: '피터 린치',
    nameEn: 'Peter Lynch',
    styleKo: 'GARP + PEG',
    styleEn: 'GARP + PEG',
    summaryKo: '이해하기 쉬운 성장주를 합리적인 가격에 사는지 봅니다. PEG와 EPS/매출 성장의 균형이 핵심입니다.',
    summaryEn: 'Looks for understandable growth at a reasonable price. The balance between PEG and EPS/revenue growth is central.',
    weightsKo: ['성장: 30%', '가치: 25%', '기초체력: 20%', '뉴스: 15%', '내부자: 10%'],
    weightsEn: ['Growth: 30%', 'Valuation: 25%', 'Fundamentals: 20%', 'News: 15%', 'Insiders: 10%'],
    buyRuleKo: '10점 만점 기준 7.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 10-point scale, 7.5 or above leans Buy.',
    sellRuleKo: '10점 만점 기준 4.5점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 10-point scale, 4.5 or below leans Sell.',
    buySignalsKo: ['매출 성장률 25% 초과 +3점, 10% 초과 +2점, 2% 초과 +1점입니다.', 'EPS 성장률 25% 초과 +3점, 10% 초과 +2점, 2% 초과 +1점입니다.', 'P/E 15 미만, PEG 1 미만, 낮은 D/E, 양(+)의 FCF가 강한 가점입니다.'],
    buySignalsEn: ['Revenue growth above 25% adds 3 pts, above 10% adds 2, and above 2% adds 1.', 'EPS growth above 25% adds 3 pts, above 10% adds 2, and above 2% adds 1.', 'P/E below 15, PEG below 1, low D/E, and positive FCF are strong positives.'],
    sellSignalsKo: ['매출/EPS 성장이 2% 이하이거나 마이너스이면 성장 점수가 낮습니다.', 'PEG 3 초과, 높은 P/E, FCF 마이너스는 가치 매력을 훼손합니다.', '부정 뉴스가 전체의 30%를 넘으면 뉴스 점수는 3/10으로 떨어집니다.'],
    sellSignalsEn: ['Revenue/EPS growth at or below 2%, or negative, keeps growth scoring low.', 'PEG above 3, high P/E, and negative FCF weaken valuation appeal.', 'If negative headlines exceed 30%, the news score falls to 3/10.'],
  },
  {
    nameKo: '필 피셔',
    nameEn: 'Phil Fisher',
    styleKo: '장기 성장 품질',
    styleEn: 'Long-term growth quality',
    summaryKo: '우수한 경영진, R&D, 장기 성장, 안정적인 마진을 선호합니다. 싸기만 한 회사보다 품질 지속성을 봅니다.',
    summaryEn: 'Prefers excellent management, R&D, long-term growth, and stable margins. Durable quality matters more than simply looking cheap.',
    weightsKo: ['성장/품질: 30%', '마진 안정성: 25%', '경영 효율: 20%', '가치: 15%', '내부자: 5%', '뉴스: 5%'],
    weightsEn: ['Growth/quality: 30%', 'Margin stability: 25%', 'Management efficiency: 20%', 'Valuation: 15%', 'Insiders: 5%', 'News: 5%'],
    buyRuleKo: '10점 만점 기준 7.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 10-point scale, 7.5 or above leans Buy.',
    sellRuleKo: '10점 만점 기준 4.5점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 10-point scale, 4.5 or below leans Sell.',
    buySignalsKo: ['매출 CAGR 20% 초과 +3점, 10% 초과 +2점, 3% 초과 +1점입니다.', 'EPS CAGR 20% 초과 +3점, 10% 초과 +2점, 3% 초과 +1점입니다.', 'R&D/매출 3~15% 구간, 총마진 50% 초과, ROE 20% 초과를 좋게 봅니다.'],
    buySignalsEn: ['Revenue CAGR above 20% adds 3 pts, above 10% adds 2, and above 3% adds 1.', 'EPS CAGR above 20% adds 3 pts, above 10% adds 2, and above 3% adds 1.', 'R&D/revenue in the 3-15% zone, gross margin above 50%, and ROE above 20% are positives.'],
    sellSignalsKo: ['성장률이 둔화되고 R&D 데이터가 없으면 품질 가설이 약해집니다.', '영업마진이 하락하거나 변동성이 높으면 피셔식 품질 점수가 낮습니다.', 'D/E 1.0 초과, ROE 약세, 높은 P/E 또는 P/FCF 30 초과는 부담입니다.'],
    sellSignalsEn: ['Slowing growth and missing R&D data weaken the quality thesis.', 'Declining or volatile operating margins lower Fisher-style quality scoring.', 'D/E above 1.0, weak ROE, or P/E/P-FCF above 30 are burdens.'],
  },
  {
    nameKo: '빌 애크먼',
    nameEn: 'Bill Ackman',
    styleKo: '집중 투자 + 행동주의',
    styleEn: 'Concentrated investing + activism',
    summaryKo: '고품질 사업, 재무 규율, 행동주의 개선 여지, 내재가치 할인 여부를 각각 5점 축으로 합산합니다.',
    summaryEn: 'Adds four 5-point pillars: business quality, financial discipline, activism potential, and intrinsic-value discount.',
    weightsKo: ['사업 품질: 5점', '재무 규율: 5점', '행동주의 여지: 5점', '밸류에이션: 5점'],
    weightsEn: ['Business quality: 5 pts', 'Financial discipline: 5 pts', 'Activism potential: 5 pts', 'Valuation: 5 pts'],
    buyRuleKo: '20점 만점 기준 70% 이상, 즉 14점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 20-point scale, 70% or higher, meaning 14+, leans Buy.',
    sellRuleKo: '20점 만점 기준 30% 이하, 즉 6점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 20-point scale, 30% or lower, meaning 6 or below, leans Sell.',
    buySignalsKo: ['누적 매출 성장 50% 초과, 영업마진 15% 초과, FCF 양호, ROE 15% 초과를 품질로 봅니다.', 'D/E 1 미만, 배당/자사주 매입 등 자본 배분 흔적을 재무 규율로 봅니다.', '매출은 성장하지만 마진이 10% 미만이면 행동주의 개선 여지가 있다고 봅니다.'],
    buySignalsEn: ['Cumulative revenue growth above 50%, operating margin above 15%, good FCF, and ROE above 15% support quality.', 'D/E below 1 and capital returns through dividends/buybacks support financial discipline.', 'Growing revenue with margins below 10% can indicate activism upside.'],
    sellSignalsKo: ['마진이 이미 낮고 개선 여지가 불명확하면 행동주의 점수가 낮습니다.', 'FCF가 음수이면 단순 DCF 밸류에이션 가점이 막힙니다.', '안전마진 10% 미만이면 밸류에이션 매력이 약합니다.'],
    sellSignalsEn: ['Low margins without a clear improvement path reduce activism scoring.', 'Negative FCF prevents the simplified DCF from adding valuation points.', 'Margin of safety below 10% leaves valuation appeal weak.'],
  },
  {
    nameKo: '벤 그레이엄',
    nameEn: 'Ben Graham',
    styleKo: '방어적 가치 + 안전마진',
    styleEn: 'Defensive value + margin of safety',
    summaryKo: '이익 안정성, 재무 건전성, 그레이엄식 가치평가를 15점 만점으로 합산하는 가장 보수적인 가치 평가입니다.',
    summaryEn: 'A conservative 15-point value framework combining earnings stability, financial strength, and Graham-style valuation.',
    weightsKo: ['이익 안정성: 4점', '재무 건전성: 5점', '그레이엄 가치평가: 6점'],
    weightsEn: ['Earnings stability: 4 pts', 'Financial strength: 5 pts', 'Graham valuation: 6 pts'],
    buyRuleKo: '15점 만점 기준 70% 이상, 즉 10.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 15-point scale, 70% or higher, meaning 10.5+, leans Buy.',
    sellRuleKo: '15점 만점 기준 30% 이하, 즉 4.5점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 15-point scale, 30% or lower, meaning 4.5 or below, leans Sell.',
    buySignalsKo: ['EPS가 전 기간 양수이면 +3점, EPS가 증가하면 +1점입니다.', '유동비율 2.0 이상, 부채/자산 0.5 미만, 배당 기록을 재무 건전성으로 봅니다.', 'NCAV가 시가총액보다 크거나 그레이엄 넘버 대비 50% 이상 안전마진이면 강한 가점입니다.'],
    buySignalsEn: ['Positive EPS in every period adds 3 pts; EPS growth adds 1.', 'Current ratio above 2.0, debt/assets below 0.5, and dividend history support financial strength.', 'NCAV above market cap or 50%+ margin versus Graham Number is a strong positive.'],
    sellSignalsKo: ['EPS가 여러 기간 음수이거나 성장하지 않으면 방어적 가치 기준을 통과하기 어렵습니다.', '유동비율 1.5 미만 또는 부채/자산 0.8 이상은 약한 재무구조로 봅니다.', '현재가가 그레이엄 넘버보다 높으면 안전마진이 낮다고 봅니다.'],
    sellSignalsEn: ['Negative EPS in several periods or no EPS growth makes the defensive value bar hard to pass.', 'Current ratio below 1.5 or debt/assets above 0.8 signals weak finances.', 'A price above Graham Number implies low margin of safety.'],
  },
];

function MainGuide({ language }: { language: 'ko' | 'en' }) {
  const isKo = language === 'ko';
  const [showAgentScoring, setShowAgentScoring] = useState(false);
  const stages = isKo
    ? [
        {
          icon: Database,
          title: '데이터 수집 및 표준화',
          body: '백엔드는 yfinance, DART, FMP, AlphaVantage, Financial Datasets fallback을 조합해 가격, 재무제표, 지표, 뉴스, 공시 데이터를 수집합니다. 누락값은 N/A로 보존하고 에이전트가 임의 수치를 만들지 않도록 표준화합니다.',
        },
        {
          icon: Bot,
          title: '에이전트 정량 평가',
          body: '워런 버핏, 찰리 멍거, 다모다란, 캐시 우드 등 각 에이전트는 자신의 투자 철학에 맞는 지표를 우선 검토하고 bullish, bearish, neutral 신호와 신뢰도를 만듭니다.',
        },
        {
          icon: BarChart3,
          title: '종합 점수',
          body: '각 에이전트의 방향성과 신뢰도를 0~100점 구간으로 환산합니다. 80점 이상은 강력 매수, 60~79점은 매수, 40~59점은 관망, 20~39점은 비중 축소, 19점 이하는 강력 매도 구간입니다.',
        },
        {
          icon: Brain,
          title: '포트폴리오 매니저 종합',
          body: '포트폴리오 매니저는 에이전트별 근거를 다시 묶어 최종 판단, 약식 요약, 원문 대조 리포트 확인 포인트를 제공합니다. 시드머니 주문 수량보다 판단 상태와 근거 요약을 우선합니다.',
        },
      ]
    : [
        {
          icon: Database,
          title: 'Data Collection And Standardization',
          body: 'The backend combines yfinance, DART, FMP, AlphaVantage, and Financial Datasets fallbacks to collect prices, statements, metrics, news, and filings. Missing values stay as N/A so agents cannot invent financial numbers.',
        },
        {
          icon: Bot,
          title: 'Agent Quant Scoring',
          body: 'Warren Buffett, Charlie Munger, Aswath Damodaran, Cathie Wood, and other agents prioritize the metrics their investment styles require, then produce bullish, bearish, or neutral signals with confidence.',
        },
        {
          icon: BarChart3,
          title: 'Composite Score',
          body: 'Agent direction and confidence are normalized into a 0-100 score. 80+ is Strong Buy, 60-79 is Buy, 40-59 is Watch, 20-39 is Reduce, and below 20 is Strong Sell.',
        },
        {
          icon: Brain,
          title: 'Portfolio Manager Synthesis',
          body: 'The portfolio manager combines analyst reasoning into a final decision, executive summary, and source cross-check points. The UI emphasizes decision status and evidence over seed-money order sizing.',
        },
      ];

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex min-h-full max-w-6xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="border-b border-border/70 pb-7">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <GitBranch className="h-4 w-4 text-blue-500" />
            <span>{isKo ? 'AI Hedge Fund Visual Simulator' : 'AI Hedge Fund Visual Simulator'}</span>
          </div>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight tracking-normal text-primary">
            {isKo
              ? '메인페이지에서 전체 분석 흐름과 점수 산정 방식을 확인하세요'
              : 'Review the full analysis flow and scoring logic from the main page'}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
            {isKo
              ? '이 화면은 설정 페이지가 아니라 앱의 작동 방식을 설명하는 기준 화면입니다. Flow 또는 종목 분석 탭을 열기 전, 백엔드 데이터 파이프라인과 에이전트 판단 구조가 어떻게 연결되는지 빠르게 확인할 수 있습니다.'
              : 'This is the reference screen for how the app works, not a settings page. Before opening a Flow or Stock Analysis tab, you can review how the backend data pipeline connects to agent decisions.'}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {stages.map((stage) => {
            const Icon = stage.icon;
            const isAgentScoringStage = stage.title === (isKo ? '에이전트 정량 평가' : 'Agent Quant Scoring');
            return (
              <div key={stage.title} className="rounded-md border border-border/70 bg-muted/10 p-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background">
                    <Icon className="h-4 w-4 text-blue-500" />
                  </span>
                  <h2 className="text-base font-semibold text-primary">{stage.title}</h2>
                </div>
                <p className="text-sm leading-7 text-muted-foreground">{stage.body}</p>
                {isAgentScoringStage && (
                  <button
                    type="button"
                    aria-expanded={showAgentScoring}
                    aria-controls="agent-quant-scoring-detail"
                    onClick={() => setShowAgentScoring((current) => !current)}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-500 transition hover:border-blue-400 hover:bg-blue-500/20 hover:text-blue-400"
                  >
                    {showAgentScoring ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {showAgentScoring ? (isKo ? '간단히 보기' : 'Hide Details') : (isKo ? '상세보기' : 'View Details')}
                  </button>
                )}
              </div>
            );
          })}
        </section>

        {showAgentScoring && (
          <section
            id="agent-quant-scoring-detail"
            className="rounded-md border border-border/70 bg-muted/10 p-5"
          >
            <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Bot className="h-4 w-4 text-blue-500" />
                  <h2 className="text-base font-semibold text-primary">
                    {isKo ? '에이전트별 정량 평가 기준' : 'Agent-by-Agent Quant Scoring Guide'}
                  </h2>
                </div>
                <p className="mt-3 max-w-4xl text-sm leading-7 text-muted-foreground">
                  {isKo
                    ? '현재 백엔드 에이전트 코드의 점수 구조를 읽기 쉬운 안내 형태로 정리했습니다. 에이전트별 원점수는 서로 다르지만, 최종 화면에서는 신호와 신뢰도를 다시 0~100점 구간으로 정규화해 비교합니다.'
                    : 'This summarizes the current backend agent scoring logic in a readable guide. Raw agent scores use different scales, while the final UI normalizes signals and confidence into a 0-100 composite range.'}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs leading-6 text-muted-foreground">
                {isKo ? '일반 10점형: 7.5점 이상이면 Buy / 4.5점 이하이면 Sell' : 'Common 10-point form: 7.5+ means Buy / 4.5 or below means Sell'}
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {agentScoringGuides.map((agent) => (
                <article key={agent.nameEn} className="rounded-md border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-primary">
                          {isKo ? agent.nameKo : agent.nameEn}
                        </h3>
                        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {isKo ? agent.styleKo : agent.styleEn}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        {isKo ? agent.summaryKo : agent.summaryEn}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {(isKo ? agent.weightsKo : agent.weightsEn).map((weight) => (
                      <span key={weight} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                        {weight}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
                      <p className="text-xs font-semibold text-primary">
                        {isKo ? '점수 구조' : 'Score Structure'}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        {isKo ? agent.buyRuleKo : agent.buyRuleEn}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-muted-foreground">
                        {isKo ? agent.sellRuleKo : agent.sellRuleEn}
                      </p>
                    </div>
                    <div className="rounded-md border border-blue-500/25 bg-blue-500/5 p-3">
                      <p className="text-xs font-semibold text-blue-500">
                        {isKo ? 'Buy 기준이 되는 조건' : 'Buy-Side Signals'}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs leading-6 text-muted-foreground">
                        {(isKo ? agent.buySignalsKo : agent.buySignalsEn).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-md border border-red-500/25 bg-red-500/5 p-3">
                      <p className="text-xs font-semibold text-red-400">
                        {isKo ? 'Sell 기준이 되는 조건' : 'Sell-Side Signals'}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs leading-6 text-muted-foreground">
                        {(isKo ? agent.sellSignalsKo : agent.sellSignalsEn).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-md border border-border/70 bg-muted/10 p-5">
            <div className="mb-3 flex items-center gap-3">
              <FileText className="h-4 w-4 text-emerald-500" />
              <h2 className="text-base font-semibold text-primary">
                {isKo ? '원문 대조와 결과 보존' : 'Source Cross-Check And Result Persistence'}
              </h2>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              {isKo
                ? '에이전트 결과에는 SEC 10-K 또는 DART 사업보고서에서 확인해야 할 원문 대조 체크리스트가 포함됩니다. 한 번 조회한 결과와 보고서, 조회 상태는 DB에 저장되어 페이지 이동이나 새로고침 뒤에도 다시 복원되는 방향으로 관리됩니다.'
                : 'Agent outputs include source cross-check checklists for SEC 10-K or DART filings. Viewed results, reports, and query state are stored in the database so navigation or refreshes can restore them.'}
            </p>
            <p className="mt-3 text-sm font-medium text-primary">
              {isKo ? '결과는 DB에 저장되며, 임의 초기화되지 않도록 관리됩니다.' : 'Results are saved to the database and are protected from accidental reset.'}
            </p>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/10 p-5">
            <div className="mb-3 flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <h2 className="text-base font-semibold text-primary">
                {isKo ? '설정과 API 노출 정책' : 'Settings And API Visibility'}
              </h2>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              {isKo
                ? '설정 화면은 Models, Theme, Language만 제공합니다. 금융/LLM API 키는 사용자가 직접 조작하는 UI로 노출하지 않고, 백엔드가 저장된 키와 환경 변수를 이용해 데이터 전처리와 모델 호출에 활용합니다.'
                : 'Settings expose only Models, Theme, and Language. Financial and LLM API keys are not shown as user-facing controls; the backend uses saved keys and environment variables for preprocessing and model calls.'}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export function TabContent({ className }: TabContentProps) {
  const { tabs, activeTabId, openTab } = useTabsContext();
  const { language } = useLanguage();

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // Restore content for active tab that doesn't have it (from localStorage restoration)
  useEffect(() => {
    if (activeTab && !activeTab.content) {
      try {
        const restoredTab = TabService.restoreTab({
          type: activeTab.type,
          title: activeTab.title,
          flow: activeTab.flow,
          metadata: activeTab.metadata,
        });

        // Update the tab with restored content
        openTab({
          id: activeTab.id,
          type: restoredTab.type,
          title: restoredTab.title,
          content: restoredTab.content,
          flow: restoredTab.flow,
          metadata: restoredTab.metadata,
        });
      } catch (error) {
        console.error('Failed to restore tab content:', error);
      }
    }
  }, [activeTab, openTab]);

  if (!activeTab) {
    return (
      <div className={cn(
        "h-full w-full bg-background",
        className
      )}>
        <MainGuide language={language} />
      </div>
    );
  }

  // Show loading state if active tab content is being restored
  if (!activeTab.content) {
    return (
      <div className={cn(
        "h-full w-full flex items-center justify-center bg-background text-muted-foreground",
        className
      )}>
        <div className="text-center">
          <div className="text-lg font-medium mb-2">
            {language === 'ko' ? `${activeTab.title} 불러오는 중...` : `Loading ${activeTab.title}...`}
          </div>
        </div>
      </div>
    );
  }

  // Render all tabs simultaneously but only show the active one.
  // This preserves component state (e.g. Stock Analysis results) when switching tabs.
  return (
    <div className={cn("h-full w-full bg-background overflow-hidden relative", className)}>
      {tabs.map(tab => {
        if (!tab.content) return null;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 h-full w-full",
              tab.id !== activeTabId && "hidden"
            )}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
