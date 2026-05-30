// Curated analyst combinations ("recommended combos") grouped by theme.
// Each preset applies a fixed set of analyst keys. Keys that are not present
// in the loaded agents list are filtered out at apply time, so it is safe to
// reference an analyst here even if it is later removed from ANALYST_CONFIG.
//
// To tweak a combination, edit `agentKeys` below. Order does not matter.

export interface AgentPreset {
  id: string;
  labelKo: string;
  labelEn: string;
  tooltipKo: string;
  tooltipEn: string;
  agentKeys: string[];
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'semiconductor_rerating',
    labelKo: '반도체·메모리 리레이팅',
    labelEn: 'Semiconductor Rerating',
    tooltipKo:
      '반도체 사이클의 구조적 재평가(리레이팅)를 포착하는 조합입니다. 리레이팅 전문가가 사이클 위치를, 가치평가·기본적 분석가가 적정가치를, 성장 분석가가 이익 확장을, 드러켄밀러가 거시 타이밍을, 뉴스 감성이 모멘텀을 점검합니다. SK하이닉스·마이크론 같은 메모리주에 적합합니다.',
    tooltipEn:
      'Captures the structural rerating of the semiconductor cycle. The rerating specialist reads cycle position, valuation & fundamentals set fair value, growth tracks earnings expansion, Druckenmiller times the macro, and news sentiment gauges momentum. Best for memory names like SK Hynix / Micron.',
    agentKeys: [
      'semiconductor_rerating_analyst',
      'valuation_analyst',
      'growth_analyst',
      'stanley_druckenmiller',
      'fundamentals_analyst',
      'news_sentiment_analyst',
    ],
  },
  {
    id: 'deep_value',
    labelKo: '가치·내재가치 심층',
    labelEn: 'Deep Value',
    tooltipKo:
      '기업의 내재가치를 여러 각도로 교차검증하는 조합입니다. 다모다란의 DCF, 가치평가 분석가의 멀티모델, 그레이엄의 안전마진, 버핏의 해자·품질, 기본적 재무 건전성을 함께 보면서 "싸게 사는" 기회를 찾습니다.',
    tooltipEn:
      'Cross-checks intrinsic value from multiple angles. Damodaran’s DCF, the valuation multi-model, Graham’s margin of safety, Buffett’s moat & quality, and fundamental health — to find genuinely cheap entries.',
    agentKeys: [
      'aswath_damodaran',
      'valuation_analyst',
      'ben_graham',
      'warren_buffett',
      'fundamentals_analyst',
    ],
  },
  {
    id: 'growth_hunting',
    labelKo: '성장주 발굴',
    labelEn: 'Growth Hunting',
    tooltipKo:
      '고성장·혁신 기업을 발굴하는 조합입니다. 캐시 우드의 파괴적 혁신, 성장 분석가의 매출·이익 가속, 피터 린치의 생활 속 성장주, 필립 피셔의 질적 성장, 뉴스 감성의 시장 관심도를 결합합니다.',
    tooltipEn:
      'Hunts for high-growth, innovative companies. Cathie Wood’s disruptive innovation, the growth analyst’s revenue/earnings acceleration, Peter Lynch’s everyday growth, Phil Fisher’s qualitative growth, and news sentiment for market attention.',
    agentKeys: [
      'cathie_wood',
      'growth_analyst',
      'peter_lynch',
      'phil_fisher',
      'news_sentiment_analyst',
    ],
  },
  {
    id: 'macro_risk_contrarian',
    labelKo: '거시·리스크·역발상',
    labelEn: 'Macro / Risk / Contrarian',
    tooltipKo:
      '거시 환경과 하방 리스크, 역발상 기회를 점검하는 조합입니다. 드러켄밀러의 거시 흐름, 버리의 역발상 숏 관점, 탈레브의 꼬리위험, 애크먼의 행동주의, 기술적 분석의 추세를 함께 봅니다. 변동성 장세나 고평가 구간 점검에 유용합니다.',
    tooltipEn:
      'Stress-tests macro, downside risk, and contrarian setups. Druckenmiller’s macro flow, Burry’s contrarian short lens, Taleb’s tail risk, Ackman’s activism, and technical trend. Useful in volatile or richly-valued markets.',
    agentKeys: [
      'stanley_druckenmiller',
      'michael_burry',
      'nassim_taleb',
      'bill_ackman',
      'technical_analyst',
    ],
  },
  {
    id: 'technical_sentiment',
    labelKo: '기술·심리 단기',
    labelEn: 'Technical / Sentiment',
    tooltipKo:
      '단기 가격 흐름과 시장 심리를 빠르게 점검하는 조합입니다. 기술적 분석의 추세·모멘텀, 시장 심리 지표, 뉴스 감성을 묶어 매매 타이밍을 가볍게 확인할 때 씁니다. (펀더멘털 판단은 포함되지 않습니다.)',
    tooltipEn:
      'Quick read on short-term price action and market mood. Technical trend/momentum, market sentiment, and news sentiment for light timing checks. (No fundamental judgment included.)',
    agentKeys: [
      'technical_analyst',
      'sentiment_analyst',
      'news_sentiment_analyst',
    ],
  },
];
