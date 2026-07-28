import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let telemetry: NodeSDK | undefined;

if (process.env.OTEL_ENABLED === 'true') {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318';
  const configuredRatio = Number(process.env.OTEL_TRACE_SAMPLE_RATIO ?? '1');
  const sampleRatio =
    Number.isFinite(configuredRatio) &&
    configuredRatio >= 0 &&
    configuredRatio <= 1
      ? configuredRatio
      : 1;
  telemetry = new NodeSDK({
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
    resource: resourceFromAttributes({
      'service.instance.id': process.env.INSTANCE_ID ?? 'local',
      [ATTR_SERVICE_NAME]: 'cluchess-backend',
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio),
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    }),
  });
  telemetry.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await telemetry?.shutdown();
}
