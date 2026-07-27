import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

type MetricKind = 'counter' | 'gauge';
type MetricLabels = Readonly<Record<string, string>>;

interface MetricFamily {
  readonly help: string;
  readonly kind: MetricKind;
  readonly samples: Map<string, MetricSample>;
}

interface MetricSample {
  readonly labels: MetricLabels;
  value: number;
}

@Injectable()
export class MetricsService {
  private readonly enabled: boolean;
  private readonly families = new Map<string, MetricFamily>();

  constructor(config: AppConfigService) {
    this.enabled = config.values.METRICS_ENABLED;
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
    const sample = this.sample(name, 'counter', help, labels);
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
    this.sample(name, 'gauge', help, labels).value = value;
  }

  render(): string {
    if (!this.enabled) {
      return '';
    }
    this.setGauge(
      'process_resident_memory_bytes',
      'Resident memory size in bytes.',
      process.memoryUsage().rss,
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
        lines.push(
          `${name}${this.renderLabels(sample.labels)} ${String(sample.value)}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private labelKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
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
  ): MetricSample {
    this.assertMetricName(name);
    const existing = this.families.get(name);
    if (
      existing !== undefined &&
      (existing.kind !== kind || existing.help !== help)
    ) {
      throw new Error(`Metric ${name} was registered inconsistently.`);
    }
    const family =
      existing ??
      ({
        help,
        kind,
        samples: new Map<string, MetricSample>(),
      } satisfies MetricFamily);
    this.families.set(name, family);
    const key = this.labelKey(labels);
    const sample = family.samples.get(key) ?? {
      labels: { ...labels },
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
