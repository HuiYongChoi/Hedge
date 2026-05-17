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
        // Edge-clamp the card so the full 112px width stays inside the container.
        // When leftPct is near 0/100, anchor the card edge instead of its centre —
        // otherwise translateX(-50%) pushes the card outside the container and
        // the broker name gets visually clipped (cf. MU where Goldman $400 == range.min).
        const cardHalfPct = containerPx > 0 ? (CALLOUT_PX / 2 / containerPx) * 100 : 0;
        const transformX =
          leftPct <= cardHalfPct
            ? '0'
            : leftPct >= 100 - cardHalfPct
              ? '-100%'
              : '-50%';

        return (
          <div
            key={broker.name}
            className="absolute"
            style={{
              left: `${leftPct}%`,
              top: `${topPx}px`,
              transform: `translateX(${transformX})`,
              zIndex: isHovered ? 30 : 10,
            }}
          >
            {/* Connecting line — anchored to the broker's actual leftPct on the bar.
                Position inside the wrapper is the inverse of the wrapper transform so
                the line stays at the broker's true x position even after edge-clamping. */}
            <div
              className="absolute w-px bg-muted-foreground/20"
              style={{
                left: transformX === '0' ? '0' : transformX === '-100%' ? '100%' : '50%',
                top: `-${topPx + 8}px`,
                height: `${topPx + 8}px`,
              }}
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
