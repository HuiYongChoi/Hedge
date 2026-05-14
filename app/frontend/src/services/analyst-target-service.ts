const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export interface AnalystTarget {
  ticker: string;
  consensus: number | null;
  high: number | null;
  low: number | null;
  median: number | null;
  analyst_count: number | null;
  current_price: number | null;
  trailing_pe: number | null;
  trailing_eps: number | null;
  forward_eps: number | null;
  forward_pe: number | null;
  source: 'FMP' | 'stub';
}

export const analystTargetService = {
  fetch: async (ticker: string): Promise<AnalystTarget | null> => {
    try {
      const res = await fetch(`${API_BASE_URL}/analyst-targets/${encodeURIComponent(ticker)}`);
      if (!res.ok) return null;
      return await res.json() as AnalystTarget;
    } catch {
      return null;
    }
  },
};
