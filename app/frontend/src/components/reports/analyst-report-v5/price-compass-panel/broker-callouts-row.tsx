import { useEffect, useRef, useState } from 'react';
import { stackCallouts } from './stacking-layout';
import { BrokerCalloutCard } from './broker-callout-card';
import type { BrokerTarget } from './types';

interface BrokerCalloutsRowProps {
  brokers: BrokerTarget[];
  range: { min: number; max: number };
  currentPrice: number | null;
  hoveredBroker: string | null;
  currency: string;
  onHoverChange: (name: string | null) => void;
}

const ROW_HEIGHT_PX = 68;   // single-state card height + gap
const CALLOUT_PX = 112;
const GAP_PX = 8;

export function BrokerCalloutsRow({
  brokers,
  range,
  currentPrice,
  hoveredBroker,
  currency,
  onHoverChange,
}: BrokerCalloutsRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerPx, setContainerPx] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerPx(w);
    });
    ro.observe(el);
    setContainerPx(el.offsetWidth || 1200);
    return () => ro.disconnect();
  }, []);

  if (brokers.length === 0) return null;

  const positioned = stackCallouts(brokers, range, containerPx, CALLOUT_PX, GAP_PX);
  const numRows = positioned.length > 0 ? Math.max(...positioned.map(p => p.rowIndex)) + 1 : 1;
  const containerHeight = numRows * ROW_HEIGHT_PX + 16;

  return (
    <div
      ref={containerRef}
      className="relative mt-1 w-full"
      style={{ height: `${containerHeight}px` }}
    >
      {positioned.map(({ broker, leftPct, rowIndex }) => {
        const isHovered = hoveredBroker === broker.name;
        const topPx = rowIndex * ROW_HEIGHT_PX + 8;

        return (
          <div
            key={broker.name}
            className="absolute"
            style={{
              left: `${leftPct}%`,
              top: `${topPx}px`,
              transform: 'translateX(-50%)',
              zIndex: isHovered ? 30 : 10,
            }}
          >
            {/* Connecting line — neutral gray, behind cards (z-index managed by parent) */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-px bg-muted-foreground/20"
              style={{ top: `-${topPx + 8}px`, height: `${topPx + 8}px` }}
            />
            <BrokerCalloutCard
              broker={broker}
              currentPrice={currentPrice}
              isHovered={isHovered}
              currency={currency}
              onHoverChange={hovered => onHoverChange(hovered ? broker.name : null)}
            />
          </div>
        );
      })}
    </div>
  );
}
