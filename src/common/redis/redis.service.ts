import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { SpanStatusCode, type Span } from '@opentelemetry/api';

export interface DependencyCheck {
  readonly status: 'up' | 'down';
  readonly latencyMs: number;
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(
    config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly telemetry: TelemetryService,
  ) {
    this.client = new Redis(config.values.REDIS_URL, {
      commandTimeout: 1500,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 1000),
    });
    this.instrumentCommands();
    this.client.on('error', (error: Error) => {
      this.logger.warn({ error: error.message }, 'Redis connection error');
    });
  }

  get connection(): Redis {
    return this.client;
  }

  async ensureConnected(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    if (this.client.status === 'ready') {
      return;
    }
    if (this.client.status === 'end') {
      throw new Error('Redis is unavailable');
    }
    await this.waitUntilReady();
  }

  async check(): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await this.ensureConnected();
      await this.client.ping();
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        status: 'up',
      };
    } catch {
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        status: 'down',
      };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'ready') {
      await this.client.quit();
      return;
    }

    this.client.disconnect();
  }

  private instrumentCommands(): void {
    const original = this.client.sendCommand.bind(this.client);
    const instrumented = ((
      ...arguments_: Parameters<Redis['sendCommand']>
    ): ReturnType<Redis['sendCommand']> => {
      const [command] = arguments_;
      const operation = /^[a-z0-9_]+$/i.test(command.name)
        ? command.name.toLowerCase()
        : 'other';
      const startedAt = performance.now();
      const span = this.telemetry.startChildSpan('redis.command', {
        'db.operation.name': operation,
        'db.system.name': 'redis',
      });
      try {
        const result = original(...arguments_);
        if (this.isPromiseLike(result)) {
          void result.then(
            () => {
              this.recordRedisCommand(operation, startedAt, false, span);
            },
            () => {
              this.recordRedisCommand(operation, startedAt, true, span);
            },
          );
          return result;
        }
        this.recordRedisCommand(operation, startedAt, false, span);
        return result;
      } catch (error) {
        this.recordRedisCommand(operation, startedAt, true, span);
        throw error;
      }
    }) as Redis['sendCommand'];
    this.client.sendCommand = instrumented;
  }

  private isPromiseLike(value: unknown): value is Promise<unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'then' in value &&
      typeof value.then === 'function'
    );
  }

  private async waitUntilReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timeout);
        this.client.off('ready', onReady);
        this.client.off('end', onEnd);
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const onReady = (): void => {
        finish();
      };
      const onEnd = (): void => {
        finish(new Error('Redis is unavailable'));
      };
      const timeout = setTimeout(() => {
        finish(new Error('Redis connection readiness timed out'));
      }, 2000);
      timeout.unref();
      this.client.once('ready', onReady);
      this.client.once('end', onEnd);

      if (this.client.status === 'ready') {
        finish();
      } else if (this.client.status === 'end') {
        finish(new Error('Redis is unavailable'));
      }
    });
  }

  private recordRedisCommand(
    operation: string,
    startedAt: number,
    failed: boolean,
    span: Span | undefined,
  ): void {
    span?.setStatus({
      code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    span?.end();
    this.metrics.observe(
      'cluchess_redis_latency_seconds',
      'Redis command latency by bounded command name.',
      (performance.now() - startedAt) / 1000,
      { op: operation },
    );
    if (failed) {
      this.metrics.increment(
        'cluchess_redis_errors_total',
        'Redis operation errors by operation.',
        { op: operation },
      );
    }
  }
}
