// Re-export service types for convenience within this panel
export type { BrokerTarget, TargetDistribution, AnalystTarget } from '@/services/analyst-target-service';
export type { PositionedCallout } from './stacking-layout';

import type { ReportLanguage } from '../types';
export type { ReportLanguage };

/** A named price marker on the bar (DCF, MoS, Consensus, Current, etc.) */
export interface PanelMarker {
  key: string;
  label: string;
  value: number;
  tone: 'current' | 'dcf' | 'mos' | 'consensus' | 'broker';
}

/** Pre-computed sigma marks for the bar */
export interface SigmaMark {
  label: string;
  value: number;
}
