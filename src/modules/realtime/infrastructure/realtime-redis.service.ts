import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../../common/config/app-config.service.js';

@Injectable()
export class RealtimeRedisService implements OnApplicationShutdown {
  private readonly client: Redis;
  private readonly logger = new Logger(RealtimeRedisService.name);

  constructor(config: AppConfigService) {
    this.client = new Redis(config.values.REDIS_URL, {
      connectTimeout: 1500,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 1000),
    });
    this.client.on('error', () => {
      this.logger.warn('Realtime Redis connection error');
    });
  }

  get connection(): Redis {
    return this.client;
  }

  get isReady(): boolean {
    return this.client.status === 'ready';
  }

  async ensureConnected(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
    if (this.client.status !== 'ready') {
      throw new Error('Realtime Redis is unavailable');
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
