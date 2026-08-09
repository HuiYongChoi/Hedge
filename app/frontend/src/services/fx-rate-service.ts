const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

export interface FxRateResponse {
  base: string;
  quote: string;
  rate: number | null;
  cached: boolean;
}

// 세션 내 메모리 캐시 — 같은 통화를 화면마다 다시 조회하지 않는다.
const inFlight = new Map<string, Promise<number | null>>();
const resolved = new Map<string, number | null>();

/** 1 base 통화가 몇 원인지. 조회 실패 시 null(원화 병기를 생략한다). */
export async function fetchKrwRate(base: string): Promise<number | null> {
  const key = (base || '').trim().toUpperCase();
  if (!key) return null;
  if (key === 'KRW') return 1;
  if (resolved.has(key)) return resolved.get(key) ?? null;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/fx-rates/${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      const data: FxRateResponse = await res.json();
      const rate = typeof data.rate === 'number' && Number.isFinite(data.rate) && data.rate > 0
        ? data.rate
        : null;
      resolved.set(key, rate);
      return rate;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}
