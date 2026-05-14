const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export interface BrokerTarget {
  name: string;
  target_price: number;
  signal: 'BUY' | 'HOLD' | 'NEUTRAL' | 'SELL';
  published_date: string;
  days_ago: number;
}

export interface TargetDistribution {
  buy: number;
  hold: number;
  neutral: number;
  sell: number;
  total: number;
  average: number | null;
  median: number | null;
  stdev: number | null;
}

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
  current_fy_eps: number | null;
  beta: number | null;
  sigma_annual: number | null;
  brokers: BrokerTarget[];
  distribution: TargetDistribution | null;
  source: 'yfinance' | 'stub';
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
