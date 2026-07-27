import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../src/common/config/app-config.service.js';
import { ApplicationLifecycleService } from '../../src/common/lifecycle/application-lifecycle.service.js';
import type { MetricsService } from '../../src/common/metrics/metrics.service.js';
import type { RedisService } from '../../src/common/redis/redis.service.js';
import { HealthController } from '../../src/modules/health/health.controller.js';
import type { PostgresHealthService } from '../../src/modules/persistence/postgres-health.service.js';

function responseStub(): {
  readonly response: Response;
  readonly status: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn();
  return {
    response: { status } as unknown as Response,
    status,
  };
}

function controller(
  lifecycle: ApplicationLifecycleService,
  postgres: PostgresHealthService,
  redis: RedisService,
): HealthController {
  return new HealthController(
    { isProduction: false } as AppConfigService,
    lifecycle,
    { render: vi.fn().mockReturnValue('') } as unknown as MetricsService,
    postgres,
    redis,
  );
}

describe('HealthController', () => {
  it('keeps liveness independent of lifecycle and dependencies', () => {
    const lifecycle = new ApplicationLifecycleService();
    const health = controller(
      lifecycle,
      {} as PostgresHealthService,
      {} as RedisService,
    );

    expect(health.liveness()).toEqual({ status: 'ok' });
  });

  it('is ready only when lifecycle and dependencies are healthy', async () => {
    const lifecycle = new ApplicationLifecycleService();
    lifecycle.onApplicationBootstrap();
    const postgres = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'up' }),
    } as unknown as PostgresHealthService;
    const redis = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'up' }),
    } as unknown as RedisService;
    const health = controller(lifecycle, postgres, redis);
    const { response, status } = responseStub();

    await expect(health.readiness(response)).resolves.toMatchObject({
      status: 'ok',
    });
    expect(status).toHaveBeenCalledWith(200);
  });

  it('fails readiness while a dependency is down or the app drains', async () => {
    const lifecycle = new ApplicationLifecycleService();
    lifecycle.onApplicationBootstrap();
    await lifecycle.beginDrain('test');
    const postgres = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'up' }),
    } as unknown as PostgresHealthService;
    const redis = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'down' }),
    } as unknown as RedisService;
    const health = controller(lifecycle, postgres, redis);
    const { response, status } = responseStub();

    await expect(health.readiness(response)).resolves.toMatchObject({
      state: 'draining',
      status: 'unavailable',
    });
    expect(status).toHaveBeenCalledWith(503);
  });
});
