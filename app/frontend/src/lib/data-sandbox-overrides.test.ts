import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDataSandboxOverrideSnapshot,
  countSandboxOverrideFields,
  getSandboxOverrideForTicker,
} from './data-sandbox-overrides.ts';

test('builds a ticker-keyed sandbox override snapshot from edited metrics and line items', () => {
  const snapshot = buildDataSandboxOverrideSnapshot({
    ticker: 'aapl',
    metricsOverrides: {
      market_cap: '3.77B',
      empty_metric: '',
      invalid_metric: 'n/a',
    },
    lineItemsOverrides: [
      {
        report_period: '2025-12-31',
        revenue: 435617000000,
        net_income: null,
        ignored_empty: '',
      },
    ],
    parseMetricOverride: value => (value === '3.77B' ? 3770000000 : null),
    now: () => new Date('2026-04-23T00:00:00.000Z'),
  });

  assert.deepEqual(snapshot, {
    ticker: 'AAPL',
    updated_at: '2026-04-23T00:00:00.000Z',
    metric_overrides: {
      AAPL: {
        metrics: {
          market_cap: 3770000000,
        },
        line_items: [
          {
            report_period: '2025-12-31',
            revenue: 435617000000,
          },
        ],
      },
    },
  });

  const overrides = getSandboxOverrideForTicker(snapshot, 'aapl');
  assert.deepEqual(overrides, snapshot?.metric_overrides.AAPL);
  assert.equal(countSandboxOverrideFields(overrides), 2);
});

test('returns null when there are no usable sandbox overrides', () => {
  const snapshot = buildDataSandboxOverrideSnapshot({
    ticker: 'MSFT',
    metricsOverrides: {
      market_cap: '',
    },
    lineItemsOverrides: [
      {
        revenue: '',
        net_income: null,
      },
    ],
    parseMetricOverride: () => null,
    now: () => new Date('2026-04-23T00:00:00.000Z'),
  });

  assert.equal(snapshot, null);
});
