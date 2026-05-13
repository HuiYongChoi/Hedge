const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export interface SavedAnalysis {
  id: number;
  source_tab: string;
  ticker: string;
  language: string;
  request_data: any;
  result_data: any;
  created_at: string;
}

export interface SavedAnalysisFilter {
  source_tab?: 'stock_analysis' | 'data_sandbox';
  ticker?: string;
  created_from?: string;  // YYYY-MM-DD
  created_to?: string;
  limit?: number;
  skip?: number;
}

export interface SavedAnalysesListResponse {
  items: SavedAnalysis[];
  total: number;
}

export const savedAnalysisService = {
  saveAnalysis: async (
    source_tab: string,
    ticker: string,
    language: string,
    request_data: any,
    result_data: any
  ): Promise<SavedAnalysis> => {
    const response = await fetch(`${API_BASE_URL}/saved-analyses/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_tab,
        ticker,
        language,
        request_data,
        result_data,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to save analysis: HTTP ${response.status}`);
    }
    return response.json();
  },

  getAllAnalyses: async (limit: number = 50, skip: number = 0): Promise<SavedAnalysis[]> => {
    const res = await savedAnalysisService.listAnalyses({ limit, skip });
    return res.items;
  },

  listAnalyses: async (filter: SavedAnalysisFilter = {}): Promise<SavedAnalysesListResponse> => {
    const params = new URLSearchParams();
    params.set('limit', String(filter.limit ?? 50));
    params.set('skip', String(filter.skip ?? 0));
    if (filter.source_tab)   params.set('source_tab', filter.source_tab);
    if (filter.ticker)       params.set('ticker', filter.ticker);
    if (filter.created_from) params.set('created_from', filter.created_from);
    if (filter.created_to)   params.set('created_to', filter.created_to);
    const res = await fetch(`${API_BASE_URL}/saved-analyses/?${params}`);
    if (!res.ok) throw new Error(`Failed to fetch saved analyses: HTTP ${res.status}`);
    const items: SavedAnalysis[] = await res.json();
    const total = Number(res.headers.get('X-Total-Count') ?? items.length);
    return { items, total };
  },

  getAnalysisById: async (id: number): Promise<SavedAnalysis> => {
    const response = await fetch(`${API_BASE_URL}/saved-analyses/${id}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch saved analysis: HTTP ${response.status}`);
    }
    return response.json();
  },

  deleteAnalysis: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE_URL}/saved-analyses/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Failed to delete: ${res.status}`);
    }
  },
};
