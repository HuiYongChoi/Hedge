// 매수 후보 스캔 API — 대형주를 계산 신호만으로 훑어 종목별 판정을 스트리밍으로 받는다.
// 백엔드: app/backend/routes/screener.py

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export type ScreenerMarket = 'ALL' | 'KR' | 'US';

export type ScreenerVerdict =
  | 'buy'
  | 'quality_fair'
  | 'quality_expensive'
  | 'quality_no_value'
  | 'not_quality'
  | 'insufficient';

export type AxisSignal = 'bullish' | 'neutral' | 'bearish' | null;

export interface ScreenerUniverseEntry {
  ticker: string;
  name: string;
  market: 'KR' | 'US';
}

export interface ScreenerResult extends ScreenerUniverseEntry {
  verdict: ScreenerVerdict;
  quality: {
    profitability: AxisSignal;
    growth: AxisSignal;
    financial_health: AxisSignal;
    bullish: number;
    bearish: number;
    passed: boolean;
  } | null;
  value: {
    /** 적정가 ÷ 시가총액 − 1 (이상치 제외 가중평균). +0.2 = 20% 저평가 */
    gap: number | null;
    signal: string | null;
    intrinsic_per_share: number | null;
  };
  error: string | null;
  cached?: boolean;
}

export interface ScreenerScanHandlers {
  onStart?: (info: { total: number; end_date: string; buy_gap: number }) => void;
  onResult: (result: ScreenerResult) => void;
  onComplete?: (info: { total: number; counts: Partial<Record<ScreenerVerdict, number>> }) => void;
  onError?: (message: string) => void;
}

export const screenerApi = {
  async fetchUniverse(market: ScreenerMarket): Promise<{ universe: ScreenerUniverseEntry[]; buy_gap: number }> {
    const response = await fetch(`${API_BASE_URL}/screener/universe?market=${market}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  /** 스캔을 시작한다. 돌려준 함수를 부르면 중단한다. */
  scan(market: ScreenerMarket, refresh: boolean, handlers: ScreenerScanHandlers): () => void {
    const controller = new AbortController();

    (async () => {
      let completed = false;
      try {
        const response = await fetch(`${API_BASE_URL}/screener/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market, refresh }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

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
