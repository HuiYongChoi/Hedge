import { api } from '@/services/api';

export interface LanguageModel {
  display_name: string;
  model_name: string;
  provider: "Anthropic" | "DeepSeek" | "Google" | "Groq" | "OpenAI" | "OpenRouter" | "xAI" | "GigaChat" | "Azure OpenAI";
}

export const DEFAULT_MODEL_NAME = "gpt-5.4-nano";
export const DEFAULT_MODEL_DISPLAY_NAME = "GPT-5.4 Nano";

const DEPRECATED_DEFAULT_MODEL_NAMES = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
]);

// Cache for models to avoid repeated API calls
let languageModels: LanguageModel[] | null = null;

/**
 * Get the list of models from the backend API
 * Uses caching to avoid repeated API calls
 */
export const getModels = async (): Promise<LanguageModel[]> => {
  if (languageModels) {
    return languageModels;
  }
  
  try {
    languageModels = await api.getLanguageModels();
    return languageModels;
  } catch (error) {
    console.error('Failed to fetch models:', error);
    throw error; // Let the calling component handle the error
  }
};

/**
 * Get the default model (gpt-5.4-nano) from the models list
 */
export const getDefaultModel = async (): Promise<LanguageModel | null> => {
  try {
    const models = await getModels();
    return (
      models.find(model => model.model_name === DEFAULT_MODEL_NAME) ||
      models.find(model => model.model_name === "gpt-5-nano") ||
      models.find(model => model.model_name === "gpt-4.1-nano") ||
      models.find(model => model.provider === "OpenAI") ||
      models[0] ||
      null
    );
  } catch (error) {
    console.error('Failed to get default model:', error);
    return null;
  }
};

export const shouldUseDefaultModel = (model: LanguageModel | null): boolean => {
  return !model || DEPRECATED_DEFAULT_MODEL_NAMES.has(model.model_name);
};
