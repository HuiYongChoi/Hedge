import { Input } from '@/components/ui/input';
import { useRef, useState } from 'react';

export const POPULAR_TICKERS = [
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'MSFT', name: 'Microsoft Corporation' },
  { ticker: 'NVDA', name: 'NVIDIA Corporation' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.' },
  { ticker: 'GOOG', name: 'Alphabet Inc. (C)' },
  { ticker: 'AMZN', name: 'Amazon.com Inc.' },
  { ticker: 'META', name: 'Meta Platforms Inc.' },
  { ticker: 'TSLA', name: 'Tesla Inc.' },
  { ticker: 'AVGO', name: 'Broadcom Inc.' },
  { ticker: 'BRK.B', name: 'Berkshire Hathaway Inc.' },
  { ticker: 'JPM', name: 'JPMorgan Chase & Co.' },
  { ticker: 'LLY', name: 'Eli Lilly and Company' },
  { ticker: 'V', name: 'Visa Inc.' },
  { ticker: 'UNH', name: 'UnitedHealth Group Inc.' },
  { ticker: 'XOM', name: 'Exxon Mobil Corporation' },
  { ticker: 'MA', name: 'Mastercard Inc.' },
  { ticker: 'COST', name: 'Costco Wholesale Corporation' },
  { ticker: 'HD', name: 'The Home Depot Inc.' },
  { ticker: 'PG', name: 'Procter & Gamble Co.' },
  { ticker: 'WMT', name: 'Walmart Inc.' },
  { ticker: 'NFLX', name: 'Netflix Inc.' },
  { ticker: 'JNJ', name: 'Johnson & Johnson' },
  { ticker: 'ABBV', name: 'AbbVie Inc.' },
  { ticker: 'BAC', name: 'Bank of America Corporation' },
  { ticker: 'CRM', name: 'Salesforce Inc.' },
  { ticker: 'ORCL', name: 'Oracle Corporation' },
  { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  { ticker: 'INTC', name: 'Intel Corporation' },
  { ticker: 'QCOM', name: 'Qualcomm Inc.' },
  { ticker: 'WFC', name: 'Wells Fargo & Company' },
  { ticker: 'GS', name: 'Goldman Sachs Group Inc.' },
  { ticker: 'MS', name: 'Morgan Stanley' },
  { ticker: 'DIS', name: 'The Walt Disney Company' },
  { ticker: 'ADBE', name: 'Adobe Inc.' },
  { ticker: 'NOW', name: 'ServiceNow Inc.' },
  { ticker: 'INTU', name: 'Intuit Inc.' },
  { ticker: 'TXN', name: 'Texas Instruments Inc.' },
  { ticker: 'ISRG', name: 'Intuitive Surgical Inc.' },
  { ticker: 'BKNG', name: 'Booking Holdings Inc.' },
  { ticker: 'UBER', name: 'Uber Technologies Inc.' },
  { ticker: 'AMAT', name: 'Applied Materials Inc.' },
  { ticker: 'MU', name: 'Micron Technology Inc.' },
  { ticker: 'LRCX', name: 'Lam Research Corporation' },
  { ticker: 'KLAC', name: 'KLA Corporation' },
  { ticker: 'PFE', name: 'Pfizer Inc.' },
  { ticker: 'MRK', name: 'Merck & Co. Inc.' },
  { ticker: 'TMO', name: 'Thermo Fisher Scientific Inc.' },
  { ticker: 'DHR', name: 'Danaher Corporation' },
  { ticker: 'ABT', name: 'Abbott Laboratories' },
  { ticker: 'CVX', name: 'Chevron Corporation' },
  { ticker: 'T', name: 'AT&T Inc.' },
  { ticker: 'VZ', name: 'Verizon Communications Inc.' },
  { ticker: 'CMCSA', name: 'Comcast Corporation' },
  { ticker: 'PYPL', name: 'PayPal Holdings Inc.' },
  { ticker: 'SQ', name: 'Block Inc.' },
  { ticker: 'SHOP', name: 'Shopify Inc.' },
  { ticker: 'SNAP', name: 'Snap Inc.' },
  { ticker: 'SPOT', name: 'Spotify Technology S.A.' },
  { ticker: 'COIN', name: 'Coinbase Global Inc.' },
  { ticker: 'PLTR', name: 'Palantir Technologies Inc.' },
  { ticker: 'ARM', name: 'Arm Holdings plc' },
  { ticker: 'SMCI', name: 'Super Micro Computer Inc.' },
  { ticker: 'APP', name: 'Applovin Corporation' },
  { ticker: 'CRWD', name: 'CrowdStrike Holdings Inc.' },
  { ticker: 'PANW', name: 'Palo Alto Networks Inc.' },
  { ticker: 'FTNT', name: 'Fortinet Inc.' },
  { ticker: 'ZS', name: 'Zscaler Inc.' },
  { ticker: 'SNOW', name: 'Snowflake Inc.' },
  { ticker: 'DDOG', name: 'Datadog Inc.' },
  { ticker: 'MDB', name: 'MongoDB Inc.' },
  { ticker: 'NET', name: 'Cloudflare Inc.' },
  { ticker: 'PATH', name: 'UiPath Inc.' },
  { ticker: 'U', name: 'Unity Software Inc.' },
  { ticker: 'RBLX', name: 'Roblox Corporation' },
  { ticker: 'F', name: 'Ford Motor Company' },
  { ticker: 'GM', name: 'General Motors Company' },
  { ticker: 'RIVN', name: 'Rivian Automotive Inc.' },
  { ticker: 'LCID', name: 'Lucid Group Inc.' },
  { ticker: 'NIO', name: 'NIO Inc.' },
  { ticker: 'BIDU', name: 'Baidu Inc.' },
  { ticker: 'BABA', name: 'Alibaba Group Holding' },
  { ticker: 'JD', name: 'JD.com Inc.' },
  { ticker: 'PDD', name: 'PDD Holdings Inc.' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor Mfg.' },
  { ticker: 'ASML', name: 'ASML Holding N.V.' },
  { ticker: 'SAP', name: 'SAP SE' },
  { ticker: 'SONY', name: 'Sony Group Corporation' },
  { ticker: 'TM', name: 'Toyota Motor Corporation' },
  { ticker: 'HSBC', name: 'HSBC Holdings plc' },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust' },
  { ticker: 'IWM', name: 'iShares Russell 2000 ETF' },
  { ticker: 'GLD', name: 'SPDR Gold Shares' },
  { ticker: 'SLV', name: 'iShares Silver Trust' },
  { ticker: 'BTC', name: 'Bitcoin' },
  { ticker: 'ETH', name: 'Ethereum' },
];

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
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);

  const getCurrentTerm = () => {
    const parts = value.split(',');
    return parts[parts.length - 1].trim().toUpperCase();
  };

  const currentTerm = getCurrentTerm();

  const suggestions = currentTerm.length >= 1
    ? POPULAR_TICKERS.filter(t =>
        t.ticker.startsWith(currentTerm) ||
        t.name.toUpperCase().includes(currentTerm)
      ).slice(0, 8)
    : [];

  const showDropdown = open && suggestions.length > 0;

  const handleSelect = (ticker: string) => {
    skipBlurRef.current = true;
    const parts = value.split(',');
    parts[parts.length - 1] = ticker;
    onChange(parts.map(p => p.trim()).join(','));
    setOpen(false);
    setActiveIdx(-1);
    setTimeout(() => {
      skipBlurRef.current = false;
      inputRef.current?.focus();
    }, 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setActiveIdx(-1);
    const term = e.target.value.split(',').pop()?.trim() || '';
    setOpen(term.length >= 1);
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
      if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        handleSelect(suggestions[activeIdx].ticker);
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
          if (term.length >= 1) setOpen(true);
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {showDropdown && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-64 rounded-md border border-border bg-popover shadow-md overflow-hidden"
          onMouseDown={e => { e.preventDefault(); }}
        >
          {suggestions.map((s, idx) => (
            <div
              key={s.ticker}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                idx === activeIdx
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground'
              }`}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseDown={() => handleSelect(s.ticker)}
            >
              <span className="font-mono font-semibold w-14 shrink-0 text-primary">{s.ticker}</span>
              <span className="text-muted-foreground text-xs truncate">{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
