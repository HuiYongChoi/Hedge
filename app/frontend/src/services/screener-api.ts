// 매수 후보 스캔 API — 대형주를 계산 신호만으로 훑어 종목별 판정을 스트리밍으로 받는다.
// 백엔드: app/backend/routes/screener.py

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

// ALL·KR·US: 대형주 고정 목록 / SP500·KOSPI: 스캔 시점의 지수 전체 구성 종목
export type ScreenerMarket = 'ALL' | 'KR' | 'US' | 'SP500' | 'KOSPI';

export type ScreenerVerdict =
  | 'buy'
  | 'watch'
  | 'quality_expensive'
  | 'quality_no_value'
  | 'financial'
  | 'not_quality'
  | 'insufficient';

/** 판정 모델이 이 종목에 맞지 않을 수 있다는 표시 */
export type ScreenerWarning = 'extreme_gap' | 'financial_sector';

export interface ScreenerModelBreakdown {
  key: string;
  per_share: number | null;
  gap: number;
  weight: number;
  /** 다른 모델들과 너무 동떨어져 합산에서 뺐다 */
  excluded: boolean;
  share: number;
}

export type AxisSignal = 'bullish' | 'neutral' | 'bearish' | null;

export interface ScreenerUniverseEntry {
  ticker: string;
  name: string;
  market: 'KR' | 'US';
}

export interface ScreenerResult extends ScreenerUniverseEntry {
  verdict: ScreenerVerdict;
  /** 섹터 이름(GICS 섹터 또는 yfinance sector). 조회하지 못했으면 없음 */
  sector?: string | null;
  /** 업종 이름(GICS 세부 업종 또는 yfinance industry). 조회하지 못했으면 없음 */
  industry?: string | null;
  /** 모델 부적합 가능성 — 괴리율 ±50% 이상, 금융업 */
  warnings?: ScreenerWarning[];
  quality: {
    profitability: AxisSignal;
    growth: AxisSignal;
    financial_health: AxisSignal;
    bullish: number;
    bearish: number;
    passed: boolean;
    /** 항목별 실제 수치 문자열(예: "ROE: 12.30%, Net Margin: N/A") */
    details?: Partial<Record<'profitability' | 'growth' | 'financial_health', string | null>>;
  } | null;
  value: {
    /** 적정가 ÷ 시가총액 − 1 (이상치 제외 가중평균). +0.2 = 20% 저평가 */
    gap: number | null;
    signal: string | null;
    /** 괴리율과 같은 기준의 1주당 적정가 */
    intrinsic_per_share: number | null;
    /** 적정가 ÷ (1 + 괴리율) — 계산에 쓴 주가 */
    price_per_share?: number | null;
    /** 괴리율이 매수 문턱을 넘는 주가 = 적정가 ÷ 1.15 */
    buy_price_per_share?: number | null;
    /** 매수 구간까지 필요한 주가 하락률(0.2 = 20%). 이미 매수 구간이면 0 */
    drop_to_buy?: number | null;
    /** 가치평가 모델별 근거 — 주당 적정가, 현재가 대비, 원래 가중치, 최종 반영 비중(제외면 0) */
    models?: ScreenerModelBreakdown[] | null;
  };
  error: string | null;
  cached?: boolean;
  /** 재무를 다시 받지 않고 저장해 둔 재무 + 오늘 주가로 판정했다 */
  repriced?: boolean;
  /** 재무를 마지막으로 계산한 날 */
  fundamentals_as_of?: string | null;
}

/** 전진 검증 — 판정별·보유기간별 성과 */
export interface TrackStat {
  n: number;
  avg_return: number | null;
  avg_excess: number | null;
  beat_rate: number | null;
}

export interface TrackRecord {
  as_of: string;
  first_snapshot: string | null;
  snapshots: number;
  next_maturity: string | null;
  horizons: string[];
  benchmarks: Record<string, string>;
  summary: Partial<Record<ScreenerVerdict, Record<string, TrackStat>>>;
}

/** 과거 시점 검증 — 검증일 하나 */
export interface HistoryCheckpoint {
  as_of: string;
  verdict: ScreenerVerdict | null;
  note: string | null;
  report_period?: string | null;
  price?: number | null;
  gap?: number | null;
  quality?: { profitability: AxisSignal; growth: AxisSignal; financial_health: AxisSignal; passed: boolean };
  returns?: Record<string, { return: number | null; benchmark: number | null; excess: number | null }>;
}

