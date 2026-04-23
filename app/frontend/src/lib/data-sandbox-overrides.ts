export interface SandboxTickerOverrides {
  metrics?: Record<string, number>;
  line_items?: Record<string, unknown>[];
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

export function buildDataSandboxOverrideSnapshot({
  ticker,
  metricsOverrides,
  lineItemsOverrides,
  parseMetricOverride,
  now = () => new Date(),
}: BuildDataSandboxOverrideSnapshotArgs): DataSandboxOverrideSnapshot | null {
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) return null;

  const cleanMetrics = buildCleanMetrics(metricsOverrides, parseMetricOverride);
  const cleanLineItems = buildCleanLineItems(lineItemsOverrides);
  const overrides: SandboxTickerOverrides = {};

  if (Object.keys(cleanMetrics).length > 0) overrides.metrics = cleanMetrics;
  if (cleanLineItems.length > 0) overrides.line_items = cleanLineItems;
  if (!overrides.metrics && !overrides.line_items) return null;

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

export function countSandboxOverrideFields(overrides: SandboxTickerOverrides | null): number {
  if (!overrides) return 0;

  const metricCount = Object.keys(overrides.metrics || {}).length;
  const lineItemCount = (overrides.line_items || []).reduce((count, row) => (
    count + Object.keys(row).filter(key => key !== 'report_period').length
  ), 0);

  return metricCount + lineItemCount;
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
