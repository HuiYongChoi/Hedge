import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

interface PricePoint {
  time: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

interface TrendChartsProps {
  prices: PricePoint[];
  ticker: string;
  language: 'ko' | 'en';
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

function fmtPrice(v: number): string {
  return `$${v.toFixed(2)}`;
}

// Thin out labels so X-axis isn't crowded: show ~6 evenly spaced dates
function makeXTicks(data: { label: string }[], maxTicks = 6): string[] {
  if (data.length <= maxTicks) return data.map(d => d.label);
  const step = Math.floor(data.length / (maxTicks - 1));
  const ticks: string[] = [];
  for (let i = 0; i < data.length; i += step) ticks.push(data[i].label);
  if (ticks[ticks.length - 1] !== data[data.length - 1].label) {
    ticks.push(data[data.length - 1].label);
  }
  return ticks;
}

function PriceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded px-2 py-1 text-xs shadow">
      <p className="text-muted-foreground mb-0.5">{String(label).slice(0, 10)}</p>
      <p className="font-mono font-medium">{fmtPrice(payload[0].value)}</p>
    </div>
  );
}

function VolumeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded px-2 py-1 text-xs shadow">
      <p className="text-muted-foreground mb-0.5">{String(label).slice(0, 10)}</p>
      <p className="font-mono font-medium">{fmt(payload[0].value)}</p>
    </div>
  );
}

export function TrendCharts({ prices, ticker, language }: TrendChartsProps) {
  if (!prices || prices.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {language === 'ko' ? '가격 데이터가 없습니다.' : 'No price data available.'}
      </div>
    );
  }

  const sorted = [...prices].sort((a, b) => a.time.localeCompare(b.time));

  const closeData = sorted.map(p => ({ label: p.time.slice(0, 10), y: p.close }));
  const volumeData = sorted
    .filter(p => p.volume !== undefined && p.volume !== null)
    .map(p => ({ label: p.time.slice(0, 10), y: p.volume as number }));

  const latest = sorted[sorted.length - 1];
  const oldest = sorted[0];
  const change = latest && oldest
    ? ((latest.close - oldest.close) / oldest.close) * 100
    : null;

  const closeTicks = makeXTicks(closeData);
  const volumeTicks = makeXTicks(volumeData);

  return (
    <div className="space-y-4 p-2">
      {/* Summary row */}
      <div className="flex gap-4 text-sm border rounded-lg p-3 bg-muted/20">
        <div>
          <p className="text-xs text-muted-foreground">{language === 'ko' ? '최근 종가' : 'Latest Close'}</p>
          <p className="font-mono font-medium">${latest?.close?.toFixed(2) ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{language === 'ko' ? '기간 수익률' : 'Period Return'}</p>
          <p className={`font-mono font-medium ${change !== null && change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{language === 'ko' ? '데이터 기간' : 'Data Range'}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {oldest?.time?.slice(0, 10)} ~ {latest?.time?.slice(0, 10)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{language === 'ko' ? '거래일 수' : 'Trading Days'}</p>
          <p className="font-mono">{sorted.length}</p>
        </div>
      </div>

      {/* Close Price chart */}
      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2 px-1">
          {language === 'ko' ? `${ticker} 종가 추이` : `${ticker} Close Price`}
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={closeData} margin={{ top: 8, right: 16, bottom: 40, left: 48 }}>
            <CartesianGrid strokeOpacity={0.08} vertical={false} />
            <XAxis
              dataKey="label"
              ticks={closeTicks}
              tick={{ fontSize: 9, fill: 'currentColor', opacity: 0.4 }}
              angle={-45}
              textAnchor="end"
              interval="preserveStartEnd"
              height={48}
            />
            <YAxis
              width={48}
              tickFormatter={fmtPrice}
              tick={{ fontSize: 9, fill: 'currentColor', opacity: 0.5 }}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<PriceTooltip />} />
            <Line
              type="monotone"
              dataKey="y"
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Volume chart */}
      {volumeData.length > 0 && (
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-2 px-1">
            {language === 'ko' ? '거래량 추이' : 'Volume'}
          </p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={volumeData} margin={{ top: 8, right: 16, bottom: 40, left: 48 }}>
              <CartesianGrid strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="label"
                ticks={volumeTicks}
                tick={{ fontSize: 9, fill: 'currentColor', opacity: 0.4 }}
                angle={-45}
                textAnchor="end"
                interval="preserveStartEnd"
                height={48}
              />
              <YAxis
                width={48}
                tickFormatter={fmt}
                tick={{ fontSize: 9, fill: 'currentColor', opacity: 0.5 }}
              />
              <Tooltip content={<VolumeTooltip />} />
              <Bar dataKey="y" fill="#8b5cf6" fillOpacity={0.7} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
