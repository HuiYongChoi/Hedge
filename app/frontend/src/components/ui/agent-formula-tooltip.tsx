import { Info } from 'lucide-react';
import { useState } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface AgentFormulaGuide {
  title: string;
  summary: string;
  formulas: string[];
  thresholds: string[];
}

export const AGENT_FORMULA_GUIDES: Record<string, { ko: AgentFormulaGuide; en: AgentFormulaGuide }> = {
  warren_buffett: {
    ko: {
      title: '워런 버핏 정량 공식',
      summary: '우량 사업, 보수적 재무구조, Owner Earnings(소유자 이익) 기반 내재가치와 Margin Of Safety(안전마진)를 함께 봅니다.',
      formulas: [
        'Owner Earnings(소유자 이익) = Net Income(순이익) + Depreciation And Amortization(감가상각비) - Maintenance CapEx(유지보수 자본지출) - Working Capital Change(운전자본 변동)',
        'Margin Of Safety(안전마진) = (Intrinsic Value(내재가치) - Market Cap(시가총액)) / Market Cap(시가총액)',
        'Debt-To-Equity(부채비율), Current Ratio(유동비율), ROE(자기자본이익률), Operating Margin(영업이익률)은 TTM 또는 Report Period(보고기간) 라벨과 함께 해석합니다.',
      ],
      thresholds: ['ROE 15% 이상 가점', 'Debt-To-Equity 0.50 미만 가점', 'Current Ratio 1.50x 초과 가점', 'Margin Of Safety 양수일 때 강세 근거 강화'],
    },
    en: {
      title: 'Warren Buffett Quant Formula',
      summary: 'Combines business quality, conservative leverage, Owner Earnings intrinsic value, and Margin Of Safety.',
      formulas: [
        'Owner Earnings = Net Income + Depreciation And Amortization - Maintenance CapEx - Working Capital Change',
        'Margin Of Safety = (Intrinsic Value - Market Cap) / Market Cap',
        'Debt-To-Equity, Current Ratio, ROE, and Operating Margin are interpreted with TTM or Report Period labels.',
      ],
      thresholds: ['ROE above 15% adds points', 'Debt-To-Equity below 0.50 adds points', 'Current Ratio above 1.50x adds points', 'Positive Margin Of Safety strengthens bullish evidence'],
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
      thresholds: ['Current Ratio 2.00x 이상 선호', 'Debt-To-Equity 0.50 이하 가점', 'Graham Number 대비 20~50% 할인 시 가점', 'NCAV가 시가총액보다 높으면 강한 딥밸류 신호'],
    },
    en: {
      title: 'Ben Graham Quant Formula',
      summary: 'Checks conservative Margin Of Safety through Graham Number, NCAV, Current Ratio, and Debt-To-Equity.',
      formulas: [
        'Graham Number = sqrt(22.5 x EPS x Book Value Per Share)',
        'Margin Of Safety = (Graham Number - Current Price) / Current Price',
        'NCAV = Current Assets - Total Liabilities',
      ],
      thresholds: ['Current Ratio of 2.00x or higher is preferred', 'Debt-To-Equity at or below 0.50 adds points', '20-50% discount to Graham Number adds points', 'NCAV above Market Cap is a strong deep-value signal'],
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
    ko: { title: '빌 애크먼 정량 공식', summary: 'Quality(사업 품질), Financial Discipline(재무 규율), Activism Potential(행동주의 가능성), DCF 안전마진을 봅니다.', formulas: ['Margin Of Safety(안전마진) = (Intrinsic Value(내재가치) - Market Cap(시가총액)) / Market Cap(시가총액)', 'Financial Discipline(재무 규율) = Debt-To-Equity(부채비율) + FCF + 배당/자사주'], thresholds: ['안전마진 30% 이상 강세', 'D/E 1.00 미만 기간이 많으면 가점', 'FCF와 마진이 안정적이면 품질 가점'] },
    en: { title: 'Bill Ackman Quant Formula', summary: 'Combines Business Quality, Financial Discipline, Activism Potential, and DCF Margin Of Safety.', formulas: ['Margin Of Safety = (Intrinsic Value - Market Cap) / Market Cap', 'Financial Discipline = Debt-To-Equity + FCF + Dividends/Buybacks'], thresholds: ['Margin Of Safety above 30% is bullish', 'Most periods below 1.00 D/E add points', 'Stable FCF and margins support quality'] },
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
    ko: { title: '가치평가 분석가 정량 공식', summary: 'DCF, Owner Earnings(소유자 이익), EV/EBITDA, Residual Income(잔여이익)을 가중 평균합니다.', formulas: ['Blended Intrinsic Value(혼합 내재가치) = DCF 35% + Owner Earnings 35% + EV/EBITDA 20% + Residual Income 10%', 'Weighted Gap(가중 괴리율) = (Blended Value(혼합가치) - Market Cap(시가총액)) / Market Cap(시가총액)'],
      thresholds: ['가중 괴리율 +15% 초과 강세', '-15% 미만 약세', 'DCF와 Owner Earnings가 각각 35% 비중'] },
    en: { title: 'Valuation Analyst Quant Formula', summary: 'Blends DCF, Owner Earnings, EV/EBITDA, and Residual Income.', formulas: ['Blended Intrinsic Value = DCF 35% + Owner Earnings 35% + EV/EBITDA 20% + Residual Income 10%', 'Weighted Gap = (Blended Value - Market Cap) / Market Cap'], thresholds: ['Weighted gap above +15% is bullish', 'Below -15% is bearish', 'DCF and Owner Earnings each carry 35% weight'] },
  },
  default: {
    ko: {
      title: '에이전트 정량 공식',
      summary: '각 에이전트는 자신의 철학에 맞는 성장성, 수익성, 재무건전성, 밸류에이션 지표를 점수화합니다.',
      formulas: ['Composite Signal(종합 신호) = Agent Signal(에이전트 신호) + Confidence(신뢰도) + 정량 근거', 'Financial Ratios(재무비율)는 0.20처럼 소수점을 보존합니다.'],
      thresholds: ['에이전트 원점수는 서로 다르며 최종 UI에서 0~100점으로 정규화됩니다.', 'N/A 수치는 임의 생성하지 않고 대체 지표와 원문 대조로 보완합니다.'],
    },
    en: {
      title: 'Agent Quant Formula',
      summary: 'Each agent scores growth, profitability, financial strength, and valuation according to its investment philosophy.',
      formulas: ['Composite Signal = Agent Signal + Confidence + Quant Evidence', 'Financial Ratios preserve decimals such as 0.20.'],
      thresholds: ['Raw agent scores differ and are normalized to 0-100 in the final UI.', 'N/A values are not invented; proxy metrics and source checks fill the context.'],
    },
  },
};

export const AGENT_FORMULA_ALIASES: Record<string, keyof typeof AGENT_FORMULA_GUIDES> = {
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

export function extractBaseAgentKey(agentId: string) {
  const withoutAgentSuffix = agentId.replace(/_agent/g, '');
  const parts = withoutAgentSuffix.split('_');
  const suffix = parts[parts.length - 1];

  if (/^[a-z0-9]{6}$/.test(suffix)) {
    return parts.slice(0, -1).join('_');
  }

  return withoutAgentSuffix;
}

export function getAgentFormulaGuide(agentKey: string, language: 'ko' | 'en') {
  const baseKey = extractBaseAgentKey(agentKey);
  const guideKey = AGENT_FORMULA_ALIASES[baseKey] || 'default';
  return AGENT_FORMULA_GUIDES[guideKey][language];
}

export function AgentFormulaTooltip({ agentKey, language }: { agentKey: string; language: 'ko' | 'en' }) {
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

/** Toggle button + expandable panel version for dialogs where Tooltip hover is inconvenient. */
export function AgentFormulaToggle({ agentKey, language }: { agentKey: string; language: 'ko' | 'en' }) {
  const [open, setOpen] = useState(false);
  const guide = getAgentFormulaGuide(agentKey, language);

  return (
    <div className="w-full">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-ring"
        aria-expanded={open}
        aria-label={language === 'ko' ? '정량 공식 펼치기' : 'Toggle quant formula'}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{language === 'ko' ? '정량 공식' : 'Quant formula'}</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed">
          <div>
            <div className="font-semibold text-foreground">{guide.title}</div>
            <p className="mt-1 text-muted-foreground">{guide.summary}</p>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {language === 'ko' ? '핵심 산식' : 'Formulas'}
            </div>
            {guide.formulas.map((formula) => (
              <div key={formula} className="text-muted-foreground">
                {formula}
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t border-border/70 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {language === 'ko' ? '가중치 · 임계값' : 'Weights · Thresholds'}
            </div>
            {guide.thresholds.map((threshold) => (
              <div key={threshold} className="text-muted-foreground">
                {threshold}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
