/**
 * Detailed formula and sector calibration data for each analyst agent.
 * Used by the Home tab's deep-dive views.
 */

export interface FormulaAxis {
  nameKo: string;
  nameEn: string;
  maxScore: string;
  formulaKo: string;
  formulaEn: string;
}

export interface SectorAdjustment {
  sector: string;
  sectorKo: string;
  adjustmentsKo: string[];
  adjustmentsEn: string[];
}

export interface DCFDetail {
  titleKo: string;
  titleEn: string;
  stepsKo: string[];
  stepsEn: string[];
}

export interface AgentFormula {
  agentKey: string;
  axes: FormulaAxis[];
  dcf?: DCFDetail;
  sectorAdjustments: SectorAdjustment[];
  llmModel: string;
  llmModelTier: 'tier1' | 'tier2' | 'tier3';
  llmReasonKo: string;
  llmReasonEn: string;
  promptPreviewKo: string;
  promptPreviewEn: string;
  pipelineStage: number; // 1-5
}

export const agentFormulas: Record<string, AgentFormula> = {
  'Warren Buffett': {
    agentKey: 'warren_buffett',
    axes: [
      { nameKo: '펀더멘털', nameEn: 'Fundamentals', maxScore: '7점', formulaKo: 'ROE>15%(+2), D/E<0.5(+2), OPM>15%(+2), CR>1.5(+1)', formulaEn: 'ROE>15%(+2), D/E<0.5(+2), OPM>15%(+2), CR>1.5(+1)' },
      { nameKo: '이익 일관성', nameEn: 'Consistency', maxScore: '3점', formulaKo: '4기 이상 순이익 연속 증가 → +3', formulaEn: '4+ periods consecutive NI growth → +3' },
      { nameKo: '경쟁 해자', nameEn: 'Moat', maxScore: '5점', formulaKo: 'ROE 일관성(+2), 마진 안정(+1), 자산효율(+1), 경쟁포지션(+1)', formulaEn: 'ROE consistency(+2), margin stability(+1), asset efficiency(+1), competitive position(+1)' },
      { nameKo: '경영진', nameEn: 'Management', maxScore: '2점', formulaKo: '자사주 매입(+1), 배당 기록(+1)', formulaEn: 'Share buybacks(+1), dividend record(+1)' },
      { nameKo: '가격 결정력', nameEn: 'Pricing Power', maxScore: '5점', formulaKo: '총마진 개선(+3), 총마진>50%(+2)', formulaEn: 'Gross margin expansion(+3), GM>50%(+2)' },
      { nameKo: '장부가치 성장', nameEn: 'Book Value Growth', maxScore: '5점', formulaKo: '성장 일관성 80%↑(+3), CAGR 15%↑(+2)', formulaEn: 'Consistency 80%+(+3), CAGR 15%+(+2)' },
    ],
    dcf: {
      titleKo: '3단계 DCF (Owner Earnings 기반)',
      titleEn: '3-Stage DCF (Owner Earnings Based)',
      stepsKo: [
        'OE = 순이익 + D&A - 유지보수CapEx - ΔWC',
        'Stage1(5yr): g₁ = min(historical×0.7, 8%)',
        'Stage2(5yr): g₂ = min(g₁×0.5, 4%)',
        'Terminal: g=2.5%, r=10%',
        '최종 IV = Total PV × 0.85 (15% 헤어컷)',
        '안전마진 = (IV - 시가총액) / 시가총액',
      ],
      stepsEn: [
        'OE = Net Income + D&A - Maintenance CapEx - ΔWC',
        'Stage1(5yr): g₁ = min(historical×0.7, 8%)',
        'Stage2(5yr): g₂ = min(g₁×0.5, 4%)',
        'Terminal: g=2.5%, r=10%',
        'Final IV = Total PV × 0.85 (15% haircut)',
        'MOS = (IV - Market Cap) / Market Cap',
      ],
    },
    sectorAdjustments: [
      { sector: 'Technology', sectorKo: '기술/SaaS', adjustmentsKo: ['유지보수 CapEx를 CapEx×0.70으로 조정 (성장 CapEx 비중↑)', 'D/E 기준 유지, R&D/Rev 15-25% 정상 범위'], adjustmentsEn: ['Maintenance CapEx = CapEx×0.70 (higher growth CapEx ratio)', 'D/E threshold unchanged, R&D/Rev 15-25% normal'] },
      { sector: 'Financials', sectorKo: '금융', adjustmentsKo: ['ROIC 대신 ROE 사용', 'D/E 기준 3.0으로 완화 (은행 레버리지 정상)', 'NCAV 비적용 → P/TBV < 1.0 대체'], adjustmentsEn: ['Use ROE instead of ROIC', 'D/E threshold relaxed to 3.0 (bank leverage is normal)', 'Skip NCAV → use P/TBV < 1.0 instead'] },
      { sector: 'Energy', sectorKo: '에너지/유틸리티', adjustmentsKo: ['유지보수 CapEx를 CapEx×0.90 (대부분 유지보수)', 'ROE 기준 10%로 완화', 'Terminal Growth 1.5%'], adjustmentsEn: ['Maintenance CapEx = CapEx×0.90 (mostly maintenance)', 'ROE threshold relaxed to 10%', 'Terminal Growth 1.5%'] },
      { sector: 'Healthcare', sectorKo: '헬스케어/바이오', adjustmentsKo: ['D/E 기준 0.3으로 강화', 'ERP +2% (고위험 프리미엄)', 'R&D/Rev 20-40% 정상 범위'], adjustmentsEn: ['D/E threshold tightened to 0.3', 'ERP +2% (high-risk premium)', 'R&D/Rev 20-40% normal range'] },
    ],
    llmModel: 'Claude Sonnet',
    llmModelTier: 'tier2',
    llmReasonKo: '투자 철학 역할극과 정량 분석의 균형에 최적화된 모델',
    llmReasonEn: 'Optimized for balancing investment philosophy role-play and quantitative analysis',
    promptPreviewKo: '당신은 워런 버핏입니다. 우량 기업의 장기 복리 성장을 통한 가치 투자 철학으로 분석하세요. 펀더멘털→일관성→해자→내재가치 순으로 평가하고 안전마진을 계산하세요.',
    promptPreviewEn: 'You are Warren Buffett. Analyze through value investing philosophy of long-term compounding in quality businesses. Evaluate fundamentals→consistency→moat→intrinsic value and calculate margin of safety.',
    pipelineStage: 2,
  },
  'Charlie Munger': {
    agentKey: 'charlie_munger',
    axes: [
      { nameKo: '해자', nameEn: 'Moat', maxScore: '35%', formulaKo: 'ROIC>15% 지속율 80%→10/10, 60%→7/10', formulaEn: 'ROIC>15% consistency 80%→10/10, 60%→7/10' },
      { nameKo: '경영진', nameEn: 'Management', maxScore: '25%', formulaKo: 'FCF/NI>80%(10/10), D/E<0.5(+3), 주식수 관리(+2)', formulaEn: 'FCF/NI>80%(10/10), D/E<0.5(+3), share discipline(+2)' },
      { nameKo: '예측가능성', nameEn: 'Predictability', maxScore: '25%', formulaKo: 'Revenue CV<0.15(+3), OI CV<0.15(+3), Margin CV<0.10(+2)', formulaEn: 'Revenue CV<0.15(+3), OI CV<0.15(+3), Margin CV<0.10(+2)' },
      { nameKo: '밸류에이션', nameEn: 'Valuation', maxScore: '15%', formulaKo: 'OE Yield>8%(10/10), >5%(7/10), >3%(5/10)', formulaEn: 'OE Yield>8%(10/10), >5%(7/10), >3%(5/10)' },
    ],
    sectorAdjustments: [
      { sector: 'Financials', sectorKo: '금융', adjustmentsKo: ['ROIC 대신 ROE 사용'], adjustmentsEn: ['Use ROE instead of ROIC'] },
      { sector: 'Consumer Staples', sectorKo: '필수소비재', adjustmentsKo: ['예측가능성 점수 +0.5 보너스'], adjustmentsEn: ['Predictability score +0.5 bonus'] },
    ],
    llmModel: 'Claude Sonnet', llmModelTier: 'tier2',
    llmReasonKo: '엄격한 품질 기준과 정성적 판단의 조화', llmReasonEn: 'Balances strict quality criteria with qualitative judgment',
    promptPreviewKo: '당신은 찰리 멍거입니다. 위대한 기업을 합리적 가격에 사는 것에 집중하세요.', promptPreviewEn: 'You are Charlie Munger. Focus on buying great businesses at fair prices.',
    pipelineStage: 2,
  },
  'Aswath Damodaran': {
    agentKey: 'aswath_damodaran',
    axes: [
      { nameKo: '성장/재투자', nameEn: 'Growth/Reinvestment', maxScore: '4점', formulaKo: 'Rev CAGR>8%(+2), >3%(+1), FCFF성장(+1), ROIC>10%(+1)', formulaEn: 'Rev CAGR>8%(+2), >3%(+1), FCFF growth(+1), ROIC>10%(+1)' },
      { nameKo: '리스크 프로필', nameEn: 'Risk Profile', maxScore: '3점', formulaKo: 'Beta<1.3(+1), D/E<1(+1), IC>3×(+1)', formulaEn: 'Beta<1.3(+1), D/E<1(+1), IC>3×(+1)' },
      { nameKo: '상대가치', nameEn: 'Relative Value', maxScore: '1점', formulaKo: 'P/E < 5yr median×0.7(+1), >1.3(−1)', formulaEn: 'P/E < 5yr median×0.7(+1), >1.3(−1)' },
    ],
    dcf: {
      titleKo: 'FCFF DCF (다모다란식)',
      titleEn: 'FCFF DCF (Damodaran Style)',
      stepsKo: [
        'CAPM: r_e = 4% + β × 5%',
        'Base Growth = min(5yr Rev CAGR, 12%)',
        '10년간 g → 2.5% 선형 fade',
        'Terminal = FCFF × (1+2.5%) / (r_e - 2.5%)',
        'MOS = (Equity Value - MC) / MC',
        'Buy: MOS ≥ 25% / Sell: MOS ≤ −25%',
      ],
      stepsEn: [
        'CAPM: r_e = 4% + β × 5%',
        'Base Growth = min(5yr Rev CAGR, 12%)',
        '10yr linear fade g → 2.5%',
        'Terminal = FCFF × (1+2.5%) / (r_e - 2.5%)',
        'MOS = (Equity Value - MC) / MC',
        'Buy: MOS ≥ 25% / Sell: MOS ≤ −25%',
      ],
    },
    sectorAdjustments: [
      { sector: 'Technology', sectorKo: '기술', adjustmentsKo: ['ERP +1% → 6%'], adjustmentsEn: ['ERP +1% → 6%'] },
      { sector: 'Utilities', sectorKo: '유틸리티', adjustmentsKo: ['ERP −1% → 4%'], adjustmentsEn: ['ERP −1% → 4%'] },
      { sector: 'Emerging', sectorKo: '신흥시장', adjustmentsKo: ['한국: CRP +1.5%, 인도: CRP +3%'], adjustmentsEn: ['Korea: CRP +1.5%, India: CRP +3%'] },
    ],
    llmModel: 'GPT Pro 5.4', llmModelTier: 'tier1',
    llmReasonKo: '수치 추론과 DCF 시나리오 분석에 최적', llmReasonEn: 'Optimal for numerical reasoning and DCF scenario analysis',
    promptPreviewKo: '당신은 NYU Stern의 다모다란 교수입니다. 스토리→숫자→가치 순으로 분석하세요.', promptPreviewEn: 'You are Prof. Damodaran of NYU Stern. Analyze: Story→Numbers→Value.',
    pipelineStage: 2,
  },
  'Cathie Wood': {
    agentKey: 'cathie_wood',
    axes: [
      { nameKo: '파괴적 잠재력', nameEn: 'Disruptive Potential', maxScore: '5점', formulaKo: 'Rev 가속(+2), RevG>50%(+2), R&D/Rev>15%(+1)', formulaEn: 'Rev acceleration(+2), RevG>50%(+2), R&D/Rev>15%(+1)' },
      { nameKo: '혁신 성장', nameEn: 'Innovation Growth', maxScore: '5점', formulaKo: 'RevG>100%(+3), 양의 OL(+1), GM확대(+1)', formulaEn: 'RevG>100%(+3), positive OL(+1), GM expanding(+1)' },
      { nameKo: '고성장 밸류에이션', nameEn: 'High-Growth Valuation', maxScore: '5점', formulaKo: '고성장 DCF: g=20%, r=15%, Terminal 25×FCF', formulaEn: 'High-growth DCF: g=20%, r=15%, Terminal 25×FCF' },
    ],
    sectorAdjustments: [
      { sector: 'SaaS/Cloud', sectorKo: 'SaaS/클라우드', adjustmentsKo: ['R&D 기준 20%로 상향'], adjustmentsEn: ['R&D threshold raised to 20%'] },
      { sector: 'Biotech', sectorKo: '바이오텍', adjustmentsKo: ['매출 대신 파이프라인 단계 평가'], adjustmentsEn: ['Evaluate pipeline stages instead of revenue'] },
      { sector: 'EV', sectorKo: '전기차', adjustmentsKo: ['생산능력 CAGR을 매출 대리지표로 활용'], adjustmentsEn: ['Use production capacity CAGR as revenue proxy'] },
    ],
    llmModel: 'Claude Sonnet', llmModelTier: 'tier2',
    llmReasonKo: '혁신 기업의 정성적 판단과 시나리오 분석 균형', llmReasonEn: 'Balances qualitative judgment on innovation with scenario analysis',
    promptPreviewKo: '당신은 캐시 우드입니다. 파괴적 혁신과 5년 이상 장기 성장 잠재력을 중심으로 분석하세요.', promptPreviewEn: 'You are Cathie Wood. Focus on disruptive innovation and 5+ year growth potential.',
    pipelineStage: 2,
  },
  'Ben Graham': {
    agentKey: 'ben_graham',
    axes: [
      { nameKo: '이익 안정성', nameEn: 'Earnings Stability', maxScore: '4점', formulaKo: 'EPS 전 기간 양수(+3), EPS 증가(+1)', formulaEn: 'EPS positive all periods(+3), EPS growth(+1)' },
      { nameKo: '재무 건전성', nameEn: 'Financial Strength', maxScore: '5점', formulaKo: 'CR≥2.0(+2), Debt/Assets<0.5(+2), 배당기록(+1)', formulaEn: 'CR≥2.0(+2), Debt/Assets<0.5(+2), dividend record(+1)' },
      { nameKo: '그레이엄 가치평가', nameEn: 'Graham Valuation', maxScore: '6점', formulaKo: 'NCAV>MC(+3), Graham Number MOS>50%(+3)', formulaEn: 'NCAV>MC(+3), Graham Number MOS>50%(+3)' },
    ],
    dcf: {
      titleKo: 'Graham Number 공식', titleEn: 'Graham Number Formula',
      stepsKo: ['NCAV = 유동자산 - 총부채', 'Graham Number = √(22.5 × EPS × BPS)', 'MOS = (Graham Number - 주가) / Graham Number', 'Buy: 총점 ≥ 10.5 (70%)'],
      stepsEn: ['NCAV = Current Assets - Total Liabilities', 'Graham Number = √(22.5 × EPS × BPS)', 'MOS = (Graham Number - Price) / Graham Number', 'Buy: Total ≥ 10.5 (70%)'],
    },
    sectorAdjustments: [
      { sector: 'Financials', sectorKo: '금융', adjustmentsKo: ['NCAV 비적용 → P/TBV<1.0 대체', 'CR 기준 제외 (은행)'], adjustmentsEn: ['Skip NCAV → use P/TBV<1.0', 'Skip CR check (banks)'] },
      { sector: 'Technology', sectorKo: '기술', adjustmentsKo: ['CR 기준 1.5로 완화'], adjustmentsEn: ['CR threshold relaxed to 1.5'] },
    ],
    llmModel: 'Claude Sonnet', llmModelTier: 'tier2',
    llmReasonKo: '보수적 가치 평가의 정량적 규율', llmReasonEn: 'Quantitative discipline of conservative valuation',
    promptPreviewKo: '당신은 벤 그레이엄입니다. 안전마진과 방어적 가치에 집중하세요.', promptPreviewEn: 'You are Ben Graham. Focus on margin of safety and defensive value.',
    pipelineStage: 2,
  },
  'Peter Lynch': {
    agentKey: 'peter_lynch',
    axes: [
      { nameKo: '성장', nameEn: 'Growth', maxScore: '30%', formulaKo: 'RevG>25%(+3), >10%(+2), >2%(+1); EPS동일', formulaEn: 'RevG>25%(+3), >10%(+2), >2%(+1); EPS same' },
      { nameKo: '가치', nameEn: 'Valuation', maxScore: '25%', formulaKo: 'P/E<15(+3), PEG<1(+3), D/E<0.5(+2), FCF+(+2)', formulaEn: 'P/E<15(+3), PEG<1(+3), D/E<0.5(+2), FCF+(+2)' },
      { nameKo: '기초체력', nameEn: 'Fundamentals', maxScore: '20%', formulaKo: 'ROE, 마진, 유동비율 종합', formulaEn: 'ROE, margins, current ratio composite' },
      { nameKo: '뉴스', nameEn: 'News', maxScore: '15%', formulaKo: '긍정>70%(+10), >50%(+7), 부정>30%(+3)', formulaEn: 'Positive>70%(+10), >50%(+7), negative>30%(+3)' },
      { nameKo: '내부자', nameEn: 'Insiders', maxScore: '10%', formulaKo: '순매수 여부', formulaEn: 'Net buying presence' },
    ],
    sectorAdjustments: [],
    llmModel: 'Claude Sonnet', llmModelTier: 'tier2',
    llmReasonKo: 'PEG 기반 GARP 분석의 설명력 요구', llmReasonEn: 'Requires explanatory power for PEG-based GARP analysis',
    promptPreviewKo: '당신은 피터 린치입니다. PEG 비율과 이해할 수 있는 성장주를 합리적 가격에 찾으세요.', promptPreviewEn: 'You are Peter Lynch. Find understandable growth stocks at reasonable prices via PEG.',
    pipelineStage: 2,
  },
  'Valuation Analyst': {
    agentKey: 'valuation_analyst',
    axes: [
      { nameKo: 'DCF', nameEn: 'DCF', maxScore: '35%', formulaKo: '3단계 DCF (WACC 기반, Bear/Base/Bull 시나리오)', formulaEn: '3-stage DCF (WACC-based, Bear/Base/Bull scenarios)' },
      { nameKo: '오너이익', nameEn: 'Owner Earnings', maxScore: '35%', formulaKo: 'OE = NI+D&A-CapEx-ΔWC; g=5%, r=15%, MOS=25%', formulaEn: 'OE = NI+D&A-CapEx-ΔWC; g=5%, r=15%, MOS=25%' },
      { nameKo: 'EV/EBITDA', nameEn: 'EV/EBITDA', maxScore: '20%', formulaKo: 'Median historical multiple × EBITDA - net debt', formulaEn: 'Median historical multiple × EBITDA - net debt' },
      { nameKo: '잔여이익', nameEn: 'Residual Income', maxScore: '10%', formulaKo: 'BV + PV(RI stream) × 0.8', formulaEn: 'BV + PV(RI stream) × 0.8' },
    ],
    dcf: {
      titleKo: 'WACC 기반 시나리오 DCF', titleEn: 'WACC-Based Scenario DCF',
      stepsKo: ['WACC = w_e×r_e + w_d×r_d×(1-t)', 'Bear: g×0.5, WACC×1.2', 'Base: g×1.0, WACC×1.0', 'Bull: g×1.5, WACC×0.9', 'Expected = Bear×20% + Base×60% + Bull×20%', 'Buy: Weighted Gap > +15%'],
      stepsEn: ['WACC = w_e×r_e + w_d×r_d×(1-t)', 'Bear: g×0.5, WACC×1.2', 'Base: g×1.0, WACC×1.0', 'Bull: g×1.5, WACC×0.9', 'Expected = Bear×20% + Base×60% + Bull×20%', 'Buy: Weighted Gap > +15%'],
    },
    sectorAdjustments: [],
    llmModel: 'GPT Pro 5.4', llmModelTier: 'tier1',
    llmReasonKo: '수치 추론과 시나리오 분석에 최적', llmReasonEn: 'Optimal for numerical reasoning and scenario analysis',
    promptPreviewKo: '4가지 밸류에이션 모델의 가중 평균으로 내재가치를 산출하세요.', promptPreviewEn: 'Calculate intrinsic value using weighted average of 4 valuation models.',
    pipelineStage: 3,
  },
  'Technical Analyst': {
    agentKey: 'technical_analyst',
    axes: [
      { nameKo: '추세 (ADX)', nameEn: 'Trend (ADX)', maxScore: '25%', formulaKo: 'ADX>25 + 상승방향(+1), 하락(−1)', formulaEn: 'ADX>25 + upward(+1), down(−1)' },
      { nameKo: '모멘텀', nameEn: 'Momentum', maxScore: '25%', formulaKo: '가중 Mom=0.5×M1+0.3×M3+0.2×M6; >0.05(+1)', formulaEn: 'Weighted Mom=0.5×M1+0.3×M3+0.2×M6; >0.05(+1)' },
      { nameKo: '평균회귀', nameEn: 'Mean Reversion', maxScore: '20%', formulaKo: 'Z<−2 & Bollinger<20th(+1); Z>+2 & >80th(−1)', formulaEn: 'Z<−2 & Bollinger<20th(+1); Z>+2 & >80th(−1)' },
      { nameKo: '변동성 레짐', nameEn: 'Volatility Regime', maxScore: '15%', formulaKo: '저변동+추세→신뢰도 부스트', formulaEn: 'Low vol + trending → confidence boost' },
      { nameKo: '허스트 지수', nameEn: 'Hurst Exponent', maxScore: '15%', formulaKo: 'H>0.5→추세, H<0.5→평균회귀', formulaEn: 'H>0.5→trending, H<0.5→mean-reverting' },
    ],
    sectorAdjustments: [],
    llmModel: 'Gemini Pro (Fast)', llmModelTier: 'tier2',
    llmReasonKo: '대량 수치 데이터 처리 및 패턴 인식에 최적', llmReasonEn: 'Optimal for processing large numerical datasets and pattern recognition',
    promptPreviewKo: '5개 기술적 팩터의 가중 앙상블 분석을 수행하세요.', promptPreviewEn: 'Perform weighted ensemble analysis of 5 technical factors.',
    pipelineStage: 2,
  },
  'News Sentiment Analyst': {
    agentKey: 'news_sentiment_analyst',
    axes: [
      { nameKo: 'LLM 신뢰도', nameEn: 'LLM Confidence', maxScore: '70%', formulaKo: '기사별 positive/negative/neutral 분류 신뢰도', formulaEn: 'Per-article positive/negative/neutral classification confidence' },
      { nameKo: '신호 비율', nameEn: 'Signal Proportion', maxScore: '30%', formulaKo: '다수결 신호의 비율', formulaEn: 'Majority signal proportion' },
    ],
    sectorAdjustments: [],
    llmModel: 'Claude Haiku', llmModelTier: 'tier3',
    llmReasonKo: '대량 기사 분류를 빠르고 저렴하게 처리', llmReasonEn: 'Fast and cost-effective processing of large article volumes',
    promptPreviewKo: '기사를 positive/negative/neutral로 분류하고 신뢰도를 평가하세요.', promptPreviewEn: 'Classify articles as positive/negative/neutral with confidence rating.',
    pipelineStage: 2,
  },
};

