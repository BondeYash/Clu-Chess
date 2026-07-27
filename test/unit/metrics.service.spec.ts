import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../src/common/config/app-config.service.js';
import { MetricsService } from '../../src/common/metrics/metrics.service.js';

describe('MetricsService', () => {
  it('renders stable Prometheus counters, gauges, and escaped labels', () => {
    const metrics = new MetricsService({
      values: { METRICS_ENABLED: true },
    } as AppConfigService);

    metrics.increment(
      'cluchess_test_events_total',
      'Test events.',
      { outcome: 'ok"value' },
      2,
    );
    metrics.increment('cluchess_test_events_total', 'Test events.', {
      outcome: 'ok"value',
    });
    metrics.setGauge('cluchess_test_state', 'Test state.', 1, {
      mode: 'active',
    });

    const output = metrics.render();
    expect(output).toContain('# TYPE cluchess_test_events_total counter');
    expect(output).toContain(
      'cluchess_test_events_total{outcome="ok\\"value"} 3',
    );
    expect(output).toContain('cluchess_test_state{mode="active"} 1');
    expect(output).toContain('process_resident_memory_bytes');
  });

  it('emits no application metrics when disabled', () => {
    const metrics = new MetricsService({
      values: { METRICS_ENABLED: false },
    } as AppConfigService);
    metrics.increment('cluchess_hidden_total', 'Hidden.');

    expect(metrics.render()).toBe('');
  });
});
