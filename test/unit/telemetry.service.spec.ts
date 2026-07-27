import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../src/common/config/app-config.service.js';
import { CorrelationContextService } from '../../src/common/logging/correlation-context.service.js';
import { TelemetryService } from '../../src/common/telemetry/telemetry.service.js';

describe('TelemetryService', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it('keeps a correlation boundary across dependency and broadcast spans', async () => {
    const correlation = new CorrelationContextService();
    const telemetry = new TelemetryService(
      {
        values: { OTEL_ENABLED: true },
      } as AppConfigService,
      correlation,
    );
    const correlationId = 'ff5b0389-c3fa-42dd-b1af-0e74d7dd719d';

    await correlation.run(correlationId, async () => {
      await telemetry.withSpan(
        'realtime.command',
        { 'messaging.operation.name': 'game.resign' },
        async () => {
          await telemetry.withActiveChildSpan(
            'db.transaction',
            { 'db.system.name': 'postgresql' },
            () => Promise.resolve(),
          );
          telemetry.withActiveSpan(
            'realtime.broadcast',
            { 'messaging.operation.name': 'game.ended' },
            () => undefined,
          );
          telemetry
            .startChildSpan('redis.command', {
              'db.operation.name': 'evalsha',
            })
            ?.end();
        },
      );
    });
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'db.transaction',
        'realtime.broadcast',
        'realtime.command',
        'redis.command',
      ]),
    );
    const boundary = spans.find(({ name }) => name === 'realtime.command');
    expect(boundary?.attributes).toMatchObject({
      'cluchess.correlation_id': correlationId,
      'messaging.operation.name': 'game.resign',
    });
    for (const span of spans.filter(
      ({ name }) => name !== 'realtime.command',
    )) {
      expect(span.parentSpanContext?.spanId).toBe(
        boundary?.spanContext().spanId,
      );
    }
  });

  it('marks failures without exporting the arbitrary error message', async () => {
    exporter.reset();
    const telemetry = new TelemetryService(
      {
        values: { OTEL_ENABLED: true },
      } as AppConfigService,
      new CorrelationContextService(),
    );

    await expect(
      telemetry.withSpan('move.tx', {}, () =>
        Promise.reject(new TypeError('postgresql://user:secret@database')),
      ),
    ).rejects.toThrow(TypeError);
    await provider.forceFlush();

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(2);
    expect(JSON.stringify(span?.events)).not.toContain(
      'postgresql://user:secret@database',
    );
    expect(JSON.stringify(span?.events)).toContain('TypeError');
  });

  it('bypasses instrumentation when telemetry is disabled', async () => {
    exporter.reset();
    const telemetry = new TelemetryService(
      {
        values: { OTEL_ENABLED: false },
      } as AppConfigService,
      new CorrelationContextService(),
    );

    await expect(
      telemetry.withSpan('disabled', {}, () => Promise.resolve('result')),
    ).resolves.toBe('result');
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
