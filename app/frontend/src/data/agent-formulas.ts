/**
 * Detailed formula and sector calibration data for each analyst agent.
 * Simplified for easy understanding (Middle school level).
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
}

export const agentFormulas: Record<string, AgentFormula> = {
  'Warren Buffett': {
    agentKey: 'warren_buffett',
    axes: [
      { nameKo: '기초 체력 (펀더멘털)', nameEn: 'Fundamentals', maxScore: '7점', formulaKo: 'ROE(자기자본이익률)가 15% 이상, 빚(부채)이 적고 영업이익률이 15%를 넘어야 높은 점수를 받습니다.', formulaEn: 'Gets high scores if ROE is over 15%, debt is low, and Operating Margin is over 15%.' },
      { nameKo: '이익의 꾸준함', nameEn: 'Consistency', maxScore: '3점', formulaKo: '최근 4번의 기간 동안 순이익이 계속 오르면 만점을 줍니다.', formulaEn: 'Full marks if net income has grown for 4 consecutive periods.' },
      { nameKo: '경쟁력 (해자)', nameEn: 'Moat', maxScore: '5점', formulaKo: '수익성이 들쭉날쭉하지 않고 안정적인지, 자산을 잘 굴리는지 봅니다.', formulaEn: 'Checks if profitability is stable, margin is steady, and assets are used efficiently.' },
      { nameKo: '경영진의 태도', nameEn: 'Management', maxScore: '2점', formulaKo: '회사가 주주들을 위해 자사주를 사 모으거나 배당금을 잘 주는지 봅니다.', formulaEn: 'Checks if the company buys back shares or pays consistent dividends.' },
      { nameKo: '가격 결정력', nameEn: 'Pricing Power', maxScore: '5점', formulaKo: '원가를 빼고 남는 이익(총마진)이 계속 좋아지거나, 50% 이상으로 아주 높으면 만점을 줍니다.', formulaEn: 'Full marks if gross margin is improving or extremely high (over 50%).' },
      { nameKo: '회사의 진짜 가치 성장', nameEn: 'Book Value Growth', maxScore: '5점', formulaKo: '회사의 순자산(장스가치)이 매년 꾸준히 그리고 빠르게 (15% 이상) 자라나고 있는지 봅니다.', formulaEn: 'Checks if the company\'s net assets (book value) are growing steadily and fast (15%+).' },
    ],
    dcf: {
      titleKo: '내재가치 계산법 (DCF 방식)',
      titleEn: 'Intrinsic Value Calculation (DCF)',
      stepsKo: [
        '1. 주주 목숨줄 이익(Owner Earnings)을 구합니다 (실제로 회사가 벌어들인 알짜 현금).',
        '2. 처음 5년은 회사의 과거 성장률을 참고해 적절히 성장한다고 가정합니다.',
        '3. 다음 5년은 성장 속도가 절반으로 줄어든다고 조심스럽게 가정합니다.',
        '4. 미래에 벌어들일 돈의 진짜 가치가 지금 얼만지 10% 정도 깎아서(할인) 계산합니다.',
        '5. 안전을 위해 최종 가치에서 15%를 더 깎은 가격보다 현재 주가가 싸면 "Buy"를 외칩니다.'
      ],
      stepsEn: [
        '1. Calculate Owner Earnings (the actual usable cash the company creates).',
        '2. Assume reasonable growth for the first 5 years based on past performance.',
        '3. Assume growth slows down to half for the next 5 years to be safe.',
        '4. Discount future money by 10% to find out what it\'s worth today.',
        '5. Cut the final value by another 15% for a margin of safety. If the stock is cheaper than this, it\'s a "Buy".'
      ],
    },
    sectorAdjustments: [
      { sector: 'Technology', sectorKo: 'IT / 기술주', adjustmentsKo: ['기술 회사는 성장을 위해 돈(투자금)을 많이 써야 하므로, 유지보수 비용 기준을 덜 깐깐하게 봅니다.'], adjustmentsEn: ['Tech companies need to spend a lot to grow, so maintenance cost formulas are relaxed.'] },
      { sector: 'Financials', sectorKo: '금융 (은행, 보험 등)', adjustmentsKo: ['은행은 원래 남의 돈(예금 등)을 많이 굴리므로, 부채가 많아도 점수를 깎지 않습니다.'], adjustmentsEn: ['Banks naturally operate with borrowed money, so the strict debt limits are relaxed.'] },
      { sector: 'Energy', sectorKo: '에너지 / 유틸리티', adjustmentsKo: ['공장이나 설비 유지에 돈이 많이 드므로, 이를 반영해서 이익 기준을 10% 정도로 낮춰서 평가합니다.'], adjustmentsEn: ['As they spend heavily on maintaining facilities, overall profitability standards are lowered to 10%.'] },
    ],
  },
  'Charlie Munger': {
    agentKey: 'charlie_munger',
    axes: [
      { nameKo: '엄청난 경쟁 우위 (해자)', nameEn: 'Moat', maxScore: '35%', formulaKo: 'ROIC(내가 투자한 돈 대비 벌어들이는 수익)가 꾸준히 15%를 넘는지 가장 중요하게 봅니다.', formulaEn: 'Most importantly checks if ROIC (Return on Invested Capital) consistently beats 15%.' },
      { nameKo: '훌륭한 경영진', nameEn: 'Management', maxScore: '25%', formulaKo: '벌어들인 돈을 진짜 현금(FCF)으로 잘 바꾸는지, 빚은 적은지 봅니다.', formulaEn: 'Checks if net income converts well into cash (FCF) and if debt is low.' },
      { nameKo: '탄탄한 예측 가능성', nameEn: 'Predictability', maxScore: '25%', formulaKo: '매출과 이익이 오르락내리락 하지 않고, 변동성(CV) 15% 이하로 조용하고 탄탄하게 크는지 봅니다.', formulaEn: 'Checks if revenue and earnings are stable over time with very low volatility.' },
      { nameKo: '가치와 가격의 조화', nameEn: 'Valuation', maxScore: '15%', formulaKo: '회사의 시가총액 대비 진짜 현금수익률(OE Yield)이 은행 이자보다 훨씬 높은 (8% 이상) 상태인지 확인합니다.', formulaEn: 'Ensures the cash yield (OE divided by Market Cap) is much higher than bank rates (8%+).' },
    ],
    sectorAdjustments: [
      { sector: 'Financials', sectorKo: '금융', adjustmentsKo: ['은행과 보험사는 특성상 ROIC 대신 주주 자기자본이익률(ROE)을 봅니다.'], adjustmentsEn: ['For banks and insurance, use ROE instead of ROIC.'] },
      { sector: 'Consumer Staples', sectorKo: '필수 소비재', adjustmentsKo: ['불경기에도 사람들이 꼭 사는 물건을 팔기 때문에, 예측 가능성 점수에 추가 점수를 줍니다.'], adjustmentsEn: ['Since they sell daily necessities, they get extra predictability bonus.'] },
    ],
  },
  'Aswath Damodaran': {
    agentKey: 'aswath_damodaran',
    axes: [
      { nameKo: '성장과 투자', nameEn: 'Growth/Reinvestment', maxScore: '4점', formulaKo: '매출이 꾸준히 성장 (가장 좋으면 8% 이상)하고 현금흐름이 크고 있는지 확인합니다.', formulaEn: 'Checking for steady revenue growth (ideally 8%+) and growing cash flow.' },
      { nameKo: '위험 수준 파악', nameEn: 'Risk Profile', maxScore: '3점', formulaKo: '주식이 너무 들쭉날쭉(Beta<1.3)하지 않은지, 빚이 너무 많지 않은지, 이자를 갚을 능력이 3배 이상 되는지 봅니다.', formulaEn: 'Checking if stock is too volatile, has low debt, and can easily pay its interest.' },
      { nameKo: '주변 주식과 비교', nameEn: 'Relative Value', maxScore: '1점', formulaKo: '이 회사 주식이 과거 5년 평균에 비해 지금 얼마나 평가받고 있는지(P/E 비율) 확인합니다.', formulaEn: 'Compares the current P/E to the stock\'s 5-year historical median.' },
    ],
    dcf: {
      titleKo: '대학 교수님의 체계적인 컴퓨터 계산법 (FCFF DCF)',
      titleEn: 'Professor\'s Systematic Valuation (FCFF DCF)',
      stepsKo: [
        '1. 이 회사가 주식시장에서 어느 정도의 위험을 띠는지 평가해 할인율(r)을 만듭니다.',
        '2. 과거 5년 동안 얼마나 잘 컸는지를 바탕으로 앞으로의 성장률을 예상합니다.',
        '3. 10년이 지나면 회사가 아주 평범하게 경제 성장률 수준(2.5%)으로만 큰다고 보수적으로 가정합니다.',
        '4. 오늘 날짜로 계산한 최종 가치에 비해 현재 가격이 25% 이상 싸게 팔리면 "Buy"입니다.'
      ],
      stepsEn: [
        '1. Assess stock market risk to create a discount rate.',
        '2. Project future growth based on the past 5 years.',
        '3. Assume growth slowly falls to a normal 2.5% inflation rate after 10 years.',
        '4. Buy if the stock is priced 25% or more below the computed value.'
      ],
    },
    sectorAdjustments: [
      { sector: 'Technology', sectorKo: 'IT / 기술 및 신흥시장', adjustmentsKo: ['기술 회사나 신흥국(개발도상국) 시장은 위험이 크므로 평가할 때 요구하는 수익 기준(할인율)을 더 올려서(1.5%~3%) 조심스럽게 방어막을 칩니다.'], adjustmentsEn: ['Tech and emerging market stocks are riskier, so the required return hurdle (discount rate) is increased.'] },
      { sector: 'Utilities', sectorKo: '안정적인 발전소 / 가스 (유틸리티)', adjustmentsKo: ['전기차나 가스회사처럼 나라에서 많이 지원해 주고, 수입이 안정적이라 위험 기준(할인율)을 낮게 잡아줍니다.'], adjustmentsEn: ['For ultra-stable companies like electric grids, the required risk hurdle is lowered.'] },
    ],
  },
  'Cathie Wood': {
    agentKey: 'cathie_wood',
    axes: [
      { nameKo: '시장을 부수는 혁신 잠재력', nameEn: 'Disruptive Potential', maxScore: '5점', formulaKo: '매출이 점점 더 빠르게 늘고 있나요? 연구개발(R&D)에 돈을 팍팍 15% 이상 쓰고 있는지 봅니다.', formulaEn: 'Is revenue accelerating? Is the company spending heavily (15%+) on R&D for the future?' },
      { nameKo: '엄청난 성장 속도', nameEn: 'Innovation Growth', maxScore: '5점', formulaKo: '경쟁 상대를 압도하며 매출이 폭발적으로 늘고 총마진(기본 이익)이 커지는지 확인합니다.', formulaEn: 'Looking for explosive revenue growth and expanding gross margins.' },
      { nameKo: '미래 가치 당겨오기', nameEn: 'High-Growth Valuation', maxScore: '5점', formulaKo: '지금은 적자여도 5년 뒤 시장을 독식했을 때 벌어들일 엄청난 이익을 기준으로 가치를 평가합니다.', formulaEn: 'Evaluating value based on the massive cash flows expected 5+ years into the future.' },
    ],
    sectorAdjustments: [
      { sector: 'SaaS/Cloud', sectorKo: '소프트웨어 / 클라우드', adjustmentsKo: ['이 분야는 혁신이 생명이므로 연구개발비(R&D)를 매출의 20% 이상 써야 좋게 봅니다.'], adjustmentsEn: ['Software lives on innovation, so R&D spending should be above 20%.'] },
      { sector: 'Biotech', sectorKo: '제약 / 바이오', adjustmentsKo: ['약이 개발 중이라 당장 매출이 없으므로, 현재 임상시험 단계가 어디까지 왔는지를 중요하게 봅니다.'], adjustmentsEn: ['Since biotech often has no current revenue, we evaluate clinical trial pipelines.'] },
    ],
  },
  'Ben Graham': {
    agentKey: 'ben_graham',
    axes: [
      { nameKo: '무조건적인 안전성', nameEn: 'Earnings Stability', maxScore: '4점', formulaKo: '그동안 한 번도 적자(손해)를 낸 적이 없고 꾸준히 이익(EPS)을 늘려왔는지 봅니다.', formulaEn: 'Checks if the company has NEVER lost money (always positive EPS).' },
      { nameKo: '돌부처 같은 재무 상태', nameEn: 'Financial Strength', maxScore: '5점', formulaKo: '가진 돈이 당장 갚아야 할 빚보다 2배 이상 많은지, 전체 자산 중 빚의 비율이 절반도 안 되는지 철저히 봅니다.', formulaEn: 'Current assets must be double current liabilities. Total debt must be under 50% of assets.' },
      { nameKo: '떨이로 나온 꽁초 가치', nameEn: 'Graham Valuation', maxScore: '6점', formulaKo: '회사가 당장 망해서 공장을 팔아도 남을 돈(NCAV)보다 현재 주식가격이 싼 상태인지 봅니다.', formulaEn: 'Checks if the stock price is cheaper than what would be left if the company closed today and paid debt (NCAV).' },
    ],
    dcf: {
      titleKo: '그레이엄식 안전마진 공식',
      titleEn: 'Graham Number Formula',
      stepsKo: [
        '1. 이익(EPS)과 순자산가치(BPS)에 22.5라는 안전한 고정 숫자를 곱해 적정가격을 구합니다.',
        '2. 이 적정가격보다 지금 주가가 반값(50%) 이상 싸게 떨어졌을 때만 구매를 추천합니다.'
      ],
      stepsEn: [
        '1. Multiply EPS and Book Value per share by a safe constant 22.5 to find a fair price.',
        '2. Only recommend buying if the current stock price is less than half this fair price.'
      ],
    },
    sectorAdjustments: [
      { sector: 'Financials', sectorKo: '금융', adjustmentsKo: ['공장이라는 개념이 없는 은행 주식은 공장을 팔아 남길 돈이라는 공식(NCAV) 대신 장부가치(순자산)와 주식을 비교합니다.'], adjustmentsEn: ['Banks don\'t have factories to liquidate, so check P/TBV instead of NCAV.'] },
    ],
  },
  'Peter Lynch': {
    agentKey: 'peter_lynch',
    axes: [
      { nameKo: '일상이 되버린 폭풍 성장', nameEn: 'Growth', maxScore: '30%', formulaKo: '우리가 일상에서 자주 사는 물건이면서, 회사 매출이 매년 10~25%씩 확확 성장하는지 봅니다.', formulaEn: 'Looking for companies growing revenue at 10-25% a year.' },
      { nameKo: '가짜 성장주 피하기', nameEn: 'Valuation', maxScore: '25%', formulaKo: '회사 성장 속도에 비해 주가가 터무니없이 비싼지 확인하는 PEG 비율 공식을 사용합니다. 1보다 작으면 좋습니다.', formulaEn: 'Uses the PEG ratio to ensure we aren\'t paying too much for growth. PEG under 1.0 is great.' },
      { nameKo: '기본적인 뼈대 검증', nameEn: 'Fundamentals', maxScore: '20%', formulaKo: '빚이 없어야 하고, 들어오는 현금이 진짜로 남아야 합니다.', formulaEn: 'Must have low debt and actually produce extra cash.' },
      { nameKo: '뉴스 흐름 (인기도)', nameEn: 'News', maxScore: '15%', formulaKo: '너무 뉴스에 안 좋게 나오지는 않는지 봅니다.', formulaEn: 'Making sure the news around the company isn\'t completely negative.' },
      { nameKo: '직원들의 자신감', nameEn: 'Insiders', maxScore: '10%', formulaKo: '회사의 내부자(직원이나 사장)가 "우리 회사 앞으로 잘 될 거야!"라며 자기 돈으로 자기 회사 주식을 사모으는지 봅니다.', formulaEn: 'Checks if company executives are buying their own stock.' },
    ],
    sectorAdjustments: [],
  },
  'Valuation Analyst': {
    agentKey: 'valuation_analyst',
    axes: [
      { nameKo: '전통 모델 종합 세트 (DCF)', nameEn: 'DCF', maxScore: '35%', formulaKo: '기본 시나리오, 아주 좋을 때, 아주 나쁠 때 3가지 상황을 종합해서 기대 가치를 배분합니다.', formulaEn: 'Runs a base, bull, and bear scenario using DCF to find expected value.' },
      { nameKo: '진짜 주머니 현금 (Owner Earnings)', nameEn: 'Owner Earnings', maxScore: '35%', formulaKo: '회사가 당장 주머니에서 꺼내 주주들에게 줄 수 있는 잉여 현금을 통해 계산합니다.', formulaEn: 'Measures cash that can actually be taken out of the business.' },
      { nameKo: '회사를 통째로 샀을 때 (EV/EBITDA)', nameEn: 'EV/EBITDA', maxScore: '20%', formulaKo: '과거에 이 회사가 시장에서 몇 년 치 영업이익을 몸값으로 받았는지를 기준으로 지금 가격을 계산합니다.', formulaEn: 'Values the company based on how many years of its operations the market historically pays for.' },
      { nameKo: '남는 이익의 가치 (잔여이익)', nameEn: 'Residual Income', maxScore: '10%', formulaKo: '회사가 가진 재산(장부가치)에, 자본 비용을 빼고 진짜 남는 순수한 이익을 더해 계산합니다.', formulaEn: 'Book Value plus the present value of income minus the cost of capital.' },
    ],
    dcf: {
      titleKo: '밸류에이션 모델 - 실전 시나리오',
      titleEn: 'Valuation Analyst Scenario Approach',
      stepsKo: [
        '1. 이 회사가 돈을 빌릴 수 있는 이자와 주주들이 원하는 수익률을 합쳐 평가 기준 허들을 만듭니다 (WACC).',
        '2. 아주 나쁜 상황 (성장이 절반으로 꺾인 최악의 경우) : 확률 20%',
        '3. 기본 예상 상황 (우리가 전망하는 대로 무난하게 성장) : 확률 60%',
        '4. 아주 좋을 상황 (성장이 엄청나게 폭발하는 최고의 경우) : 확률 20%',
        '5. 위 확률들로 구한 내재 가치가 주식 가격보다 15% 이상 높게 나오면 확실한 매수(Buy)! 를 외칩니다.'
      ],
      stepsEn: [
        '1. Find the cost of capital based on debt and equity (WACC).',
        '2. Bear Case (growth halves) : 20% probability.',
        '3. Base Case (expected growth) : 60% probability.',
        '4. Bull Case (explosive growth) : 20% probability.',
        '5. Buy if the weighted intrinsic value is more than 15% above stock price.'
      ],
    },
    sectorAdjustments: [],
  },
  'Technical Analyst': {
    agentKey: 'technical_analyst',
    axes: [
      { nameKo: '현재 힘의 방향 (추세, ADX)', nameEn: 'Trend (ADX)', maxScore: '25%', formulaKo: '주가가 위로 가는 힘이 아래로 가는 힘보다 센지 컴퓨터 선으로 봅니다.', formulaEn: 'Checks if the upward force is stronger than downward lines.' },
      { nameKo: '가속도 (모멘텀)', nameEn: 'Momentum', maxScore: '25%', formulaKo: '최근 1개월, 3개월, 6개월간 평균적으로 주식이 빠르게 치고 올라가고 있는지 점수를 계산합니다.', formulaEn: 'Scores the speed at which the stock went up over 1, 3, and 6 months.' },
      { nameKo: '용수철 이론 (평균회귀)', nameEn: 'Mean Reversion', maxScore: '20%', formulaKo: '주가가 너무 많이 떨어져서 볼린저 밴드라는 고무줄 선 아래로 내려가면 다시 튕겨 오를 거라 예측합니다.', formulaEn: 'If a stock drops way below its normal rubber band (Bollinger), it assumes it will rebound.' },
      { nameKo: '안심 구역 판단 (변동성)', nameEn: 'Volatility Regime', maxScore: '15%', formulaKo: '주식이 미친듯이 날아다니지 않고 얌전하게 위로 올라갈 때 점수를 줍니다.', formulaEn: 'Gives points when the stock moves smoothly upward instead of wild spikes.' },
    ],
    sectorAdjustments: [],
  },
  'News Sentiment Analyst': {
    agentKey: 'news_sentiment_analyst',
    axes: [
      { nameKo: 'AI 문장 해독력', nameEn: 'LLM Confidence', maxScore: '70%', formulaKo: '엄청나게 많은 신문 기사들을 AI가 긍정적, 부정적, 평범함의 3단계로 초당 수백 개씩 읽어내려가며 느낌을 판별합니다.', formulaEn: 'AI reads lots of articles fast and labels them as positive, negative, or neutral.' },
      { nameKo: '투표 결과', nameEn: 'Signal Proportion', maxScore: '30%', formulaKo: '읽은 기사 전체에서 전체적으로 좋은 분위기가 몇 %인지 통계내어 주식의 인기도를 측정합니다.', formulaEn: 'Checks the overall percentage of good news out of all the articles.' },
    ],
    sectorAdjustments: [],
  },
};
