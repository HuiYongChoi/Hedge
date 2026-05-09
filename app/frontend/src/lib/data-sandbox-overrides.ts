export interface SandboxTickerOverrides {
  metrics?: Record<string, number>;
  line_items?: Record<string, unknown>[];
  forward_metrics?: Record<string, unknown>;
}

export interface DataSandboxOverrideSnapshot {
  ticker: string;
  updated_at: string;
  metric_overrides: Record<string, SandboxTickerOverrides>;
}

interface BuildDataSandboxOverrideSnapshotArgs {
  ticker: string;
  metricsOverrides: Record<string, string>;
  lineItemsOverrides: Record<string, unknown>[];
  forwardMetricsOverride?: Record<string, unknown> | null;
  parseMetricOverride: (value: string) => number | null;
  now?: () => Date;
}

export const DATA_SANDBOX_OVERRIDES_STORAGE_KEY = 'ai-hedge-fund:data-sandbox-overrides:v1';
export const DATA_SANDBOX_OVERRIDES_EVENT = 'data-sandbox-overrides-updated';

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldKeepLineItemValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function buildCleanMetrics(
  metricsOverrides: Record<string, string>,
  parseMetricOverride: (value: string) => number | null,
): Record<string, number> {
  const cleanMetrics: Record<string, number> = {};

  Object.entries(metricsOverrides).forEach(([key, value]) => {
    if (value === '') return;
    const parsed = parseMetricOverride(value);
    if (parsed !== null) cleanMetrics[key] = parsed;
  });

  return cleanMetrics;
}

function buildCleanLineItems(lineItemsOverrides: Record<string, unknown>[]): Record<string, unknown>[] {
  return lineItemsOverrides
    .map(row => {
      const cleanRow: Record<string, unknown> = {};
      Object.entries(row).forEach(([key, value]) => {
        if (shouldKeepLineItemValue(value)) cleanRow[key] = value;
      });
      return cleanRow;
    })
    .filter(row => Object.keys(row).length > 0);
}

function buildCleanForwardMetrics(forwardMetricsOverride?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!isRecord(forwardMetricsOverride)) return null;

  const forwardPe = forwardMetricsOverride.forward_pe;
  if (typeof forwardPe !== 'number' || !Number.isFinite(forwardPe) || forwardPe <= 0) return null;

  const cleanForwardMetrics: Record<string, unknown> = {};
  Object.entries(forwardMetricsOverride).forEach(([key, value]) => {
    if (value !== undefined && value !== '') cleanForwardMetrics[key] = value;
  });

  return cleanForwardMetrics;
}

export function buildDataSandboxOverrideSnapshot({
  ticker,
  metricsOverrides,
  lineItemsOverrides,
  forwardMetricsOverride,
  parseMetricOverride,
  now = () => new Date(),
}: BuildDataSandboxOverrideSnapshotArgs): DataSandboxOverrideSnapshot | null {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) return null;

  const cleanMetrics = buildCleanMetrics(metricsOverrides, parseMetricOverride);
  const cleanLineItems = buildCleanLineItems(lineItemsOverrides);
  const cleanForwardMetrics = buildCleanForwardMetrics(forwardMetricsOverride);
  const overrides: SandboxTickerOverrides = {};

  if (Object.keys(cleanMetrics).length > 0) overrides.metrics = cleanMetrics;
  if (cleanLineItems.length > 0) overrides.line_items = cleanLineItems;
  if (cleanForwardMetrics) overrides.forward_metrics = cleanForwardMetrics;
  if (!overrides.metrics && !overrides.line_items && !overrides.forward_metrics) return null;

  return {
    ticker: normalizedTicker,
    updated_at: now().toISOString(),
    metric_overrides: {
      [normalizedTicker]: overrides,
    },
  };
}

export function getSandboxOverrideForTicker(
  snapshot: DataSandboxOverrideSnapshot | null,
  ticker: string,
): SandboxTickerOverrides | null {
  const normalizedTicker = normalizeTicker(ticker);
  if (!snapshot || !normalizedTicker) return null;
  return snapshot.metric_overrides[normalizedTicker] || null;
}

export function getSandboxOverridesForTickers(
  snapshot: DataSandboxOverrideSnapshot | null,
  tickers: string[],
): Record<string, SandboxTickerOverrides> | null {
  if (!snapshot) return null;

  const overrides: Record<string, SandboxTickerOverrides> = {};
  tickers.forEach(ticker => {
    const normalizedTicker = normalizeTicker(ticker);
    const tickerOverrides = getSandboxOverrideForTicker(snapshot, normalizedTicker);
    if (tickerOverrides) overrides[normalizedTicker] = tickerOverrides;
  });

  return Object.keys(overrides).length > 0 ? overrides : null;
}

export function countSandboxOverrideFields(overrides: SandboxTickerOverrides | null): number {
  if (!overrides) return 0;

  const metricCount = Object.keys(overrides.metrics || {}).length;
  const lineItemCount = (overrides.line_items || []).reduce((count, row) => (
    count + Object.keys(row).filter(key => key !== 'report_period').length
  ), 0);
  const forwardMetricCount = overrides.forward_metrics?.forward_pe ? 1 : 0;

  return metricCount + lineItemCount + forwardMetricCount;
}

function isDataSandboxOverrideSnapshot(value: unknown): value is DataSandboxOverrideSnapshot {
  if (!isRecord(value)) return false;
  if (typeof value.ticker !== 'string') return false;
  if (typeof value.updated_at !== 'string') return false;
  if (!isRecord(value.metric_overrides)) return false;
  return true;
}

export function loadDataSandboxOverrideSnapshot(): DataSandboxOverrideSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(DATA_SANDBOX_OVERRIDES_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    return isDataSandboxOverrideSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDataSandboxOverrideSnapshot(snapshot: DataSandboxOverrideSnapshot): boolean {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(DATA_SANDBOX_OVERRIDES_STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(DATA_SANDBOX_OVERRIDES_EVENT, { detail: snapshot }));
    return true;
  } catch {
    return false;
  }
}
