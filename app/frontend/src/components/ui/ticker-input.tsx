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
    KOREAN_NAME_TO_TICKER[t.ticker] = t.ticker;
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

function getTermFromValue(inputValue: string): string {
  const parts = inputValue.split(',');
  return parts[parts.length - 1].trim();
}

function getSuggestionInsertValue(suggestion: TickerSuggestion): string {
  return suggestion.market === 'KR' ? suggestion.name : suggestion.ticker;
}

function rememberKoreanTickerSuggestion(suggestion: TickerSuggestion) {
  if (suggestion.market !== 'KR') return;
  KOREAN_NAME_TO_TICKER[suggestion.name] = suggestion.ticker;
  KOREAN_NAME_TO_TICKER[suggestion.ticker] = suggestion.ticker;
}

function normalizeAutocompleteToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
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

function getStaticSuggestions(term: string): TickerSuggestion[] {
  const upper = term.toUpperCase();
  return POPULAR_TICKERS.filter(t =>
    t.ticker.toUpperCase().startsWith(upper) ||
    t.name.toUpperCase().includes(upper)
  ).slice(0, 5);
}

interface TickerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function TickerInput({ value, onChange, placeholder, className, onKeyDown }: TickerInputProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // 사용자가 명시적으로 닫은 term을 기억 → 같은 term에서 재오픈 방지
  const [dismissedTerm, setDismissedTerm] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const isComposingRef = useRef(false);
  const skipNextFetchRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentTerm = getTermFromValue(draftValue);

  // suggestions 있고 term이 있고 사용자가 닫지 않은 경우에만 드롭다운 표시
  const showDropdown = suggestions.length > 0 && currentTerm.length > 0 && currentTerm !== dismissedTerm;

  useEffect(() => {
    if (!isComposingRef.current) {
      // Phase 2: 값이 실제로 다를 때만 setState → currentTerm 불필요한 재트리거 방지
      setDraftValue(prev => prev === value ? prev : value);
    }
  }, [value]);

  const fetchSuggestions = (term: string) => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (term.length < 1) {
      setSuggestions([]);
      return;
    }

    // 즉시 정적 결과 표시
    const staticResults = getStaticSuggestions(term);
    setSuggestions(staticResults);

    const controller = new AbortController();
    abortRef.current = controller;

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/ticker-search?q=${encodeURIComponent(term)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('Search failed');
        const data: TickerSuggestion[] = await res.json();
        data.forEach(rememberKoreanTickerSuggestion);

        // 입력값이 바뀐 경우 무시
        const liveTerm = getTermFromValue(inputRef.current?.value ?? '');
        if (normalizeAutocompleteToken(liveTerm) !== normalizeAutocompleteToken(term)) {
          return;
        }

        // API 결과가 있으면 업데이트, 없으면 정적 결과 유지
        if (data.length > 0) {
          setSuggestions(data);
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
    if (isComposingRef.current) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    // term이 바뀌면 dismissed 상태 초기화
    setDismissedTerm(null);

    if (currentTerm.length >= 1) {
      fetchSuggestions(currentTerm);
    } else {
      setSuggestions([]);
    }

    // Phase 1: StrictMode cleanup — mount→cleanup→remount 시 이전 실행 부작용 제거
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTerm]);

  const dismiss = () => {
    setDismissedTerm(currentTerm);
    setActiveIdx(-1);
  };

  const handleSelect = (suggestion: TickerSuggestion) => {
    skipBlurRef.current = true;
    skipNextFetchRef.current = true;
    rememberKoreanTickerSuggestion(suggestion);

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const insertValue = getSuggestionInsertValue(suggestion);
    const currentValue = inputRef.current?.value ?? value;
    const parts = currentValue.split(',');
    parts[parts.length - 1] = insertValue;
    const nextValue = parts.map(p => p.trim()).join(',');

    setDraftValue(nextValue);
    onChange(nextValue);
    setSuggestions([]);
    setDismissedTerm(null);
    setActiveIdx(-1);

    setTimeout(() => {
      skipBlurRef.current = false;
      inputRef.current?.focus();
    }, 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    const isInputComposing = isComposingRef.current || Boolean((e.nativeEvent as InputEvent).isComposing);
    setDraftValue(nextValue);
    setActiveIdx(-1);
    if (isInputComposing) return;
    onChange(nextValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isComposing = isComposingRef.current || e.nativeEvent.isComposing;
    if (isComposing) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) return;
    }

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
          // 선택 없이 Enter → 드롭다운 닫고 즉시 fetch 실행
          dismiss();
          onKeyDown?.(e);
        }
        return;
      }
      if (e.key === 'Escape') {
        dismiss();
        return;
      }
    }
    onKeyDown?.(e);
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    const nextValue = e.currentTarget.value;
    setDraftValue(nextValue);
    onChange(nextValue);

    const term = getTermFromValue(nextValue);
    if (term.length >= 1) {
      fetchSuggestions(term);
    } else {
      setSuggestions([]);
    }
  };

  const handleBlur = () => {
    if (skipBlurRef.current) return;
    // Phase 3: 기존 타이머 취소 후 재설정 — 빠른 focus 복귀 시 이중 닫힘 방지
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
      dismiss();
    }, 200);
  };

  return (
    <div className="relative w-full">
      <Input
        ref={inputRef}
        value={draftValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onFocus={() => {
          // Phase 3: blur 타이머가 살아있으면 취소 — 클릭→포커스 복귀 시 드롭다운 유지
          if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          // 포커스 시 term이 있고 suggestions가 있으면 다시 표시
          if (currentTerm.length >= 1 && suggestions.length > 0) {
            setDismissedTerm(null);
          }
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={`${className || ''} ${draftValue ? 'pr-8' : ''}`}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {draftValue && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraftValue('');
            onChange('');
            setSuggestions([]);
            setDismissedTerm(null);
            setActiveIdx(-1);
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
          className="absolute z-50 top-full left-0 mt-1 w-full max-h-72 rounded-md border border-border bg-popover shadow-md overflow-y-auto"
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
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-primary">
                  {s.market === 'KR' ? s.name : s.ticker}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {s.market === 'KR' ? s.ticker : s.name}
                </div>
              </div>
              <MarketBadge market={s.market} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
