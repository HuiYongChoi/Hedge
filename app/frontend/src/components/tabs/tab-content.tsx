import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { cn } from '@/lib/utils';
import { TabService } from '@/services/tab-service';
import { agentFormulas, llmPipelineStages, llmModelRoles } from '@/data/agent-formulas';
import { BarChart3, Bot, Brain, ChevronDown, ChevronUp, Cpu, Database, FileText, FlaskConical, GitBranch, Layers, Search, ShieldCheck, Sigma, Sliders } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TabContentProps {
  className?: string;
}

interface AgentScoringGuide {
  nameKo: string;
  nameEn: string;
  category: 'value' | 'growth' | 'macro' | 'technical';
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
    category: 'value',
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
    category: 'value',
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
    sellSignalsEn: ['ROIC below 15% or unstable margins make it hard to pass Munger\'s bar.', 'High leverage and weak cash generation are immediate negatives.', 'Hard-to-predict businesses stay conservative even with apparent valuation appeal.'],
  },
  {
    nameKo: '애스워스 다모다란',
    nameEn: 'Aswath Damodaran',
    category: 'value',
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
    category: 'growth',
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
    category: 'value',
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
    category: 'value',
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
    category: 'macro',
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
    category: 'value',
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
  {
    nameKo: '마이클 버리',
    nameEn: 'Michael Burry',
    category: 'macro',
    styleKo: '역발상 가치 + 숏 포지션',
    styleEn: 'Contrarian value + short positions',
    summaryKo: 'FCF 수익률(6점), 대차대조표 건전성(3점), 내부자 순매수(2점), 역발상 감성(1점)을 합산합니다. 총 12점 만점입니다.',
    summaryEn: 'Adds FCF yield (6 pts), balance sheet strength (3 pts), net insider buying (2 pts), and contrarian sentiment (1 pt). 12 points total.',
    weightsKo: ['FCF 수익률/EV/EBIT: 6점', '대차대조표: 3점', '내부자 순매수: 2점', '역발상 감성: 1점'],
    weightsEn: ['FCF yield / EV/EBIT: 6 pts', 'Balance sheet: 3 pts', 'Net insider buying: 2 pts', 'Contrarian sentiment: 1 pt'],
    buyRuleKo: '12점 만점 기준 70% 이상, 즉 8.4점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 12-point scale, 70% or higher (8.4+) leans Buy.',
    sellRuleKo: '12점 만점 기준 30% 이하, 즉 3.6점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 12-point scale, 30% or lower (3.6 or below) leans Sell.',
    buySignalsKo: ['FCF 수익률 10% 초과 +4점, 7% 초과 +3점, 4% 초과 +2점으로 밸류에이션을 평가합니다.', 'EV/EBIT 6 미만이면 +2점, 10 미만이면 +1점이 추가됩니다.', '내부자 순매수가 있으면 최대 +2점, 부정적 뉴스 비율이 높을수록 역발상 +1점이 가산됩니다.'],
    buySignalsEn: ['FCF yield above 10% adds 4 pts; above 7% adds 3; above 4% adds 2 for valuation.', 'EV/EBIT below 6 adds 2 pts; below 10 adds 1.', 'Net insider buying adds up to 2 pts. Heavy negative news adds 1 contrarian point.'],
    sellSignalsKo: ['FCF 수익률이 낮거나 마이너스이면 밸류에이션 점수가 0점입니다.', 'D/E 1 초과 또는 유동비율 1 미만이면 대차대조표 점수가 낮습니다.', '내부자 순매도는 점수를 추가하지 않으며, 긍정적 뉴스가 우세하면 역발상 점수가 0점입니다.'],
    sellSignalsEn: ['Zero or negative FCF yield scores 0 on the valuation axis.', 'D/E above 1 or current ratio below 1 weakens balance sheet scoring.', 'Net insider selling adds no points; predominantly positive news prevents contrarian scoring.'],
  },
  {
    nameKo: '모니시 파브라이',
    nameEn: 'Mohnish Pabrai',
    category: 'value',
    styleKo: '단도(Dhandho) + 낮은 위험 / 높은 불확실성',
    styleEn: 'Dhandho + low risk / high uncertainty',
    summaryKo: '하방 보호(45%), FCF 기반 밸류에이션(35%), 2배 상승 잠재력(20%)을 가중 합산합니다. 최종 점수는 10점 만점입니다.',
    summaryEn: 'Weighted combination of downside protection (45%), FCF-based valuation (35%), and doubling potential (20%). Final score on a 10-point scale.',
    weightsKo: ['하방 보호: 45%', 'FCF 밸류에이션: 35%', '2배 상승 잠재력: 20%'],
    weightsEn: ['Downside protection: 45%', 'FCF valuation: 35%', 'Doubling potential: 20%'],
    buyRuleKo: '10점 만점 기준 7.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 10-point scale, 7.5 or above leans Buy.',
    sellRuleKo: '10점 만점 기준 4.0점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 10-point scale, 4.0 or below leans Sell.',
    buySignalsKo: ['D/E 0.5 미만 +3점, 유동비율 1.5 이상 +2점, 이자보상배율 5배 이상 +2점이 하방 보호 점수입니다.', 'FCF 수익률 10% 이상 +4점, 7% 이상 +3점, 5% 이상 +2점, 3% 이상 +1점입니다.', 'FCF 수익률 기준 4~5년 내 시가총액 2배 가능성이 있으면 추가 점수가 부여됩니다.'],
    buySignalsEn: ['D/E below 0.5 adds 3 pts, current ratio ≥1.5 adds 2, interest coverage ≥5x adds 2 for downside protection.', 'FCF yield ≥10% adds 4 pts; ≥7% adds 3; ≥5% adds 2; ≥3% adds 1.', 'A FCF-based doubling horizon of 4-5 years earns additional points.'],
    sellSignalsKo: ['정규화된 FCF가 음수이면 밸류에이션 계산 자체가 불가합니다.', '높은 레버리지와 낮은 유동성은 하방 보호 점수를 크게 낮춥니다.', 'FCF 수익률 3% 미만이면 파브라이의 핵심 기준인 저렴한 가격을 충족하지 못합니다.'],
    sellSignalsEn: ['Negative normalized FCF prevents any valuation calculation.', 'High leverage and low liquidity severely reduce downside protection scores.', 'FCF yield below 3% fails Pabrai\'s core criterion of a cheap price.'],
  },
  {
    nameKo: '나심 탈레브',
    nameEn: 'Nassim Taleb',
    category: 'macro',
    styleKo: '반취약성 + 꼬리 위험 + 볼록 포지션',
    styleEn: 'Antifragility + tail risk + convex payoffs',
    summaryKo: '꼬리 위험(8점), 반취약성(10점), 볼록성(10점), 취약성 배제(8점), 스킨인더게임(4점), 변동성 레짐(6점), 블랙스완 감시(4점)로 총 50점 만점입니다.',
    summaryEn: 'Seven components: tail risk (8), antifragility (10), convexity (10), fragility-via-negativa (8), skin in game (4), volatility regime (6), black swan sentinel (4) — 50 points total.',
    weightsKo: ['꼬리 위험: 8점', '반취약성: 10점', '볼록성: 10점', '취약성 배제: 8점', '스킨인더게임: 4점', '변동성 레짐: 6점', '블랙스완 감시: 4점'],
    weightsEn: ['Tail risk: 8 pts', 'Antifragility: 10 pts', 'Convexity: 10 pts', 'Fragility check: 8 pts', 'Skin in game: 4 pts', 'Volatility regime: 6 pts', 'Black swan sentinel: 4 pts'],
    buyRuleKo: '50점 만점 기준 70% 이상, 즉 35점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 50-point scale, 70% or higher (35+ pts) leans Buy.',
    sellRuleKo: '50점 만점 기준 30% 이하, 즉 15점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 50-point scale, 30% or lower (15 or below) leans Sell.',
    buySignalsKo: ['양(+)의 왜도와 팻테일, 꼬리비율 1.2 초과, 작은 최대 낙폭이 꼬리 위험 가점입니다.', 'FCF가 강하고 D/E가 낮으며 마진이 안정적일수록 반취약성 점수가 높습니다.', '내부자 순매수는 스킨인더게임 최대 4점을 부여합니다.'],
    buySignalsEn: ['Positive skew, fat tails, tail ratio above 1.2, and small max drawdown are tail-risk positives.', 'Strong FCF, low D/E, and stable margins improve antifragility scoring.', 'Net insider buying awards up to 4 skin-in-game points.'],
    sellSignalsKo: ['D/E 1.5 초과 또는 이자보상배율 1 미만의 취약 대차대조표는 즉시 감점합니다.', '음(-)의 왜도와 낙폭 30% 초과는 꼬리 위험 점수를 낮춥니다.', 'FCF가 약하고 성장이 없는 회사는 볼록 포지션 요건을 충족하기 어렵습니다.'],
    sellSignalsEn: ['Fragile balance sheets (D/E above 1.5 or interest coverage below 1) are immediate negatives.', 'Negative skew and max drawdown above 30% reduce tail risk scoring.', 'Weak FCF and no growth make it hard to qualify as a convex position.'],
  },
  {
    nameKo: '스탠리 드러켄밀러',
    nameEn: 'Stanley Druckenmiller',
    category: 'macro',
    styleKo: '성장 + 모멘텀 + 거시 + 센티먼트',
    styleEn: 'Growth + momentum + macro + sentiment',
    summaryKo: '성장/모멘텀(35%), 리스크/리워드(20%), 밸류에이션(20%), 센티먼트(15%), 내부자(10%)를 가중 합산해 10점 만점으로 환산합니다.',
    summaryEn: 'Weighted 10-point scale: growth/momentum (35%), risk/reward (20%), valuation (20%), sentiment (15%), insider activity (10%).',
    weightsKo: ['성장/모멘텀: 35%', '리스크/리워드: 20%', '밸류에이션: 20%', '센티먼트: 15%', '내부자: 10%'],
    weightsEn: ['Growth/momentum: 35%', 'Risk/reward: 20%', 'Valuation: 20%', 'Sentiment: 15%', 'Insider activity: 10%'],
    buyRuleKo: '10점 만점 기준 7.5점 이상이면 Buy 성향입니다.',
    buyRuleEn: 'On the 10-point scale, 7.5 or above leans Buy.',
    sellRuleKo: '10점 만점 기준 4.5점 이하이면 Sell 성향입니다.',
    sellRuleEn: 'On the 10-point scale, 4.5 or below leans Sell.',
    buySignalsKo: ['매출 CAGR 8% 초과 +3점, 4% 초과 +2점, 1% 초과 +1점입니다. EPS 성장도 동일하게 적용됩니다.', '1/3/6개월 가중 가격 모멘텀 50% 초과 +3점, 20% 초과 +2점, 양(+)이면 +1점입니다.', '뉴스 센티먼트가 강하게 긍정적이면 높은 점수를 받고, 내부자 매수 비율 70% 초과이면 +8점입니다.'],
    buySignalsEn: ['Revenue CAGR above 8% adds 3 pts; above 4% adds 2; above 1% adds 1. Same scale applies to EPS growth.', 'Weighted 1/3/6-month price momentum above 50% adds 3 pts; above 20% adds 2; positive adds 1.', 'Strong positive news sentiment scores high; insider buy ratio above 70% scores 8 on a 10-point insider axis.'],
    sellSignalsKo: ['매출 또는 EPS 성장이 1% 미만이거나 음수이면 가중 성장 점수가 낮습니다.', '가격 모멘텀이 음수이고 거래량이 확인되면 모멘텀 점수가 낮아집니다.', '부정 뉴스가 우세하고 내부자 매도 비율이 높으면 두 항목 모두 감점됩니다.'],
    sellSignalsEn: ['Revenue or EPS growth below 1% or negative keeps weighted growth scoring low.', 'Negative price momentum with volume confirmation reduces momentum scores.', 'Predominantly negative news and high insider sell ratio lower both sub-scores.'],
  },
  {
    nameKo: '라케시 준준왈라',
    nameEn: 'Rakesh Jhunjhunwala',
    category: 'growth',
    styleKo: '성장성 + 수익성 + 인도식 성장투자',
    styleEn: 'Growth + profitability + India-style growth investing',
    summaryKo: '수익성(8점), 성장(7점), 대차대조표(4점), 현금흐름(3점), 경영진 행동(2점)으로 총 24점 만점입니다. DCF 기반 안전마진도 신호 결정에 활용됩니다.',
    summaryEn: '24-point scale: profitability (8), growth (7), balance sheet (4), cash flow (3), management actions (2). DCF-based margin of safety also informs the final signal.',
    weightsKo: ['수익성: 8점', '성장: 7점', '대차대조표: 4점', '현금흐름: 3점', '경영진: 2점'],
    weightsEn: ['Profitability: 8 pts', 'Growth: 7 pts', 'Balance sheet: 4 pts', 'Cash flow: 3 pts', 'Management: 2 pts'],
    buyRuleKo: '24점 만점 기준 70% 이상(≥16.8점)이면 Buy 성향입니다. 양(+)의 MOS는 신뢰도를 높입니다.',
    buyRuleEn: 'On the 24-point scale, 70% or higher (16.8+) leans Buy. Positive margin of safety increases confidence.',
    sellRuleKo: '24점 만점 기준 30% 이하(≤7.2점)이면 Sell 성향입니다.',
    sellRuleEn: 'On the 24-point scale, 30% or lower (7.2 or below) leans Sell.',
    buySignalsKo: ['ROE 20% 초과 +3점, 영업이익률 25% 초과 +3점, ROIC 20% 초과 +3점이 수익성의 핵심입니다.', '매출 성장 25% 초과 +3점, EPS 성장 25% 초과 +3점, 성장 가속화이면 +1점입니다.', 'D/E 1 미만, 유동비율 1.5 이상, 양(+)의 FCF, 자사주 매입이 모두 추가 가점입니다.'],
    buySignalsEn: ['ROE above 20% adds 3 pts, operating margin above 25% adds 3, ROIC above 20% adds 3 for profitability.', 'Revenue growth above 25% adds 3 pts, EPS growth above 25% adds 3, and accelerating growth adds 1.', 'D/E below 1, current ratio ≥1.5, positive FCF, and buybacks all add further points.'],
    sellSignalsKo: ['ROE, 영업이익률, ROIC가 모두 약하면 수익성 점수가 낮습니다.', '매출 및 EPS 성장이 없거나 감속 중이면 성장 점수가 낮습니다.', 'FCF가 음수이거나 D/E가 높으면 대차대조표와 현금흐름 점수 모두 낮습니다.'],
    sellSignalsEn: ['Weak ROE, operating margin, and ROIC together keep profitability scoring low.', 'No revenue or EPS growth, or decelerating growth, reduces the growth sub-score.', 'Negative FCF or high D/E hurts both balance sheet and cash flow scoring.'],
  },
  {
    nameKo: '기술적 분석가',
    nameEn: 'Technical Analyst',
    category: 'technical',
    styleKo: '추세 + 모멘텀 + 평균회귀 + 변동성',
    styleEn: 'Trend + momentum + mean reversion + volatility',
    summaryKo: '추세(25%), 모멘텀(25%), 평균회귀(20%), 변동성(15%), 통계적 차익(15%)를 가중 앙상블로 결합합니다. 최종 점수 +0.2 초과 = 강세, -0.2 미만 = 약세입니다.',
    summaryEn: 'Weighted ensemble of trend (25%), momentum (25%), mean reversion (20%), volatility (15%), and stat-arb (15%). Final score above +0.2 = bullish; below -0.2 = bearish.',
    weightsKo: ['추세(ADX): 25%', '모멘텀(1/3/6개월): 25%', '평균회귀(볼린저/Z점수): 20%', '변동성 레짐: 15%', '허스트 지수: 15%'],
    weightsEn: ['Trend (ADX): 25%', 'Momentum (1/3/6-month): 25%', 'Mean reversion (Bollinger/Z): 20%', 'Volatility regime: 15%', 'Hurst exponent: 15%'],
    buyRuleKo: '가중 최종 점수가 +0.2 초과이면 Buy 성향입니다.',
    buyRuleEn: 'Weighted final score above +0.2 leans Buy.',
    sellRuleKo: '가중 최종 점수가 -0.2 미만이면 Sell 성향입니다.',
    sellRuleEn: 'Weighted final score below -0.2 leans Sell.',
    buySignalsKo: ['ADX 기반 추세 강도가 상승 방향이면 추세 점수가 올라갑니다.', '1/3/6개월 가중 모멘텀 +0.05 초과이고 거래량 확인이 되면 강한 모멘텀 신호입니다.', 'Z점수 -2 미만 + 볼린저 하단(20th 백분위) 이하는 평균회귀 매수 신호입니다.'],
    buySignalsEn: ['ADX-measured trend strength in an upward direction improves trend scoring.', 'Weighted 1/3/6-month momentum above +0.05 with volume confirmation signals strong momentum.', 'Z-score below -2 and price in the bottom 20th Bollinger percentile is a mean-reversion buy signal.'],
    sellSignalsKo: ['ADX 추세가 하락 방향이면 추세 점수가 낮아집니다.', '가중 모멘텀이 -0.05 미만이고 거래량이 확인되면 모멘텀 매도 신호입니다.', 'Z점수 +2 초과 + 볼린저 상단(80th 백분위) 이상은 평균회귀 매도 신호입니다.'],
    sellSignalsEn: ['ADX-measured trend in a downward direction lowers trend scoring.', 'Weighted momentum below -0.05 with volume confirmation is a momentum sell.', 'Z-score above +2 and price in the top 80th Bollinger percentile is a mean-reversion sell signal.'],
  },
  {
    nameKo: '기본적 분석가',
    nameEn: 'Fundamentals Analyst',
    category: 'technical',
    styleKo: '수익성 + 성장성 + 재무건전성 + 밸류에이션',
    styleEn: 'Profitability + growth + financial health + valuation',
    summaryKo: '수익성, 성장성, 재무건전성, 가격비율 4가지 신호를 다수결로 결합합니다. 각 항목은 독립적으로 강세/약세/중립을 결정합니다.',
    summaryEn: 'Combines four sub-signals by majority vote: profitability, growth, financial health, and price ratios. Each sub-signal independently returns bullish, bearish, or neutral.',
    weightsKo: ['수익성 신호', '성장 신호', '재무건전성 신호', '가격비율 신호'],
    weightsEn: ['Profitability signal', 'Growth signal', 'Financial health signal', 'Price ratios signal'],
    buyRuleKo: '4개 신호 중 강세가 약세보다 많으면 최종 강세입니다.',
    buyRuleEn: 'More bullish sub-signals than bearish among the four determines an overall bullish result.',
    sellRuleKo: '4개 신호 중 약세가 강세보다 많으면 최종 약세입니다.',
    sellRuleEn: 'More bearish sub-signals than bullish among the four determines an overall bearish result.',
    buySignalsKo: ['ROE 15% 초과, 순이익률 20% 초과, 영업이익률 15% 초과 중 2개 이상이면 수익성 강세입니다.', '매출 성장 10% 초과, EPS 성장 10% 초과, 장부가치 성장 10% 초과 중 2개 이상이면 성장 강세입니다.', '유동비율 1.5 이상, D/E 0.5 미만, FCF가 EPS의 80% 이상이면 재무건전성 강세입니다.'],
    buySignalsEn: ['ROE above 15%, net margin above 20%, and operating margin above 15% — 2+ of 3 = profitability bullish.', 'Revenue growth above 10%, EPS growth above 10%, and book value growth above 10% — 2+ of 3 = growth bullish.', 'Current ratio ≥1.5, D/E below 0.5, and FCF at least 80% of EPS = financial health bullish.'],
    sellSignalsKo: ['수익성 지표 3개 모두 기준 미달이면 수익성 약세입니다.', 'P/E 25 초과, P/B 3 초과, P/S 5 초과 중 2개 이상이면 가격비율 약세(고평가)입니다.', '성장 지표 3개 모두 10% 미달이면 성장 약세입니다.'],
    sellSignalsEn: ['All three profitability metrics failing their thresholds = profitability bearish.', 'P/E above 25, P/B above 3, P/S above 5 — 2+ triggers a price-ratios bearish (expensive) signal.', 'All three growth metrics below 10% = growth bearish.'],
  },
  {
    nameKo: '성장 분석가',
    nameEn: 'Growth Analyst',
    category: 'technical',
    styleKo: '성장 추세 + 밸류에이션 + 마진',
    styleEn: 'Growth trends + valuation + margins',
    summaryKo: '성장(40%), 밸류에이션(25%), 마진(15%), 내부자(10%), 재무건전성(10%)을 0~1 척도로 가중 합산합니다. 0.6 초과 = 강세, 0.4 미만 = 약세입니다.',
    summaryEn: 'Weighted 0-1 scale: growth (40%), valuation (25%), margins (15%), insider conviction (10%), financial health (10%). Above 0.6 = bullish; below 0.4 = bearish.',
    weightsKo: ['성장 추세: 40%', '밸류에이션: 25%', '마진 추세: 15%', '내부자 신뢰도: 10%', '재무건전성: 10%'],
    weightsEn: ['Growth trends: 40%', 'Valuation: 25%', 'Margin trends: 15%', 'Insider conviction: 10%', 'Financial health: 10%'],
    buyRuleKo: '가중 합산 점수 0.6 초과이면 Buy 성향입니다.',
    buyRuleEn: 'Weighted score above 0.6 leans Buy.',
    sellRuleKo: '가중 합산 점수 0.4 미만이면 Sell 성향입니다.',
    sellRuleEn: 'Weighted score below 0.4 leans Sell.',
    buySignalsKo: ['최근 매출 성장률 20% 초과 +0.4점, EPS 성장 20% 초과 +0.25점, FCF 성장 15% 초과 +0.1점입니다.', 'P/E 15 미만 +0.5점, P/S 2 미만 +0.5점의 밸류에이션 가점이 있습니다.', '총마진 50% 초과, 영업마진 15% 초과, 마진 개선 추세가 각각 +0.2점씩 가산됩니다.'],
    buySignalsEn: ['Recent revenue growth above 20% adds 0.4; EPS growth above 20% adds 0.25; FCF growth above 15% adds 0.1.', 'P/E below 15 adds 0.5; P/S below 2 adds 0.5 as valuation support.', 'Gross margin above 50%, operating margin above 15%, and improving trend each add 0.2.'],
    sellSignalsKo: ['성장 지표가 낮거나 감속 중이면 성장 항목 점수가 낮습니다.', 'P/E 15 이상이거나 P/S 2 이상이면 밸류에이션 점수를 받지 못합니다.', 'D/E 1 초과 또는 유동비율 1 미만이면 재무건전성 점수가 0.5씩 차감됩니다.'],
    sellSignalsEn: ['Low or decelerating growth metrics keep the growth sub-score low.', 'P/E at or above 15 and P/S at or above 2 add no valuation points.', 'D/E above 1 or current ratio below 1 each deduct 0.5 from financial health scoring.'],
  },
  {
    nameKo: '뉴스 감성 분석가',
    nameEn: 'News Sentiment Analyst',
    category: 'technical',
    styleKo: 'LLM 기반 뉴스 분류',
    styleEn: 'LLM-based news classification',
    summaryKo: 'LLM이 각 뉴스를 positive/negative/neutral로 분류합니다. 다수결로 최종 신호를 결정하며, 신뢰도는 LLM 점수 70%와 신호 비율 30%를 합산합니다.',
    summaryEn: 'The LLM classifies each article as positive, negative, or neutral. The majority signal wins; confidence is 70% LLM score + 30% signal proportion.',
    weightsKo: ['LLM 신뢰도: 70%', '신호 비율: 30%'],
    weightsEn: ['LLM confidence: 70%', 'Signal proportion: 30%'],
    buyRuleKo: '긍정 기사가 부정 기사보다 많으면 강세 신호입니다.',
    buyRuleEn: 'More positive articles than negative results in a bullish signal.',
    sellRuleKo: '부정 기사가 긍정 기사보다 많으면 약세 신호입니다.',
    sellRuleEn: 'More negative articles than positive results in a bearish signal.',
    buySignalsKo: ['LLM이 긍정으로 분류한 기사 수가 부정 기사보다 많으면 강세 신호를 만듭니다.', 'LLM 신뢰도 점수가 높은 긍정 기사는 전체 신뢰도 계산에 크게 기여합니다.', '중립 기사는 신호를 만들지 않으며, 분류되지 않은 기사는 중립으로 처리됩니다.'],
    buySignalsEn: ['More LLM-classified positive articles than negative produces a bullish signal.', 'Positive articles with high LLM confidence scores contribute more to overall confidence.', 'Neutral articles produce no signal; unclassified articles default to neutral.'],
    sellSignalsKo: ['부정 기사가 긍정 기사보다 많으면 약세 신호가 만들어집니다.', '뉴스 데이터가 없으면 신호도 없으며 신뢰도는 0입니다.', '총 기사 수가 적으면 다수결 신뢰도가 낮아질 수 있습니다.'],
    sellSignalsEn: ['More negative articles than positive produces a bearish signal.', 'No news data means no signal and zero confidence.', 'A small total article count can reduce majority-based confidence.'],
  },
  {
    nameKo: '시장 심리 분석가',
    nameEn: 'Sentiment Analyst',
    category: 'technical',
    styleKo: '내부자 거래 + 뉴스 감성',
    styleEn: 'Insider trades + news sentiment',
    summaryKo: '내부자 거래(30%)와 뉴스 감성(70%)을 가중 결합합니다. 내부자 매수/매도 방향과 뉴스 긍정/부정 비율을 각각 신호로 변환합니다.',
    summaryEn: 'Weighted combination of insider trades (30%) and news sentiment (70%). Insider buy/sell direction and news positive/negative ratio are each converted to signals.',
    weightsKo: ['뉴스 감성: 70%', '내부자 거래: 30%'],
    weightsEn: ['News sentiment: 70%', 'Insider trades: 30%'],
    buyRuleKo: '가중 강세 합계(내부자×0.3 + 뉴스×0.7)가 가중 약세 합계를 초과하면 최종 강세입니다.',
    buyRuleEn: 'Total weighted bullish (insider×0.3 + news×0.7) exceeding total weighted bearish produces an overall bullish signal.',
    sellRuleKo: '가중 약세 합계가 가중 강세 합계를 초과하면 최종 약세입니다.',
    sellRuleEn: 'Total weighted bearish count exceeding total weighted bullish count produces an overall bearish signal.',
    buySignalsKo: ['내부자가 순매수(양의 거래량)이면 내부자 신호는 강세로 변환됩니다.', '뉴스 기사의 감성이 positive이면 강세 신호로 분류됩니다.', '가중 강세 합계 = 내부자 강세 수 × 0.3 + 뉴스 강세 수 × 0.7'],
    buySignalsEn: ['Net insider buying (positive transaction shares) is classified as a bullish signal.', 'News articles classified as positive are converted to bullish signals.', 'Weighted bullish total = insider bullish count × 0.3 + news bullish count × 0.7.'],
    sellSignalsKo: ['내부자 순매도(음의 거래량)이면 내부자 신호는 약세로 변환됩니다.', '뉴스 감성이 negative이면 약세 신호로 분류됩니다.', '내부자와 뉴스 데이터가 모두 없으면 신뢰도는 0입니다.'],
    sellSignalsEn: ['Net insider selling (negative transaction shares) is classified as a bearish signal.', 'News articles classified as negative are converted to bearish signals.', 'Zero confidence when both insider and news data are absent.'],
  },
  {
    nameKo: '가치평가 분석가',
    nameEn: 'Valuation Analyst',
    category: 'technical',
    styleKo: '다중 모델 내재가치 가중 평균',
    styleEn: 'Multi-model intrinsic value weighted average',
    summaryKo: 'DCF(35%), 오너이익(35%), EV/EBITDA(20%), 잔여이익(10%)의 가중 평균 내재가치와 현재 시가총액의 괴리율로 신호를 결정합니다.',
    summaryEn: 'Determines the signal from the weighted gap between market cap and blended intrinsic value: DCF (35%), owner earnings (35%), EV/EBITDA (20%), residual income (10%).',
    weightsKo: ['DCF: 35%', '오너이익: 35%', 'EV/EBITDA: 20%', '잔여이익: 10%'],
    weightsEn: ['DCF: 35%', 'Owner earnings: 35%', 'EV/EBITDA: 20%', 'Residual income: 10%'],
    buyRuleKo: '가중 괴리율이 +15% 초과이면 Buy 성향입니다. 즉, 내재가치가 시가총액보다 15% 이상 높을 때입니다.',
    buyRuleEn: 'Weighted gap above +15% leans Buy — blended intrinsic value is 15%+ above market cap.',
    sellRuleKo: '가중 괴리율이 -15% 미만이면 Sell 성향입니다. 즉, 시가총액이 내재가치보다 15% 이상 높을 때입니다.',
    sellRuleEn: 'Weighted gap below -15% leans Sell — market cap is 15%+ above blended intrinsic value.',
    buySignalsKo: ['FCF 기반 DCF 내재가치가 시가총액보다 15% 이상 높으면 강한 가점입니다.', '오너이익 DCF는 성장률 5%, 요구수익률 15%, 안전마진 25%를 기본값으로 계산합니다.', 'EV/EBITDA가 섹터 벤치마크 대비 낮으면 가치 불일치 신호를 제공합니다.'],
    buySignalsEn: ['FCF-based DCF intrinsic value at least 15% above market cap is a strong positive.', 'Owner earnings DCF uses 5% growth, 15% required return, and 25% margin of safety by default.', 'EV/EBITDA below sector benchmark suggests value mispricing.'],
    sellSignalsKo: ['FCF가 음수이거나 EBITDA 데이터가 없으면 해당 모델을 계산할 수 없습니다.', '시가총액이 모든 내재가치 추정치보다 15% 이상 높으면 약세입니다.', '모든 방법이 유효한 값을 산출하지 못하면 전체 가중 괴리율도 계산되지 않습니다.'],
    sellSignalsEn: ['Negative FCF or missing EBITDA prevents those models from computing.', 'Market cap exceeding all intrinsic value estimates by 15%+ is bearish.', 'If all methods produce invalid values, the overall weighted gap cannot be computed.'],
  },
];

