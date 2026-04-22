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

function SvgLineChart({
  data,
  width = 600,
  height = 140,
  color = '#3b82f6',
  label,
}: {
  data: { x: number; y: number; label: string }[];
  width?: number;
  height?: number;
  color?: string;
  label: string;
}) {
  if (data.length < 2) return null;

  const pad = { top: 12, right: 16, bottom: 28, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const xs = data.map(d => d.x);
  const ys = data.map(d => d.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;

  const toSvg = (x: number, y: number) => ({
    sx: pad.left + ((x - minX) / (maxX - minX || 1)) * innerW,
    sy: pad.top + (1 - (y - minY) / rangeY) * innerH,
  });

  const points = data.map(d => {
    const { sx, sy } = toSvg(d.x, d.y);
    return `${sx},${sy}`;
  });
  const polyline = points.join(' ');

  // Y-axis tick labels (3 ticks)
  const yTicks = [minY, minY + rangeY / 2, maxY];

  // X-axis labels (first and last date)
  const firstLabel = data[0]?.label?.slice(0, 10) ?? '';
  const lastLabel = data[data.length - 1]?.label?.slice(0, 10) ?? '';

  function fmt(v: number) {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(2);
  }

  return (
    <div className="w-full">
      <p className="text-xs text-muted-foreground mb-1 px-1">{label}</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: `${height}px` }}
        preserveAspectRatio="none"
      >
        {/* Grid lines */}
        {yTicks.map((tick, i) => {
          const { sy } = toSvg(minX, tick);
          return (
            <g key={i}>
              <line
                x1={pad.left} y1={sy}
                x2={pad.left + innerW} y2={sy}
                stroke="currentColor" strokeOpacity="0.08" strokeWidth="1"
              />
              <text
                x={pad.left - 4} y={sy + 4}
                textAnchor="end" fontSize="9"
                fill="currentColor" fillOpacity="0.5"
              >
                {fmt(tick)}
              </text>
            </g>
          );
        })}

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Area fill */}
        <polygon
          points={`${pad.left},${pad.top + innerH} ${polyline} ${pad.left + innerW},${pad.top + innerH}`}
          fill={color}
          fillOpacity="0.07"
        />

        {/* X-axis labels */}
        <text x={pad.left} y={height - 4} fontSize="9" fill="currentColor" fillOpacity="0.4">
          {firstLabel}
        </text>
        <text x={pad.left + innerW} y={height - 4} fontSize="9" textAnchor="end" fill="currentColor" fillOpacity="0.4">
          {lastLabel}
        </text>
      </svg>
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

  const closeData = sorted.map((p, i) => ({ x: i, y: p.close, label: p.time }));
  const volumeData = sorted
    .filter(p => p.volume !== undefined && p.volume !== null)
    .map((p, i) => ({ x: i, y: p.volume as number, label: p.time }));

  const latest = sorted[sorted.length - 1];
  const oldest = sorted[0];
  const change = latest && oldest
    ? ((latest.close - oldest.close) / oldest.close) * 100
    : null;

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

      {/* Price chart */}
      <div className="border rounded-lg p-3">
        <SvgLineChart
          data={closeData}
          label={language === 'ko' ? `${ticker} 종가 추이` : `${ticker} Close Price`}
          color="#3b82f6"
          height={140}
        />
      </div>

      {/* Volume chart */}
      {volumeData.length > 0 && (
        <div className="border rounded-lg p-3">
          <SvgLineChart
            data={volumeData}
            label={language === 'ko' ? '거래량 추이' : 'Volume'}
            color="#8b5cf6"
            height={100}
          />
        </div>
      )}
    </div>
  );
}
