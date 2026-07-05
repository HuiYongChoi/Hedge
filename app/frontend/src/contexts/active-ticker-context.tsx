import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ActiveTickerContextValue {
  activeTicker: string | null;
  activeTickerDisplayName: string | null;
  activeTickerInputValue: string | null;
  setActiveTicker: (ticker: string | null, identity?: Partial<ActiveTickerIdentity>) => void;
}

interface ActiveTickerIdentity {
  displayName?: string | null;
  inputValue?: string | null;
  market?: string | null;
}

interface ActiveTickerState {
  ticker: string | null;
  displayName: string | null;
  inputValue: string | null;
  market: string | null;
}

const ActiveTickerContext = createContext<ActiveTickerContextValue | undefined>(undefined);

function normalizeActiveTicker(ticker: string | null) {
  const normalized = ticker?.trim().toUpperCase();
  return normalized || null;
}

function normalizeMetaValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

export function ActiveTickerProvider({ children }: { children: ReactNode }) {
  const [activeTickerState, setActiveTickerState] = useState<ActiveTickerState>({
    ticker: null,
    displayName: null,
    inputValue: null,
    market: null,
  });

  const setActiveTicker = useCallback((ticker: string | null, identity?: Partial<ActiveTickerIdentity>) => {
    const normalizedTicker = normalizeActiveTicker(ticker);
    const displayName = normalizeMetaValue(identity?.displayName);
    const inputValue = normalizeMetaValue(identity?.inputValue) || displayName || normalizedTicker;
    setActiveTickerState({
      ticker: normalizedTicker,
      displayName,
      inputValue,
      market: normalizeMetaValue(identity?.market),
    });
  }, []);

  const value = useMemo<ActiveTickerContextValue>(() => ({
    activeTicker: activeTickerState.ticker,
    activeTickerDisplayName: activeTickerState.displayName,
    activeTickerInputValue: activeTickerState.inputValue,
    setActiveTicker,
  }), [activeTickerState, setActiveTicker]);

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