// LLM Model pipeline architecture data
export const llmPipelineStages = [
  { stage: 1, titleKo: '데이터 수집 및 분류', titleEn: 'Data Collection & Classification', model: 'Gemini Pro (Low) / Haiku', descKo: '섹터 분류, 데이터 유효성 검증, 기초 전처리', descEn: 'Sector classification, data validation, preprocessing' },
  { stage: 2, titleKo: '개별 에이전트 분석', titleEn: 'Individual Agent Analysis', model: 'Sonnet / Gemini Pro (Fast)', descKo: '정량 평가 + 정성 분석 코멘트 생성', descEn: 'Quantitative evaluation + qualitative analysis comments' },
  { stage: 3, titleKo: '밸류에이션 심층 분석', titleEn: 'Valuation Deep Dive', model: 'GPT Pro 5.4', descKo: 'DCF 시나리오, WACC 산출, 내재가치 교차 검증', descEn: 'DCF scenarios, WACC calculation, intrinsic value cross-validation' },
  { stage: 4, titleKo: '포트폴리오 종합', titleEn: 'Portfolio Synthesis', model: 'Claude Opus', descKo: '전체 에이전트 신호 종합, 최종 투자 결정', descEn: 'Synthesize all agent signals, final investment decision' },
  { stage: 5, titleKo: '보고서 생성', titleEn: 'Report Generation', model: 'Sonnet / Haiku', descKo: '사용자향 최종 보고서, 한/영 번역', descEn: 'User-facing final report, KR/EN translation' },
];

