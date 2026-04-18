import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

interface TickerSuggestion {
  ticker: string;
  name: string;
  market?: string; // 'US' | 'KR' | 'GLOBAL'
}

// 즉시 표시할 인기 종목 (API 호출 전 fallback)
export const POPULAR_TICKERS: TickerSuggestion[] = [
  { ticker: 'AAPL', name: 'Apple Inc.', market: 'US' },
  { ticker: 'MSFT', name: 'Microsoft Corporation', market: 'US' },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', market: 'US' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.', market: 'US' },
  { ticker: 'AMZN', name: 'Amazon.com Inc.', market: 'US' },
  { ticker: 'META', name: 'Meta Platforms Inc.', market: 'US' },
  { ticker: 'TSLA', name: 'Tesla Inc.', market: 'US' },
  { ticker: 'AVGO', name: 'Broadcom Inc.', market: 'US' },
  { ticker: 'JPM', name: 'JPMorgan Chase & Co.', market: 'US' },
  { ticker: 'LLY', name: 'Eli Lilly and Company', market: 'US' },
  { ticker: 'V', name: 'Visa Inc.', market: 'US' },
  { ticker: 'UNH', name: 'UnitedHealth Group Inc.', market: 'US' },
  { ticker: 'XOM', name: 'Exxon Mobil Corporation', market: 'US' },
  { ticker: 'MA', name: 'Mastercard Inc.', market: 'US' },
  { ticker: 'COST', name: 'Costco Wholesale Corporation', market: 'US' },
  { ticker: 'HD', name: 'The Home Depot Inc.', market: 'US' },
  { ticker: 'PG', name: 'Procter & Gamble Co.', market: 'US' },
  { ticker: 'WMT', name: 'Walmart Inc.', market: 'US' },
  { ticker: 'NFLX', name: 'Netflix Inc.', market: 'US' },
  { ticker: 'AMD', name: 'Advanced Micro Devices Inc.', market: 'US' },
  { ticker: 'INTC', name: 'Intel Corporation', market: 'US' },
  { ticker: 'QCOM', name: 'Qualcomm Inc.', market: 'US' },
  { ticker: 'PLTR', name: 'Palantir Technologies Inc.', market: 'US' },
  { ticker: 'CRWD', name: 'CrowdStrike Holdings Inc.', market: 'US' },
  { ticker: 'SNOW', name: 'Snowflake Inc.', market: 'US' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor Mfg.', market: 'US' },
  { ticker: 'ASML', name: 'ASML Holding N.V.', market: 'GLOBAL' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', market: 'US' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', market: 'US' },
  // 인기 한국 주요 종목
  { ticker: '005930.KS', name: '삼성전자', market: 'KR' },
  { ticker: '000660.KS', name: 'SK하이닉스', market: 'KR' },
  { ticker: '035420.KS', name: 'NAVER', market: 'KR' },
  { ticker: '035720.KS', name: '카카오', market: 'KR' },
  { ticker: '005380.KS', name: '현대자동차', market: 'KR' },
  { ticker: '000270.KS', name: '기아', market: 'KR' },
  { ticker: '373220.KS', name: 'LG에너지솔루션', market: 'KR' },
  { ticker: '247540.KQ', name: '에코프로비엠', market: 'KR' },
];

// 한국 기업명 → 티커 코드 변환 테이블 (API 제출 전 변환에 사용)
export const KOREAN_NAME_TO_TICKER: Record<string, string> = {};
POPULAR_TICKERS.forEach(t => {
  if (t.market === 'KR') {
    KOREAN_NAME_TO_TICKER[t.name] = t.ticker;
  }
});

/**
 * 한국 기업명을 티커 코드로 변환합니다.
 * 미국 티커 또는 이미 티커 형식이면 그대로 반환합니다.
 */
export function resolveTickerValue(input: string): string {
  const trimmed = input.trim();
  return KOREAN_NAME_TO_TICKER[trimmed] || trimmed;
}

function MarketBadge({ market }: { market?: string }) {
  if (!market || market === 'GLOBAL') return null;
  const isKR = market === 'KR';
  return (
    <span className={`text-[10px] font-bold px-1 py-0.5 rounded shrink-0 ${
      isKR
        ? 'bg-blue-500/15 text-blue-400'
        : 'bg-green-500/15 text-green-400'
    }`}>
      {isKR ? 'KR' : 'US'}
    </span>
  );
}

