import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfigService } from '../../common/config/app-config.service.js';
import type { DependencyCheck } from '../../common/redis/redis.service.js';

@Injectable()
export class PostgresHealthService implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(config: AppConfigService) {
    this.pool = new Pool({
      connectionString: config.values.DATABASE_URL,
      connectionTimeoutMillis: 1500,
      max: config.values.DATABASE_POOL_MAX,
      options: `-c timezone=UTC -c statement_timeout=${String(
        config.values.DATABASE_TX_TIMEOUT_MS,
      )}`,
    });
  }

  async check(): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await this.pool.query('SELECT 1');
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
    await this.pool.end();
  }
}