export const llmModelRoles = [
  { model: 'Claude Opus', tierKo: 'Tier 1: 최상위 추론', tierEn: 'Tier 1: Deep Reasoning', agents: ['Portfolio Manager'], colorClass: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  { model: 'GPT Pro 5.4', tierKo: 'Tier 1: 복합 밸류에이션', tierEn: 'Tier 1: Complex Valuation', agents: ['Valuation Analyst', 'Aswath Damodaran', 'Nassim Taleb'], colorClass: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  { model: 'Claude Sonnet', tierKo: 'Tier 2: 핵심 분석', tierEn: 'Tier 2: Core Analysis', agents: ['Warren Buffett', 'Charlie Munger', 'Ben Graham', 'Peter Lynch', 'Phil Fisher', 'Mohnish Pabrai', 'Bill Ackman', 'Michael Burry', 'Stanley Druckenmiller', 'Cathie Wood', 'Rakesh Jhunjhunwala'], colorClass: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  { model: 'Gemini Pro (Fast)', tierKo: 'Tier 2: 데이터 중심', tierEn: 'Tier 2: Data-Centric', agents: ['Technical Analyst', 'Fundamentals Analyst'], colorClass: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  { model: 'Gemini Pro (Low)', tierKo: 'Tier 3: 보조 분석', tierEn: 'Tier 3: Auxiliary', agents: ['Sector Classification', 'Data Validation'], colorClass: 'text-gray-400 border-gray-500/30 bg-gray-500/10' },
  { model: 'Claude Haiku', tierKo: 'Tier 3: 경량 처리', tierEn: 'Tier 3: Lightweight', agents: ['News Sentiment', 'Sentiment Analyst', 'Growth Analyst'], colorClass: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
];
