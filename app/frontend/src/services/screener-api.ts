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
  };
  error: string | null;
  cached?: boolean;
}

export interface ScreenerScanHandlers {
  onStart?: (info: { total: number; end_date: string; buy_gap: number; watch_gap?: number }) => void;
  onResult: (result: ScreenerResult) => void;
  onComplete?: (info: { total: number; counts: Partial<Record<ScreenerVerdict, number>> }) => void;
  onError?: (message: string) => void;
}

export const screenerApi = {
  async fetchUniverse(market: ScreenerMarket): Promise<{ universe: ScreenerUniverseEntry[]; buy_gap: number; watch_gap: number }> {
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
