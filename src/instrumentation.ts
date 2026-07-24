import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let telemetry: NodeSDK | undefined;

if (process.env.OTEL_ENABLED === 'true') {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318';
  telemetry = new NodeSDK({
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'cluchess-backend',
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
