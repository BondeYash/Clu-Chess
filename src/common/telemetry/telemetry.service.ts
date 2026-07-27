import { Injectable } from '@nestjs/common';
import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { AppConfigService } from '../config/app-config.service.js';
import { CorrelationContextService } from '../logging/correlation-context.service.js';

@Injectable()
export class TelemetryService {
  private readonly enabled: boolean;
  private readonly tracer = trace.getTracer('cluchess-backend');

  constructor(
    config: AppConfigService,
    private readonly correlation: CorrelationContextService,
  ) {
    this.enabled = config.values.OTEL_ENABLED;
  }

  async withSpan<Result>(
    name: string,
    attributes: Attributes,
    work: (span: Span | undefined) => Promise<Result>,
  ): Promise<Result> {
    if (!this.enabled) {
      return work(undefined);
    }

    return this.tracer.startActiveSpan(
      name,
      {
        attributes: {
          ...attributes,
          ...(this.correlation.correlationId === undefined
            ? {}
            : { 'cluchess.correlation_id': this.correlation.correlationId }),
        },
      },
      async (span) => {
        try {
          const result = await work(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.name : 'UnknownError',
          });
          if (error instanceof Error) {
            span.recordException({
              message: error.name,
              name: error.name,
            });
          }
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  async withActiveChildSpan<Result>(
    name: string,
    attributes: Attributes,
    work: () => Promise<Result>,
  ): Promise<Result> {
    if (!this.enabled || trace.getSpan(context.active()) === undefined) {
      return work();
    }
    return this.withSpan(name, attributes, async () => work());
  }

  withActiveSpan<Result>(
    name: string,
    attributes: Attributes,
    work: () => Result,
  ): Result {
    if (!this.enabled || trace.getSpan(context.active()) === undefined) {
      return work();
    }
    return this.tracer.startActiveSpan(name, { attributes }, (span) => {
      try {
        const result = work();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  startChildSpan(name: string, attributes: Attributes): Span | undefined {
    if (!this.enabled || trace.getSpan(context.active()) === undefined) {
      return undefined;
    }
    return this.tracer.startSpan(name, { attributes }, context.active());
  }
}
