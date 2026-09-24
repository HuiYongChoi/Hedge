const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

/** 목록 한 줄 — 카드 배지/목록 표시에 필요한 최소 정보 */
export interface BrokerReportSummary {
  id: string;
  broker: string;
  broker_key: string;
  title: string;
  published_date: string;
  detail_url: string;
  pdf_url: string | null;
}

export interface BrokerReportIndex {
  ticker: string;
  supported: boolean;
  item_code: string;
  list_url: string;
  source: string;
  reports: BrokerReportSummary[];
}

export interface BrokerReportDetail {
  id: string;
  broker: string;
  title: string;
  published_date: string;
  target_price: number | null;
  opinion: string | null;
  signal: 'BUY' | 'HOLD' | 'NEUTRAL' | 'SELL' | null;
  body: string[];
  detail_url: string;
  pdf_url: string | null;
  views: number | null;
  source: string;
}

/**
 * 증권사 이름 매칭 키 — 백엔드 `normalize_broker`와 동일 규칙.
 * FnGuide 컨센서스 표기와 네이버 리서치 표기가 미묘하게 달라(공백·'투자증권' 유무)
 * 축약형으로 비교한다.
 */
export function normalizeBrokerKey(name: string): string {
  if (!name) return '';
  const stripped = name
    .replace(/주식회사|\(주\)|（주）/g, '')
    .replace(/[\s()（）·.]/g, '');
  const key = stripped
    .replace(/금융투자/g, '')
    .replace(/투자증권/g, '')
    .replace(/증권/g, '')
    .replace(/홀딩스/g, '');
  return (key || stripped).toUpperCase();
}

export const brokerReportService = {
  fetchIndex: async (ticker: string): Promise<BrokerReportIndex | null> => {
    try {
      const res = await fetch(`${API_BASE_URL}/analyst-targets/${encodeURIComponent(ticker)}/reports`);
      if (!res.ok) return null;
      return await res.json() as BrokerReportIndex;
    } catch {
      return null;
    }
  },

  fetchDetail: async (ticker: string, reportId: string): Promise<BrokerReportDetail | null> => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/analyst-targets/${encodeURIComponent(ticker)}/reports/${encodeURIComponent(reportId)}`,
      );
      if (!res.ok) return null;
      return await res.json() as BrokerReportDetail;
    } catch {
      return null;
    }
  },
};
