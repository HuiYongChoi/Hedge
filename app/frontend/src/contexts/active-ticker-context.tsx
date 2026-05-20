import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ActiveTickerContextValue {
  activeTicker: string | null;
  setActiveTicker: (ticker: string | null) => void;
}

const ActiveTickerContext = createContext<ActiveTickerContextValue | undefined>(undefined);

function normalizeActiveTicker(ticker: string | null) {
  const normalized = ticker?.trim().toUpperCase();
  return normalized || null;
}

export function ActiveTickerProvider({ children }: { children: ReactNode }) {
  const [activeTicker, setActiveTickerState] = useState<string | null>(null);

  const setActiveTicker = useCallback((ticker: string | null) => {
    setActiveTickerState(normalizeActiveTicker(ticker));
  }, []);

  const value = useMemo<ActiveTickerContextValue>(() => ({
    activeTicker,
    setActiveTicker,
  }), [activeTicker, setActiveTicker]);

  return (
    <ActiveTickerContext.Provider value={value}>
      {children}
    </ActiveTickerContext.Provider>
  );
}

export function useActiveTicker() {
  const context = useContext(ActiveTickerContext);
  if (!context) {
    throw new Error('useActiveTicker must be used within ActiveTickerProvider');
  }
  return context;
}