const CATEGORY_LABELS: Record<string, { ko: string; en: string }> = {
  all:       { ko: '전체', en: 'All' },
  value:     { ko: '가치 투자', en: 'Value Investing' },
  growth:    { ko: '성장 투자', en: 'Growth Investing' },
  macro:     { ko: '거시 및 행동주의', en: 'Macro & Activist' },
  technical: { ko: '기술 및 분석', en: 'Technical & Analysis' },
};

/** Agent card with expandable formula details + LLM role info */
function AgentCardWithDetails({ agent, isKo }: { agent: AgentScoringGuide; isKo: boolean }) {
  const [showFormula, setShowFormula] = useState(false);
  const [showLLM, setShowLLM] = useState(false);
  const formula = agentFormulas[agent.nameEn];

  return (
    <article className="rounded-md border border-border/70 bg-background/70 p-4">
      {/* --- Header --- */}
      <div className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">
              {isKo ? agent.nameKo : agent.nameEn}
            </h3>
            <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {isKo ? agent.styleKo : agent.styleEn}
            </span>
            {formula && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${formula.llmModelTier === 'tier1' ? 'text-purple-400 border-purple-500/30 bg-purple-500/10' : formula.llmModelTier === 'tier2' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' : 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'}`}>
                {formula.llmModel}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            {isKo ? agent.summaryKo : agent.summaryEn}
          </p>
        </div>
      </div>

      {/* --- Weight tags --- */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(isKo ? agent.weightsKo : agent.weightsEn).map((weight) => (
          <span key={weight} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            {weight}
          </span>
        ))}
      </div>

      {/* --- Score / Buy / Sell grid --- */}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-muted/10 p-3">
          <p className="text-xs font-semibold text-primary">{isKo ? '점수 구조' : 'Score Structure'}</p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">{isKo ? agent.buyRuleKo : agent.buyRuleEn}</p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">{isKo ? agent.sellRuleKo : agent.sellRuleEn}</p>
        </div>
        <div className="rounded-md border border-blue-500/25 bg-blue-500/5 p-3">
          <p className="text-xs font-semibold text-blue-500">{isKo ? 'Buy 기준이 되는 조건' : 'Buy-Side Signals'}</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-6 text-muted-foreground">
            {(isKo ? agent.buySignalsKo : agent.buySignalsEn).map((item) => (<li key={item}>{item}</li>))}
          </ul>
        </div>
        <div className="rounded-md border border-red-500/25 bg-red-500/5 p-3">
          <p className="text-xs font-semibold text-red-400">{isKo ? 'Sell 기준이 되는 조건' : 'Sell-Side Signals'}</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-6 text-muted-foreground">
            {(isKo ? agent.sellSignalsKo : agent.sellSignalsEn).map((item) => (<li key={item}>{item}</li>))}
          </ul>
        </div>
      </div>

      {/* --- Drill-down buttons --- */}
      {formula && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowFormula(v => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${showFormula ? 'border-amber-500 bg-amber-500/20 text-amber-400' : 'border-border bg-muted/20 text-muted-foreground hover:border-amber-500/50 hover:text-amber-400'}`}>
            <Sigma className="h-3 w-3" /> {showFormula ? (isKo ? '공식 접기' : 'Hide Formulas') : (isKo ? '📐 공식 상세보기' : '📐 Formula Details')}
          </button>
          <button type="button" onClick={() => setShowLLM(v => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${showLLM ? 'border-purple-500 bg-purple-500/20 text-purple-400' : 'border-border bg-muted/20 text-muted-foreground hover:border-purple-500/50 hover:text-purple-400'}`}>
            <Cpu className="h-3 w-3" /> {showLLM ? (isKo ? 'LLM 접기' : 'Hide LLM') : (isKo ? '🤖 LLM 역할' : '🤖 LLM Role')}
          </button>
        </div>
      )}

      {/* ────────── Formula Detail Panel ────────── */}
      {showFormula && formula && (
        <div className="mt-4 space-y-3 rounded-md border border-amber-500/25 bg-amber-500/5 p-4 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 border-b border-amber-500/20 pb-2">
            <FlaskConical className="h-4 w-4 text-amber-400" />
            <h4 className="text-xs font-bold text-amber-400">{isKo ? '정량 평가 공식 세부' : 'Quantitative Scoring Formula Details'}</h4>
          </div>

          {/* Axes table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/50">
                <th className="py-1.5 pr-3 text-left font-semibold text-muted-foreground">{isKo ? '평가축' : 'Axis'}</th>
                <th className="py-1.5 pr-3 text-left font-semibold text-muted-foreground">{isKo ? '배점' : 'Max'}</th>
                <th className="py-1.5 text-left font-semibold text-muted-foreground">{isKo ? '판정 공식' : 'Formula'}</th>
              </tr></thead>
              <tbody>
                {formula.axes.map((axis) => (
                  <tr key={axis.nameEn} className="border-b border-border/30">
                    <td className="py-2 pr-3 font-medium text-primary whitespace-nowrap">{isKo ? axis.nameKo : axis.nameEn}</td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{axis.maxScore}</td>
                    <td className="py-2 text-muted-foreground font-mono text-[11px] leading-5">{isKo ? axis.formulaKo : axis.formulaEn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* DCF steps */}
          {formula.dcf && (
            <div className="rounded-md border border-border/50 bg-background/50 p-3">
              <p className="text-xs font-bold text-primary mb-2">{isKo ? formula.dcf.titleKo : formula.dcf.titleEn}</p>
              <ol className="list-decimal list-inside space-y-1">
                {(isKo ? formula.dcf.stepsKo : formula.dcf.stepsEn).map((step, i) => (
                  <li key={i} className="text-[11px] font-mono leading-5 text-muted-foreground">{step}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Sector adjustments */}
          {formula.sectorAdjustments.length > 0 && (
            <div className="rounded-md border border-border/50 bg-background/50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="h-3.5 w-3.5 text-amber-400" />
                <p className="text-xs font-bold text-primary">{isKo ? '섹터별 보정' : 'Sector Calibration'}</p>
              </div>
              <div className="space-y-2">
                {formula.sectorAdjustments.map((sa) => (
                  <div key={sa.sector} className="rounded border border-border/40 bg-muted/10 p-2">
                    <p className="text-[11px] font-semibold text-primary mb-1">{isKo ? sa.sectorKo : sa.sector}</p>
                    <ul className="space-y-0.5">
                      {(isKo ? sa.adjustmentsKo : sa.adjustmentsEn).map((adj, i) => (
                        <li key={i} className="text-[11px] leading-5 text-muted-foreground">• {adj}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ────────── LLM Role Panel ────────── */}
      {showLLM && formula && (
        <div className="mt-4 space-y-3 rounded-md border border-purple-500/25 bg-purple-500/5 p-4 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 border-b border-purple-500/20 pb-2">
            <Cpu className="h-4 w-4 text-purple-400" />
            <h4 className="text-xs font-bold text-purple-400">{isKo ? 'LLM 모델 역할 배치' : 'LLM Model Role Assignment'}</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-border/40 bg-background/50 p-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">{isKo ? '담당 모델' : 'Assigned Model'}</p>
              <p className={`text-sm font-bold ${formula.llmModelTier === 'tier1' ? 'text-purple-400' : formula.llmModelTier === 'tier2' ? 'text-blue-400' : 'text-cyan-400'}`}>{formula.llmModel}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{isKo ? formula.llmReasonKo : formula.llmReasonEn}</p>
            </div>
            <div className="rounded border border-border/40 bg-background/50 p-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">{isKo ? '파이프라인 위치' : 'Pipeline Stage'}</p>
              <div className="flex items-center gap-1 mt-1">
                {[1,2,3,4,5].map((s) => (
                  <div key={s} className={`h-2 flex-1 rounded-full transition-all ${s === formula.pipelineStage ? (formula.llmModelTier === 'tier1' ? 'bg-purple-500' : formula.llmModelTier === 'tier2' ? 'bg-blue-500' : 'bg-cyan-500') : 'bg-muted/40'}`} />
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stage {formula.pipelineStage}: {isKo ? llmPipelineStages[formula.pipelineStage - 1]?.titleKo : llmPipelineStages[formula.pipelineStage - 1]?.titleEn}
              </p>
            </div>
          </div>
          <div className="rounded border border-border/40 bg-background/50 p-3">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">{isKo ? '프롬프트 구조 (미리보기)' : 'Prompt Structure (Preview)'}</p>
            <p className="text-[11px] leading-5 text-muted-foreground italic">&ldquo;{isKo ? formula.promptPreviewKo : formula.promptPreviewEn}&rdquo;</p>
          </div>
        </div>
      )}
    </article>
  );
}

/** LLM Architecture Overview section */
function LLMArchitectureSection({ isKo }: { isKo: boolean }) {
  return (
    <section className="rounded-md border border-border/70 bg-muted/10 p-5">
      <div className="flex items-center gap-3 border-b border-border/70 pb-4">
        <Layers className="h-4 w-4 text-purple-500" />
        <h2 className="text-base font-semibold text-primary">
          {isKo ? 'LLM 모델 아키텍처 & 파이프라인' : 'LLM Model Architecture & Pipeline'}
        </h2>
      </div>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">
        {isKo
          ? '각 파이프라인 단계에 최적의 모델이 배치됩니다. Tier 1은 깊은 추론, Tier 2는 핵심 분석, Tier 3은 대량 경량 처리를 담당합니다.'
          : 'Each pipeline stage is served by the optimal model. Tier 1 handles deep reasoning, Tier 2 core analysis, and Tier 3 high-volume lightweight processing.'}
      </p>

      {/* Pipeline stages */}
      <div className="mt-5 grid gap-2">
        {llmPipelineStages.map((stage) => (
          <div key={stage.stage} className="flex items-start gap-3 rounded border border-border/40 bg-background/50 p-3">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-purple-500/40 bg-purple-500/10 text-xs font-bold text-purple-400">
              {stage.stage}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-primary">{isKo ? stage.titleKo : stage.titleEn}</p>
                <span className="rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{stage.model}</span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{isKo ? stage.descKo : stage.descEn}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Model roles */}
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {llmModelRoles.map((role) => (
          <div key={role.model} className={`rounded-md border p-3 ${role.colorClass}`}>
            <p className="text-xs font-bold">{role.model}</p>
            <p className="mt-0.5 text-[10px] font-medium opacity-80">{isKo ? role.tierKo : role.tierEn}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {role.agents.map((a) => (
                <span key={a} className="rounded bg-background/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">{a}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MainGuide({ language }: { language: 'ko' | 'en' }) {
  const isKo = language === 'ko';
  const [showAgentScoring, setShowAgentScoring] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
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

            <div className="mt-4 flex flex-col gap-3 border-b border-border/70 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedCategory(key)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      selectedCategory === key
                        ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                        : 'border-border bg-muted/20 text-muted-foreground hover:border-blue-500/50 hover:text-blue-400'
                    }`}
                  >
                    {isKo ? label.ko : label.en}
                  </button>
                ))}
              </div>
              <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isKo ? '에이전트 이름 검색...' : 'Search agent name...'}
                  className="w-full rounded-md border border-border bg-background/70 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              {(() => {
                const q = searchQuery.trim().toLowerCase();
                const filtered = agentScoringGuides.filter((a) => {
                  const matchCat = selectedCategory === 'all' || a.category === selectedCategory;
                  const matchQ = !q || a.nameKo.includes(q) || a.nameEn.toLowerCase().includes(q);
                  return matchCat && matchQ;
                });
                if (filtered.length === 0) {
                  return (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {isKo ? '검색 결과가 없습니다.' : 'No agents match your search.'}
                    </p>
                  );
                }
                return filtered.map((agent) => (
                <AgentCardWithDetails key={agent.nameEn} agent={agent} isKo={isKo} />
                ));
              })()}
            </div>
          </section>
        )}

        {/* LLM Model Architecture Overview Section */}
        {showAgentScoring && (
          <LLMArchitectureSection isKo={isKo} />
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
