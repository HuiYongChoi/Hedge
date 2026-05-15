interface PbrThermometerProps {
  p10: number;
  p90: number;
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  currentPbr: number;
}

export function PbrThermometer({ p10, p90, percentiles, currentPbr }: PbrThermometerProps) {
  const range = p90 - p10;
  const toX = (v: number) => range > 0 ? Math.min(Math.max((v - p10) / range, 0), 1) * 100 : 50;

  const ticks = [
    { v: percentiles.p10, label: 'P10' },
    { v: percentiles.p25, label: 'P25' },
    { v: percentiles.p50, label: 'P50' },
    { v: percentiles.p75, label: 'P75' },
    { v: percentiles.p90, label: 'P90' },
  ];

  const ptrX = toX(currentPbr);

  return (
    <div className="relative w-full select-none" style={{ height: '52px' }}>
      <svg
        viewBox="0 0 100 52"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        aria-label={`PBR 밴드 게이지 — 현재 PBR ${currentPbr.toFixed(2)}배`}
      >
        <defs>
          <linearGradient id="pbr-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        {/* gradient bar */}
        <rect x="0" y="16" width="100" height="8" rx="2" fill="url(#pbr-grad)" opacity="0.7" />
        {/* tick marks */}
        {ticks.map(({ v }) => (
          <line
            key={v}
            x1={toX(v)}
            y1="14"
            x2={toX(v)}
            y2="26"
            stroke="white"
            strokeWidth="0.5"
            opacity="0.6"
          />
        ))}
        {/* current PBR pointer triangle */}
        <polygon
          points={`${ptrX - 2},28 ${ptrX + 2},28 ${ptrX},33`}
          fill="white"
          opacity="0.95"
        />
      </svg>
      {/* tick labels below */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-0">
        {ticks.map(({ v, label }) => (
          <div
            key={label}
            className="text-[9px] text-muted-foreground font-mono"
            style={{
              position: 'absolute',
              left: `${toX(v)}%`,
              transform: 'translateX(-50%)',
              bottom: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {v.toFixed(2)}x
          </div>
        ))}
      </div>
    </div>
  );
}
