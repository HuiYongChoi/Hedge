export type Language = 'ko' | 'en';
// Alias for backward compatibility with server-deployed code
export type AppLanguage = Language;

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
];

export function normalizeLanguage(value: string | null | undefined): Language {
  if (value === 'ko' || value === 'en') return value;
  return 'en';
}

const LANGUAGE_KEY = 'preferred-language';

export function getPreferredLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (stored === 'ko' || stored === 'en') {
      return stored;
    }
  } catch (e) {
    console.warn('Failed to read language preference from localStorage', e);
  }
  return 'en';
}

export function setPreferredLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch (e) {
    console.warn('Failed to save language preference to localStorage', e);
  }
}

export const translations = {
  ko: {
    // Settings Navigation
    apiKeys: 'API 키',
    models: '모델',
    theme: '테마',
    language: '언어',
    settings: '설정',
    settingsDescription: '설정 및 환경설정',

    // API Keys
    apiKeysTitle: 'API 키',
    apiKeysDescription: 'API 엔드포인트 및 인증',
    financialDatasetsAPI: '금융 데이터 API',
    financialDatasetsDesc: '헤지펀드 운영을 위한 금융 데이터 조회',
    anthropicAPI: 'Anthropic API',
    anthropicDesc: 'Claude 모델 (claude-4-sonnet, claude-4.1-opus 등)',
    deepseekAPI: 'DeepSeek API',
    deepseekDesc: 'DeepSeek 모델 (deepseek-chat, deepseek-reasoner 등)',
    groqAPI: 'Groq API',
    groqDesc: 'Groq 호스팅 모델 (deepseek, llama3 등)',
    googleAPI: 'Google API',
    googleDesc: 'Gemini 모델 (gemini-2.5-flash, gemini-2.5-pro)',
    openaiAPI: 'OpenAI API',
    openaiDesc: 'OpenAI 모델 (gpt-4o, gpt-4o-mini 등)',
    openrouterAPI: 'OpenRouter API',
    openrouterDesc: 'OpenRouter 모델 (gpt-4o, gpt-4o-mini 등)',
    gigachatAPI: 'GigaChat API',
    gigachatDesc: 'GigaChat 모델 (GigaChat-2-Max 등)',
    addKey: 'API 키 추가',
    updateKey: 'API 키 업데이트',
    deleteKey: 'API 키 삭제',
    deleteKeyConfirm: 'API 키를 삭제하시겠습니까?',
    copied: '복사되었습니다',

    // Models
    modelsTitle: '모델',
    modelsDescription: '로컬 및 클라우드 AI 모델',
    selectModel: '모델 선택',
    customModel: '커스텀 모델',

    // Cloud Models
    cloudModelsTitle: '클라우드 모델',
    cloudModelsDescription: '클라우드 제공자의 AI 모델',
    modelProvider: '모델 제공자',
    modelName: '모델 명',
    selectedModel: '선택된 모델',

    // Ollama
    ollamaTitle: 'Ollama',
    ollamaDescription: '로컬 호스팅 Ollama 모델',
    ollamaEndpoint: 'Ollama 엔드포인트',
    ollamaStatus: 'Ollama 상태',
    ollamaConnected: '연결됨',
    ollamaDisconnected: '연결되지 않음',
    ollamaModels: 'Ollama 모델',
    selectOllamaModel: 'Ollama 모델 선택',

    // Theme
    themeTitle: '테마',
    themeDescription: '테마 및 표시 설정',
    lightTheme: '라이트',
    darkTheme: '다크',
    systemTheme: '시스템',
    lightThemeDesc: '깔끔하고 밝은 인터페이스',
    darkThemeDesc: '편안한 다크 인터페이스',
    systemThemeDesc: '시스템 설정을 따릅니다',
    themeCustomize: '테마를 선택하거나 시스템 설정에 따라 자동 전환하세요.',

    // Language Settings
    languageTitle: '언어',
    languageDescription: '표시 언어 선택',
    korean: '한국어',
    english: 'English',

    // Left Sidebar (Flows)
    flows: '플로우',
    searchFlows: '플로우 검색...',
    loadingFlows: '플로우 불러오는 중...',
    recentFlows: '최근 플로우',
    templates: '템플릿',
    noFlowsSaved: '저장된 플로우가 없습니다',
    createFirstFlow: '첫 플로우를 만들어 시작하세요',
    noFlowsFound: '검색된 플로우가 없습니다',
    createNewFlow: '새 플로우 만들기',
    saveFlow: '플로우 저장',

    // Right Sidebar (Components)
    components: '컴포넌트',
    searchComponents: '컴포넌트 검색...',
    loadingComponents: '컴포넌트 불러오는 중...',
    noComponentsAvailable: '사용 가능한 컴포넌트가 없습니다',
    componentsWillAppear: '컴포넌트가 로드되면 여기 표시됩니다',
    noComponentsFound: '검색된 컴포넌트가 없습니다',

    // Component Groups
    startNodes: '시작 노드',
    analystNodes: '분석가',
    swarmNodes: '스웜',
    endNodes: '종료 노드',
    portfolioInput: '포트폴리오 입력',
    stockInput: '주식 입력',
    portfolioManager: '포트폴리오 매니저',
    dataWizards: '데이터 위자드',
    marketMavericks: '마켓 매버릭스',
    valueInvestors: '가치 투자자',

    // Node UI
    tickers: '종목 코드',
    tickersTooltip: '여러 종목을 입력할 때는 쉼표(,)로 구분하세요. 예: AAPL,NVDA,TSLA',
    enterTickers: '종목 코드 입력',
    run: '실행',
    singleRun: '단일 실행',
    backtestRun: '백테스트',
    advanced: '고급 설정',
    noRunModeFound: '실행 모드를 찾을 수 없습니다',
    availableCash: '가용 현금',
    positions: '포지션',
    positionsTooltip: '종목, 수량, 매매가로 포지션을 추가하세요',
    addPosition: '포지션 추가',
    ticker: '종목',
    quantity: '수량',
    price: '가격',
    startDate: '시작일',
    endDate: '종료일',
    nodeStatus: '상태',
    nodeIdle: '대기',
    nodeModel: '모델',
    output: '출력',

    // Agent Output Dialog
    logTitle: '활동 로그',
    analysisTitle: '분석 결과',
    tickerLabel: '종목',
    noActivity: '활동 기록이 없습니다',
    analysisInProgress: '분석 진행 중...',
    analysisComplete: '분석 결과가 없습니다',
    analysisFailed: '분석 실패',
    noAnalysisAvailable: '분석 결과 없음',
    noAnalysisForTicker: '해당 종목의 분석 결과가 없습니다',
    copyClipboard: '클립보드에 복사',
    copy: '복사',
    summaryFor: '종목 요약:',
    
    // Agent Output Dialog Dynamic Keys
    log: '로그',
    analysis: '분석',
    signal: '신호',
    confidence: '신뢰도',
    reasoning: '추론/상세내용',
    metrics: '측정 지표',
    
    // Analyst specific keys
    PRICE_RATIOS_SIGNAL: '가격 비율 신호',
    INSIDER_TRADING: '내부자 거래',
    NEWS_SENTIMENT: '뉴스 센티멘트',
    PROFITABILITY_SIGNAL: '수익성 신호',
    GROWTH_SIGNAL: '성장성 신호',
    FINANCIAL_HEALTH_SIGNAL: '재무 건전성 신호',
    Trend_Following: '추세 추종',
    Mean_Reversion: '평균 회귀',
    Momentum: '모멘텀',
    Volatility: '변동성',

    // Investment Report Dialog
    investmentReport: '투자 보고서',
    summary: '요약',
    analystSignals: '애널리스트 신호',
    recommendedActions: '애널리스트 신호를 기반으로 한 권장 거래 행동',
    tickerCol: '종목',
    priceCol: '가격',
    actionCol: '행동',
    quantityCol: '수량',
    confidenceCol: '신뢰도',
    reasoningCol: '근거',
    agentCol: '에이전트',
    signalCol: '신호',
    shares: '주',
    longAction: '매수',
    shortAction: '매도',
    holdAction: '관망',
    bullish: '강세',
    bearish: '약세',
    neutral: '중립',

    // Status Labels
    statusIdle: '대기',
    statusRunning: '실행 중',
    statusComplete: '완료',
    statusError: '오류',
    statusWaiting: '대기 중',

    // Bottom Panel
    progressTitle: '진행 상황',
    outputTitle: '출력',
    backtestTitle: '백테스트',

    // Stock Analysis Tab
    stockAnalysis: '종목 분석',
    stockAnalysisDesc: '종목을 검색하고 원하는 에이전트를 선택해 상세 분석 보고서를 받으세요.',
    selectAll: '모두 선택',
    stop: '중지',
    runAnalysis: '분석 실행',
    enterAndRun: '종목 입력 후 실행',
    waitingStatus: '대기',
    runningStatus: '분석 중',
    completeStatus: '완료',
    errorStatus: '오류',
    finalDecision: '최종 투자 결정',
    noResultsYet: '종목과 에이전트를 선택한 후 분석을 실행하세요.',
  },
  en: {
    // Settings Navigation
    apiKeys: 'API Keys',
    models: 'Models',
    theme: 'Theme',
    language: 'Language',
    settings: 'Settings',
    settingsDescription: 'Settings and preferences',

    // API Keys
    apiKeysTitle: 'API Keys',
    apiKeysDescription: 'API endpoints and authentication',
    financialDatasetsAPI: 'Financial Datasets API',
    financialDatasetsDesc: 'For getting financial data to power the hedge fund',
    anthropicAPI: 'Anthropic API',
    anthropicDesc: 'For Claude models (claude-4-sonnet, claude-4.1-opus, etc.)',
    deepseekAPI: 'DeepSeek API',
    deepseekDesc: 'For DeepSeek models (deepseek-chat, deepseek-reasoner, etc.)',
    groqAPI: 'Groq API',
    groqDesc: 'For Groq-hosted models (deepseek, llama3, etc.)',
    googleAPI: 'Google API',
    googleDesc: 'For Gemini models (gemini-2.5-flash, gemini-2.5-pro)',
    openaiAPI: 'OpenAI API',
    openaiDesc: 'For OpenAI models (gpt-4o, gpt-4o-mini, etc.)',
    openrouterAPI: 'OpenRouter API',
    openrouterDesc: 'For OpenRouter models (gpt-4o, gpt-4o-mini, etc.)',
    gigachatAPI: 'GigaChat API',
    gigachatDesc: 'For GigaChat models (GigaChat-2-Max, etc.)',
    addKey: 'Add API Key',
    updateKey: 'Update API Key',
    deleteKey: 'Delete API Key',
    deleteKeyConfirm: 'Are you sure you want to delete this API key?',
    copied: 'Copied to clipboard',

    // Models
    modelsTitle: 'Models',
    modelsDescription: 'Local and cloud AI models',
    selectModel: 'Select Model',
    customModel: 'Custom Model',

    // Cloud Models
    cloudModelsTitle: 'Cloud Models',
    cloudModelsDescription: 'AI models from cloud providers',
    modelProvider: 'Model Provider',
    modelName: 'Model Name',
    selectedModel: 'Selected Model',

    // Ollama
    ollamaTitle: 'Ollama',
    ollamaDescription: 'Locally hosted Ollama models',
    ollamaEndpoint: 'Ollama Endpoint',
    ollamaStatus: 'Ollama Status',
    ollamaConnected: 'Connected',
    ollamaDisconnected: 'Disconnected',
    ollamaModels: 'Ollama Models',
    selectOllamaModel: 'Select Ollama Model',

    // Theme
    themeTitle: 'Theme',
    themeDescription: 'Theme and display preferences',
    lightTheme: 'Light',
    darkTheme: 'Dark',
    systemTheme: 'System',
    lightThemeDesc: 'A clean, bright interface',
    darkThemeDesc: 'A comfortable dark interface',
    systemThemeDesc: 'Use your system preference',
    themeCustomize: 'Select your preferred theme or use system setting to automatically switch between light and dark modes.',

    // Language Settings
    languageTitle: 'Language',
    languageDescription: 'Select display language',
    korean: '한국어',
    english: 'English',

    // Left Sidebar (Flows)
    flows: 'Flows',
    searchFlows: 'Search flows...',
    loadingFlows: 'Loading flows...',
    recentFlows: 'Recent Flows',
    templates: 'Templates',
    noFlowsSaved: 'No flows saved yet',
    createFirstFlow: 'Create your first flow to get started',
    noFlowsFound: 'No flows match your search',
    createNewFlow: 'Create new flow',
    saveFlow: 'Save flow',

    // Right Sidebar (Components)
    components: 'Components',
    searchComponents: 'Search components...',
    loadingComponents: 'Loading components...',
    noComponentsAvailable: 'No components available',
    componentsWillAppear: 'Components will appear here when loaded',
    noComponentsFound: 'No components match your search',

    // Component Groups
    startNodes: 'Start Nodes',
    analystNodes: 'Analysts',
    swarmNodes: 'Swarms',
    endNodes: 'End Nodes',
    portfolioInput: 'Portfolio Input',
    stockInput: 'Stock Input',
    portfolioManager: 'Portfolio Manager',
    dataWizards: 'Data Wizards',
    marketMavericks: 'Market Mavericks',
    valueInvestors: 'Value Investors',

    // Node UI
    tickers: 'Tickers',
    tickersTooltip: 'Separate multiple tickers with commas (,). e.g. AAPL,NVDA,TSLA',
    enterTickers: 'Enter tickers',
    run: 'Run',
    singleRun: 'Single Run',
    backtestRun: 'Backtest',
    advanced: 'Advanced',
    noRunModeFound: 'No run mode found.',
    availableCash: 'Available Cash',
    positions: 'Positions',
    positionsTooltip: 'Add your portfolio positions with ticker, quantity, and trade price',
    addPosition: 'Add Position',
    ticker: 'Ticker',
    quantity: 'Quantity',
    price: 'Price',
    startDate: 'Start Date',
    endDate: 'End Date',
    nodeStatus: 'Status',
    nodeIdle: 'Idle',
    nodeModel: 'Model',
    output: 'Output',

    // Agent Output Dialog
    logTitle: 'Log',
    analysisTitle: 'Analysis',
    tickerLabel: 'Ticker',
    noActivity: 'No activity available',
    analysisInProgress: 'Analysis in progress...',
    analysisComplete: 'Analysis completed with no results',
    analysisFailed: 'Analysis failed',
    noAnalysisAvailable: 'No analysis available',
    noAnalysisForTicker: 'No analysis available for this ticker',
    copyClipboard: 'Copy to clipboard',
    copy: 'Copy',
    summaryFor: 'Summary for',
    
    // Agent Output Dialog Dynamic Keys
    log: 'Log',
    analysis: 'Analysis',
    signal: 'Signal',
    confidence: 'Confidence',
    reasoning: 'Reasoning',
    metrics: 'Metrics',
    
    // Analyst specific keys
    PRICE_RATIOS_SIGNAL: 'Price Ratios Signal',
    INSIDER_TRADING: 'Insider Trading',
    NEWS_SENTIMENT: 'News Sentiment',
    PROFITABILITY_SIGNAL: 'Profitability Signal',
    GROWTH_SIGNAL: 'Growth Signal',
    FINANCIAL_HEALTH_SIGNAL: 'Financial Health Signal',
    Trend_Following: 'Trend Following',
    Mean_Reversion: 'Mean Reversion',
    Momentum: 'Momentum',
    Volatility: 'Volatility',

    // Investment Report Dialog
    investmentReport: 'Investment Report',
    summary: 'Summary',
    analystSignals: 'Analyst Signals',
    recommendedActions: 'Recommended trading actions based on analyst signals',
    tickerCol: 'Ticker',
    priceCol: 'Price',
    actionCol: 'Action',
    quantityCol: 'Quantity',
    confidenceCol: 'Confidence',
    reasoningCol: 'Reasoning',
    agentCol: 'Agent',
    signalCol: 'Signal',
    shares: 'shares',
    longAction: 'Long',
    shortAction: 'Short',
    holdAction: 'Hold',
    bullish: 'Bullish',
    bearish: 'Bearish',
    neutral: 'Neutral',

    // Status Labels
    statusIdle: 'Idle',
    statusRunning: 'Running',
    statusComplete: 'Complete',
    statusError: 'Error',
    statusWaiting: 'Waiting',

    // Bottom Panel
    progressTitle: 'Progress',
    outputTitle: 'Output',
    backtestTitle: 'Backtest',

    // Stock Analysis Tab
    stockAnalysis: 'Stock Analysis',
    stockAnalysisDesc: 'Search for stocks and select agents to receive detailed analysis reports.',
    selectAll: 'Select All',
    stop: 'Stop',
    runAnalysis: 'Run Analysis',
    enterAndRun: 'Enter ticker and run',
    waitingStatus: 'Waiting',
    runningStatus: 'Running',
    completeStatus: 'Complete',
    errorStatus: 'Error',
    finalDecision: 'Final Investment Decisions',
    noResultsYet: 'Enter a ticker and select agents to run analysis.',
  }
};

export function t(key: keyof typeof translations.en, language: Language = getPreferredLanguage()): string {
  return translations[language][key] || translations.en[key] || key;
}
