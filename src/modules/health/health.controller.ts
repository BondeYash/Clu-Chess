import { Controller, ForbiddenException, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { ApplicationLifecycleService } from '../../common/lifecycle/application-lifecycle.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { PostgresHealthService } from '../persistence/postgres-health.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly lifecycle: ApplicationLifecycleService,
    private readonly metrics: MetricsService,
    private readonly postgres: PostgresHealthService,
    private readonly redis: RedisService,
  ) {}

  @Get('metrics')
  metricsEndpoint(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): string {
    if (this.config.isProduction && !this.isLoopback(request)) {
      throw new ForbiddenException();
    }
    response.type('text/plain; version=0.0.4; charset=utf-8');
    return this.metrics.render();
  }

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

  private isLoopback(request: Request): boolean {
    const address = request.ip ?? request.socket.remoteAddress ?? '';
    return (
      address === '127.0.0.1' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1'
    );
  }
}
