import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service.js';

export interface DependencyCheck {
  readonly status: 'up' | 'down';
  readonly latencyMs: number;
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: AppConfigService) {
    this.client = new Redis(config.values.REDIS_URL, {
      commandTimeout: 1500,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 1000),
    });
    this.client.on('error', (error: Error) => {
      this.logger.warn({ error: error.message }, 'Redis connection error');
    });
  }

  get connection(): Redis {
    return this.client;
  }

  async check(): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
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
}
