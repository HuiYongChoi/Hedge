import { useEffect, useState } from 'react';
import { fetchKrwRate } from '@/services/fx-rate-service';

/**
 * 달러/엔 표기 금액 옆에 붙일 원화 환산 문자열을 만든다.
 * 한국 투자자에게 $433.55 는 체감이 안 되므로 (약 ₩60.1만) 처럼 병기한다.
 *
 * - 원화 종목(currency === 'KRW')이면 환산이 무의미하므로 아무것도 반환하지 않는다.
 * - 환율 조회 실패 시에도 null 을 반환해 화면이 조용히 병기만 생략하도록 한다.
 */
export function useKrwRate(currency: string | null | undefined): number | null {
  const [rate, setRate] = useState<number | null>(null);
  const normalized = (currency || '').trim().toUpperCase();

  useEffect(() => {
    let cancelled = false;
    if (!normalized || normalized === 'KRW') {
      setRate(null);
      return () => { cancelled = true; };
    }
    fetchKrwRate(normalized).then(value => {
      if (!cancelled) setRate(value);
    });
    return () => { cancelled = true; };
  }, [normalized]);

  return rate;
}

/** 원화 금액을 조/억/만 단위의 읽기 쉬운 한국어 표기로 바꾼다. */
export function formatKrwCompact(krw: number): string {
  const abs = Math.abs(krw);
  const sign = krw < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}₩${(abs / 1e12).toFixed(abs / 1e12 >= 100 ? 0 : 1)}조`;
  if (abs >= 1e8) return `${sign}₩${(abs / 1e8).toFixed(abs / 1e8 >= 100 ? 0 : 1)}억`;
  if (abs >= 1e4) return `${sign}₩${(abs / 1e4).toFixed(abs / 1e4 >= 100 ? 0 : 1)}만`;
  return `${sign}₩${Math.round(abs).toLocaleString()}`;
}

/**
 * 병기 문자열. 환율이 없거나 원화 종목이면 빈 문자열을 반환한다.
 * 예: 433.55 USD, rate 1385 → "약 ₩60.1만"
 */
export function krwEquivalentText(
  value: number | null | undefined,
  rate: number | null,
): string {
  if (rate === null || value === null || value === undefined) return '';
  if (!Number.isFinite(value) || !Number.isFinite(rate)) return '';
  if (value === 0) return '';
  return `약 ${formatKrwCompact(value * rate)}`;
}
