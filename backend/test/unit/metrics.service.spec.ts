import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../src/common/config/app-config.service.js';
import { MetricsService } from '../../src/common/metrics/metrics.service.js';

describe('MetricsService', () => {
  it('renders stable Prometheus counters, gauges, histograms, and escaped labels', () => {
    const metrics = new MetricsService({
      values: { INSTANCE_ID: 'test', METRICS_ENABLED: true },
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
    metrics.observe(
      'cluchess_test_latency_seconds',
      'Test latency.',
      0.02,
      { outcome: 'ok' },
      [0.01, 0.05],
    );

    const output = metrics.render();
    expect(output).toContain('# TYPE cluchess_test_events_total counter');
    expect(output).toContain(
      'cluchess_test_events_total{outcome="ok\\"value"} 3',
    );
    expect(output).toContain('cluchess_test_state{mode="active"} 1');
    expect(output).toContain(
      'cluchess_test_latency_seconds_bucket{le="0.05",outcome="ok"} 1',
    );
    expect(output).toContain(
      'cluchess_test_latency_seconds_count{outcome="ok"} 1',
    );
    expect(output).toContain('process_resident_memory_bytes');
  });

  it('rejects identifier labels that would create unbounded cardinality', () => {
    const metrics = new MetricsService({
      values: { INSTANCE_ID: 'test', METRICS_ENABLED: true },
    } as AppConfigService);

    expect(() => {
      metrics.increment('cluchess_unsafe_total', 'Unsafe.', {
        game_id: '0ff9ea1e-a30f-49f1-9048-1f36c26089c3',
      });
    }).toThrow('High-cardinality metric label');
  });

  it('emits no application metrics when disabled', () => {
    const metrics = new MetricsService({
      values: { INSTANCE_ID: 'test', METRICS_ENABLED: false },
    } as AppConfigService);
    metrics.increment('cluchess_hidden_total', 'Hidden.');

    expect(metrics.render()).toBe('');
  });
});