interface TickerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function TickerInput({ value, onChange, placeholder, className, onKeyDown }: TickerInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  // 선택 직후 다음 fetchSuggestions를 건너뛰기 위한 플래그
  const skipNextFetchRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const getCurrentTerm = () => {
    const parts = value.split(',');
    return parts[parts.length - 1].trim();
  };

  const currentTerm = getCurrentTerm();

  // 정적 fallback 필터 (API 응답 전 즉시 표시)
  const getStaticSuggestions = (term: string): TickerSuggestion[] => {
    const upper = term.toUpperCase();
    return POPULAR_TICKERS.filter(t =>
      t.ticker.toUpperCase().startsWith(upper) ||
      t.name.toUpperCase().includes(upper)
    ).slice(0, 5);
  };

  const fetchSuggestions = (term: string) => {
    if (term.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // 즉시 정적 결과 표시
    const staticResults = getStaticSuggestions(term);
    setSuggestions(staticResults);
    if (staticResults.length > 0) setOpen(true);

    // 기존 요청 취소
    if (abortRef.current) abortRef.current.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/ticker-search?q=${encodeURIComponent(term)}`,
          { signal: abortRef.current.signal }
        );
        if (!res.ok) throw new Error('Search failed');
        const data: TickerSuggestion[] = await res.json();
        if (data.length > 0) {
          setSuggestions(data);
          setOpen(true);
        } else if (staticResults.length === 0) {
          setOpen(false);
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        // API 실패 시 정적 결과 유지
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  // currentTerm 변경 시 검색 실행
  useEffect(() => {
    // 선택 직후에는 드롭다운을 다시 열지 않음
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    if (currentTerm.length >= 1) {
      fetchSuggestions(currentTerm);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentTerm]);

  const showDropdown = open && suggestions.length > 0;

  /**
   * 제안 선택 처리:
   * - 한국 종목(market==='KR')은 기업명을 입력값으로 사용
   * - 미국/기타 종목은 티커 코드를 사용
   */
  const handleSelect = (suggestion: TickerSuggestion) => {
    skipBlurRef.current = true;
    skipNextFetchRef.current = true;

    const insertValue = suggestion.market === 'KR' ? suggestion.name : suggestion.ticker;

    const parts = value.split(',');
    parts[parts.length - 1] = insertValue;
    onChange(parts.map(p => p.trim()).join(','));
    setOpen(false);
    setActiveIdx(-1);
    setSuggestions([]);
    setTimeout(() => {
      skipBlurRef.current = false;
      inputRef.current?.focus();
    }, 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0) {
          handleSelect(suggestions[activeIdx]);
        } else {
          // Close dropdown and confirm current value without requiring a second Enter
          setOpen(false);
          setActiveIdx(-1);
        }
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveIdx(-1);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const handleBlur = () => {
    if (skipBlurRef.current) return;
    setTimeout(() => setOpen(false), 150);
  };

  return (
    <div className="relative w-full">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          const term = value.split(',').pop()?.trim() || '';
          if (term.length >= 1 && suggestions.length > 0) setOpen(true);
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`${className || ''} ${value ? 'pr-8' : ''}`}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            setOpen(false);
            setActiveIdx(-1);
            setSuggestions([]);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
          title="Clear tickers"
          aria-label="Clear tickers"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {showDropdown && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-72 rounded-md border border-border bg-popover shadow-md overflow-hidden"
          onMouseDown={e => { e.preventDefault(); }}
        >
          {loading && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
              Searching...
            </div>
          )}
          {suggestions.map((s, idx) => (
            <div
              key={s.ticker}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                idx === activeIdx
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              }`}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseDown={() => handleSelect(s)}
            >
              <span className="font-mono font-semibold w-20 shrink-0 text-primary text-xs truncate">
                {s.market === 'KR' ? s.name : s.ticker}
              </span>
              <span className="text-muted-foreground text-xs truncate flex-1">
                {s.market === 'KR' ? s.ticker : s.name}
              </span>
              <MarketBadge market={s.market} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
