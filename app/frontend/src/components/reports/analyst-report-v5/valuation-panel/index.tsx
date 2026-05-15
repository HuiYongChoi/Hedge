import type { ReportLanguage, ValuationDeepDive } from '../types';
import { ValuationComparisonCard } from './valuation-comparison';
import { RimDetailCard } from './rim-detail-card';
import { PbrBandCard } from './pbr-band-card';

interface ValuationDeepDivePanelProps {
  dive: ValuationDeepDive;
  currentPrice: number | null;
  currency: string;
  language: ReportLanguage;
}

export function ValuationDeepDivePanel({
  dive,
  currentPrice,
  currency,
  language,
}: ValuationDeepDivePanelProps) {
  return (
    <div className="mt-4 space-y-3">
      {dive.models.length > 0 && (
        <ValuationComparisonCard
          dive={dive}
          currentPrice={currentPrice}
          currency={currency}
          language={language}
        />
      )}
      {dive.rim && (
        <RimDetailCard
          rim={dive.rim}
          currentPrice={currentPrice}
          currency={currency}
          language={language}
        />
      )}
      {dive.pbr && (
        <PbrBandCard
          pbr={dive.pbr}
          currency={currency}
          language={language}
        />
      )}
    </div>
  );
}
