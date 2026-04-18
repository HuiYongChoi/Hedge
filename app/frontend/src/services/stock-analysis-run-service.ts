const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export type StockAnalysisRunStatus = 'IDLE' | 'IN_PROGRESS' | 'COMPLETE' | 'ERROR';

export interface StockAnalysisRunPayload {
  ticker?: string | null;
  language: 'ko' | 'en';
  status: StockAnalysisRunStatus;
  request_data?: Record<string, any> | null;
  result_data?: Record<string, any> | null;
  ui_state?: Record<string, any> | null;
  error_message?: string | null;
}

export interface StockAnalysisRun extends StockAnalysisRunPayload {
  id: number;
  created_at: string;
  updated_at?: string | null;
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${fallbackMessage}: ${response.status}`);
  }
  return response.json();
}

export const stockAnalysisRunService = {
  async saveLatestRun(payload: StockAnalysisRunPayload, runId?: number | null): Promise<StockAnalysisRun> {
    const url = runId
      ? `${API_BASE_URL}/stock-analysis-runs/${runId}`
      : `${API_BASE_URL}/stock-analysis-runs/`;
    const response = await fetch(url, {
      method: runId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJsonResponse<StockAnalysisRun>(response, 'Failed to save Stock Analysis run');
  },

  async getLatestRun(): Promise<StockAnalysisRun | null> {
    const response = await fetch(`${API_BASE_URL}/stock-analysis-runs/latest`);
    return parseJsonResponse<StockAnalysisRun | null>(response, 'Failed to load latest Stock Analysis run');
  },

  async getRun(runId: number): Promise<StockAnalysisRun> {
    const response = await fetch(`${API_BASE_URL}/stock-analysis-runs/${runId}`);
    return parseJsonResponse<StockAnalysisRun>(response, 'Failed to load Stock Analysis run');
  },
};
