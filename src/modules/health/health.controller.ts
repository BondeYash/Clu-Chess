import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationLifecycleService } from '../../common/lifecycle/application-lifecycle.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { PostgresHealthService } from '../persistence/postgres-health.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly lifecycle: ApplicationLifecycleService,
    private readonly postgres: PostgresHealthService,
    private readonly redis: RedisService,
  ) {}

  @Get('healthz')
  liveness(): Readonly<{ status: 'ok' }> {
    return Object.freeze({ status: 'ok' });
  }

  @Get('readyz')
  async readiness(@Res({ passthrough: true }) response: Response): Promise<
    Readonly<{
      status: 'ok' | 'unavailable';
      state: string;
      deps: {
        db: Awaited<ReturnType<PostgresHealthService['check']>>;
        redis: Awaited<ReturnType<RedisService['check']>>;
      };
    }>
  > {
    const [db, redis] = await Promise.all([
      this.postgres.check(),
      this.redis.check(),
    ]);
    const isReady =
      this.lifecycle.isReady && db.status === 'up' && redis.status === 'up';

    response.status(isReady ? 200 : 503);
    return {
      deps: { db, redis },
      state: this.lifecycle.currentState,
      status: isReady ? 'ok' : 'unavailable',
    };
  }
}
