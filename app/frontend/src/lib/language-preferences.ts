export type Language = 'ko' | 'en';

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
    lightTheme: '라이트 테마',
    darkTheme: '다크 테마',
    systemTheme: '시스템 설정',

    // Language Settings
    languageTitle: '언어',
    languageDescription: '표시 언어 선택',
    korean: '한국어',
    english: 'English',
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
    lightTheme: 'Light Theme',
    darkTheme: 'Dark Theme',
    systemTheme: 'System',

    // Language Settings
    languageTitle: 'Language',
    languageDescription: 'Select display language',
    korean: '한국어',
    english: 'English',
  }
};

export function t(key: keyof typeof translations.en, language: Language = getPreferredLanguage()): string {
  return translations[language][key] || translations.en[key] || key;
}