export interface HistoryCheck {
  ticker: string;
  market: 'KR' | 'US';
  benchmark: string;
  checkpoints: HistoryCheckpoint[];
  buy_summary: { n: number; avg_excess_12m: number | null; beat_rate_12m: number | null };
}

/** 최근 1년 주봉 종가 */
export interface PriceChart {
  ticker: string;
  interval: 'weekly';
  rows: { date: string; close: number }[];
}

/** '저장 분석' 아카이브에 남긴 스캔 결과(result_data) */
export interface ArchivedScan {
  market: ScreenerMarket;
  end_date: string;
  total: number;
  scanned: number;
  /** false 면 중간에 멈춘 스캔 — 그때까지 받은 결과만 있다 */
  complete: boolean;
  buy_gap?: number;
  watch_gap?: number;
  counts?: Partial<Record<ScreenerVerdict, number>>;
  results: ScreenerResult[];
}

export interface ScreenerScanHandlers {
  onStart?: (info: { total: number; end_date: string; buy_gap: number; watch_gap?: number }) => void;
  onResult: (result: ScreenerResult) => void;
  /** 끝까지 돈 스캔이 아카이브에 저장됐을 때(중단된 스캔은 서버가 조용히 저장한다) */
  onArchived?: (info: { id: number; scanned: number; complete: boolean }) => void;
  onComplete?: (info: { total: number; counts: Partial<Record<ScreenerVerdict, number>> }) => void;
  onError?: (message: string) => void;
}

export const screenerApi = {
  async fetchUniverse(market: ScreenerMarket): Promise<{ universe: ScreenerUniverseEntry[]; buy_gap: number; watch_gap: number }> {
    const response = await fetch(`${API_BASE_URL}/screener/universe?market=${market}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  /** 지난 스캔들의 판정별 실제 성과(전진 검증). 주가를 많이 받아 처음엔 느릴 수 있다. */
  async fetchTrackRecord(): Promise<TrackRecord> {
    const response = await fetch(`${API_BASE_URL}/screener/track-record`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  /** 종목 하나를 과거 검증일마다 다시 판정하고 그 뒤 수익률을 지수와 비교한다. */
  async historyCheck(ticker: string, market: 'KR' | 'US', industry?: string | null): Promise<HistoryCheck> {
    const params = new URLSearchParams({ ticker, market });
    if (industry) params.set('industry', industry);
    const response = await fetch(`${API_BASE_URL}/screener/history-check?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  /** 종목 하나의 최근 1년 주봉 종가(서버가 하루 동안 기억한다). */
  async fetchPriceChart(ticker: string): Promise<PriceChart> {
    const response = await fetch(`${API_BASE_URL}/screener/price-chart?ticker=${encodeURIComponent(ticker)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  /** 미국 종목의 네이버 증권 주소(거래소 접미사를 서버가 찾아 준다). 못 찾으면 url 이 null. */
  async fetchNaverLink(ticker: string): Promise<{ ticker: string; url: string | null }> {
    const response = await fetch(`${API_BASE_URL}/screener/naver-link?ticker=${encodeURIComponent(ticker)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  /** 스캔을 시작한다. 돌려준 함수를 부르면 중단한다. 중단돼도 그때까지의 결과는 서버가 아카이브에 남긴다. */
  scan(market: ScreenerMarket, refresh: boolean, handlers: ScreenerScanHandlers, language: 'ko' | 'en' = 'ko'): () => void {
    const controller = new AbortController();

    (async () => {
      let completed = false;
      try {
        const response = await fetch(`${API_BASE_URL}/screener/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market, refresh, language }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          // 지수 구성 종목을 못 받아 오면 서버가 이유를 detail 에 담아 보낸다.
          const detail = await response.json().then(body => body?.detail).catch(() => null);
          throw new Error(typeof detail === 'string' ? detail : `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const eventMatch = block.match(/^event: (.+)$/m);
            const dataMatch = block.match(/^data: (.+)$/m);
            if (!eventMatch || !dataMatch) continue; // keepalive 주석
            const payload = JSON.parse(dataMatch[1]);
            switch (eventMatch[1]) {
              case 'start':
                handlers.onStart?.(payload);
                break;
              case 'result':
                handlers.onResult(payload);
                break;
              case 'archived':
                handlers.onArchived?.(payload);
                break;
              case 'complete':
                completed = true;
                handlers.onComplete?.(payload);
                break;
            }
          }
        }
        if (!completed) handlers.onError?.('stream ended early');
      } catch (error) {
        if (controller.signal.aborted) return;
        handlers.onError?.(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => controller.abort();
  },
};
