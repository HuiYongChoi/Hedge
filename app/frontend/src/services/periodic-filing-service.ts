const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export interface PeriodicFiling {
  id: string;
  title: string;
  date: string;              // yyyy-mm-dd
  kind: 'annual' | 'quarterly';
  form: string;              // 사업보고서 / 반기보고서 / 10-K ...
  url: string;
}

export interface PeriodicFilingList {
  ticker: string;
  market: 'KR' | 'US' | 'JP' | string;
  supported: boolean;
  months: number;
  source: string | null;
  error: string | null;
  filings: PeriodicFiling[];
}

export const periodicFilingService = {
  /** 최근 months 개월의 연간·분기 정기공시 목록 (최신순). */
  fetch: async (ticker: string, months = 12): Promise<PeriodicFilingList | null> => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/sec-filings/${encodeURIComponent(ticker)}/periodic?months=${months}`,
      );
      if (!res.ok) return null;
      return await res.json() as PeriodicFilingList;
    } catch {
      return null;
    }
  },
};
