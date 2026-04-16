# AI Hedge Fund Agents Architecture

@cluade.md

본 프로젝트는 다수의 전문 투자자 페르소나 및 정량 분석용 AI 에이전트로 구성된 **다중 에이전트 시스템(Multi-Agent System)**입니다. LangGraph 기반으로 동작하며, 각각의 에이전트는 서로 다른 관점에서 투자 종목을 분석합니다.

## 시스템 핵심 구성

모든 분석은 `stock-analyzer-node` (시작 노드)에서 시작하여 각 애널리스트 에이전트로 정보 전달 후, 최종적으로 `portfolio-manager-node`에서 의견이 종합됩니다.

### 1. Data Wizards (데이터 분석가)
시장 객관적 지표를 담당하는 정량 분석 에이전트.
- **Fundamentals Agent**: 재무제표, 이익 구조를 분석합니다.
- **Technicals Agent**: 기술적 차트, 이동평균, 모멘텀 지표를 분석합니다.
- **Valuation Agent**: DCF 모델링 및 상대가치평가를 진행합니다.
- **Sentiment (News) Agent**: 최신 뉴스와 시장의 여론 심리를 지수화합니다.

### 2. Value Investors (가치 투자자)
기업 본연의 내재가치와 경제적 해자를 최우선으로 보는 페르소나.
- **Warren Buffett**: 경제적 해자가 있는 장기 우량주에 집중.
- **Charlie Munger**: 질적 평가 우위와 심리학적 측면 중시.
- **Ben Graham**: 넷넷(Net-Net) 전략 기반 철저한 안전마진 확보.
- **Phil Fisher**: 위대한 기업의 질적 특성을 스커틀벗 방식으로 분석.
- **Aswath Damodaran**: 밸류에이션(가치평가)의 대가.

### 3. Market Mavericks (성장 및 모멘텀)
시장 트렌드, 파괴적 혁신, 매크로 지표 등을 중시하는 페르소나.
- **Cathie Wood**: 파괴적 혁신과 장기 성장 기술주에 베팅.
- **Stanley Druckenmiller**: 톱다운 매크로 트렌드와 유동성 흐름을 민감하게 포착.

### 4. Contrarians & Risk (역발상 & 리스크 방어)
꼬리 위험 대비, 특수상황 분석, 보수적 밸류에이션에 특화.
- **Michael Burry**: 하방 위험과 매크로 거품 분석, 특수상황(Special Sits) 투자.
- **Nassim Taleb**: 취약성 검증과 블랙스완 등 꼬리 위험(Fat tails) 대비 철저.
- **Bill Ackman**: 행동주의 투자 관점에서 경영진과 자금 흐름을 분석.
- **Mohnish Pabrai**: 투자의 불확실성 대비 '단도 투자(Dhando)' 방식 접근.

### 5. Management (최종 관리자)
- **Risk Manager**: 각 분석 결과의 시장 노출, 통합 하방 리스크 점검 및 제한.
- **Portfolio Manager**: 모든 에이전트의 의견, 포지션, 목표 수익 등을 통합하여 최종 **Buy/Hold/Sell** 액션과 수량을 결정합니다.
