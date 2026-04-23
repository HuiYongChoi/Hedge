import { createContext, useContext, useState, ReactNode } from 'react';
import {
  Language,
  getPreferredLanguage,
  setPreferredLanguage,
  translations,
} from '@/lib/language-preferences';

type TranslationKey = keyof typeof translations.en;

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey | string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => getPreferredLanguage());

  const setLanguage = (newLanguage: Language) => {
    setLanguageState(newLanguage);
    setPreferredLanguage(newLanguage);
  };

  const t = (key: TranslationKey | string): string => {
    const langDict = translations[language as keyof typeof translations] as Record<string, string>;
    const enDict = translations.en as Record<string, string>;
    return langDict[key as string] || enDict[key as string] || key as string;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
