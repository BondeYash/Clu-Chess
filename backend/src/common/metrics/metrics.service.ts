import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { AppConfigService } from '../config/app-config.service.js';

type MetricKind = 'counter' | 'gauge' | 'histogram';
type MetricLabels = Readonly<Record<string, string>>;

interface MetricFamily {
  readonly buckets: readonly number[];
  readonly help: string;
  readonly kind: MetricKind;
  readonly samples: Map<string, MetricSample>;
}

interface MetricSample {
  readonly bucketCounts: number[];
  readonly labels: MetricLabels;
  count: number;
  sum: number;
  value: number;
}

const DEFAULT_DURATION_BUCKETS = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
]);
const EVENT_LOOP_BUCKETS = Object.freeze([
  0.001, 0.005, 0.01, 0.025, 0.05, 0.07, 0.1, 0.25, 0.5, 1,
]);
const FORBIDDEN_LABEL_KEY =
  /^(?:(?:guest(?:_session)?|game|event|socket|correlation|client_move|token)_?id|jti|ip|address)$/i;
const MAX_SERIES_PER_FAMILY = 100;

@Injectable()
export class MetricsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private eventLoopDelay: IntervalHistogram | undefined;
  private eventLoopTimer: NodeJS.Timeout | undefined;
  private readonly enabled: boolean;
  private readonly families = new Map<string, MetricFamily>();
  private readonly instanceId: string;

  constructor(config: AppConfigService) {
    this.enabled = config.values.METRICS_ENABLED;
    this.instanceId = config.values.INSTANCE_ID;
    this.increment(
      'cluchess_process_restarts_total',
      'Application process starts by instance.',
      { instance: this.instanceId },
    );
    this.observe(
      'nodejs_eventloop_lag_seconds',
      'Observed event-loop p99 delay by sampling interval.',
      0,
      { instance: this.instanceId },
      EVENT_LOOP_BUCKETS,
    );
  }

  onApplicationBootstrap(): void {
    if (!this.enabled || this.eventLoopTimer !== undefined) {
      return;
    }
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopDelay.enable();
    this.eventLoopTimer = setInterval(() => {
      this.captureEventLoopDelay();
    }, 5000);
    this.eventLoopTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.eventLoopTimer !== undefined) {
      clearInterval(this.eventLoopTimer);
      this.eventLoopTimer = undefined;
    }
    this.eventLoopDelay?.disable();
    this.eventLoopDelay = undefined;
  }

  increment(
    name: string,
    help: string,
    labels: MetricLabels = {},
    value = 1,
  ): void {
    if (!this.enabled) {
      return;
    }
    const sample = this.sample(name, 'counter', help, labels, []);
    sample.value += value;
  }

  setGauge(
    name: string,
    help: string,
    value: number,
    labels: MetricLabels = {},
  ): void {
    if (!this.enabled) {
      return;
    }
    this.assertFinite(value);
    this.sample(name, 'gauge', help, labels, []).value = value;
  }

  observe(
    name: string,
    help: string,
    value: number,
    labels: MetricLabels = {},
    buckets: readonly number[] = DEFAULT_DURATION_BUCKETS,
  ): void {
    if (!this.enabled) {
      return;
    }
    this.assertFinite(value);
    if (value < 0) {
      throw new Error(`Histogram ${name} cannot observe a negative value.`);
    }
    const normalizedBuckets = this.normalizeBuckets(buckets);
    const sample = this.sample(
      name,
      'histogram',
      help,
      labels,
      normalizedBuckets,
    );
    for (const [index, upperBound] of normalizedBuckets.entries()) {
      if (value <= upperBound) {
        sample.bucketCounts[index] = (sample.bucketCounts[index] ?? 0) + 1;
      }
    }
    sample.count += 1;
    sample.sum += value;
  }

  render(): string {
    if (!this.enabled) {
      return '';
    }
    this.captureEventLoopDelay();
    this.setGauge(
      'process_resident_memory_bytes',
      'Resident memory size in bytes.',
      process.memoryUsage().rss,
      { instance: this.instanceId },
    );

    const lines: string[] = [];
    for (const [name, family] of [...this.families.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`# HELP ${name} ${family.help}`);
      lines.push(`# TYPE ${name} ${family.kind}`);
      for (const sample of [...family.samples.values()].sort((a, b) =>
        this.labelKey(a.labels).localeCompare(this.labelKey(b.labels)),
      )) {
        if (family.kind === 'histogram') {
          for (const [index, upperBound] of family.buckets.entries()) {
            lines.push(
              `${name}_bucket${this.renderLabels({
                ...sample.labels,
                le: String(upperBound),
              })} ${String(sample.bucketCounts[index] ?? 0)}`,
            );
          }
          lines.push(
            `${name}_bucket${this.renderLabels({
              ...sample.labels,
              le: '+Inf',
            })} ${String(sample.count)}`,
          );
          lines.push(
            `${name}_sum${this.renderLabels(sample.labels)} ${String(sample.sum)}`,
          );
          lines.push(
            `${name}_count${this.renderLabels(sample.labels)} ${String(sample.count)}`,
          );
          continue;
        }
        lines.push(
          `${name}${this.renderLabels(sample.labels)} ${String(sample.value)}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private assertFinite(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error('Prometheus metric values must be finite.');
    }
  }

  private assertLabels(labels: MetricLabels): void {
    for (const [key, value] of Object.entries(labels)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || key === 'le') {
        throw new Error(`Invalid Prometheus label name: ${key}`);
      }
      if (FORBIDDEN_LABEL_KEY.test(key)) {
        throw new Error(`High-cardinality metric label is forbidden: ${key}`);
      }
      if (value.length > 128) {
        throw new Error(`Prometheus label ${key} exceeds 128 characters.`);
      }
    }
  }

  private captureEventLoopDelay(): void {
    const histogram = this.eventLoopDelay;
    if (histogram === undefined || histogram.count === 0) {
      return;
    }
    const p99Seconds = histogram.percentile(99) / 1_000_000_000;
    histogram.reset();
    this.observe(
      'nodejs_eventloop_lag_seconds',
      'Observed event-loop p99 delay by sampling interval.',
      p99Seconds,
      { instance: this.instanceId },
      EVENT_LOOP_BUCKETS,
    );
  }

  private labelKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
  }

  private normalizeBuckets(buckets: readonly number[]): readonly number[] {
    const normalized = [...new Set(buckets)].sort((a, b) => a - b);
    if (
      normalized.length === 0 ||
      normalized.some((bucket) => !Number.isFinite(bucket) || bucket <= 0)
    ) {
      throw new Error('Prometheus histogram buckets must be positive.');
    }
    return normalized;
  }

  private renderLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (entries.length === 0) {
      return '';
    }
    const content = entries
      .map(
        ([key, value]) =>
          `${key}="${value
            .replaceAll('\\', '\\\\')
            .replaceAll('\n', '\\n')
            .replaceAll('"', '\\"')}"`,
      )
      .join(',');
    return `{${content}}`;
  }

  private sample(
    name: string,
    kind: MetricKind,
    help: string,
    labels: MetricLabels,
    buckets: readonly number[],
  ): MetricSample {
    this.assertMetricName(name);
    this.assertLabels(labels);
    const existing = this.families.get(name);
    if (
      existing !== undefined &&
      (existing.kind !== kind ||
        existing.help !== help ||
        existing.buckets.join(',') !== buckets.join(','))
    ) {
      throw new Error(`Metric ${name} was registered inconsistently.`);
    }
    const family =
      existing ??
      ({
        buckets,
        help,
        kind,
        samples: new Map<string, MetricSample>(),
      } satisfies MetricFamily);
    this.families.set(name, family);
    const key = this.labelKey(labels);
    const existingSample = family.samples.get(key);
    if (existingSample !== undefined) {
      return existingSample;
    }
    if (family.samples.size >= MAX_SERIES_PER_FAMILY) {
      throw new Error(`Metric ${name} exceeded its bounded series limit.`);
    }
    const sample: MetricSample = {
      bucketCounts: buckets.map(() => 0),
      count: 0,
      labels: { ...labels },
      sum: 0,
      value: 0,
    };
    family.samples.set(key, sample);
    return sample;
  }

  private assertMetricName(name: string): void {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
      throw new Error(`Invalid Prometheus metric name: ${name}`);
    }
  }
}
