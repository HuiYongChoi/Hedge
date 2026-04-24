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
    const response = await fetch(`${API_BASE_URL}/saved-analyses/?limit=${limit}&skip=${skip}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch saved analyses: HTTP ${response.status}`);
    }
    return response.json();
  },
  
  getAnalysisById: async (id: number): Promise<SavedAnalysis> => {
    const response = await fetch(`${API_BASE_URL}/saved-analyses/${id}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch saved analysis: HTTP ${response.status}`);
    }
    return response.json();
  }
};
