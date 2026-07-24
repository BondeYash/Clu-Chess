import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationLifecycleService } from '../../src/common/lifecycle/application-lifecycle.service.js';
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

describe('HealthController', () => {
  it('keeps liveness independent of lifecycle and dependencies', () => {
    const lifecycle = new ApplicationLifecycleService();
    const controller = new HealthController(
      lifecycle,
      {} as PostgresHealthService,
      {} as RedisService,
    );

    expect(controller.liveness()).toEqual({ status: 'ok' });
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
    const controller = new HealthController(lifecycle, postgres, redis);
    const { response, status } = responseStub();

    await expect(controller.readiness(response)).resolves.toMatchObject({
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
    const controller = new HealthController(lifecycle, postgres, redis);
    const { response, status } = responseStub();

    await expect(controller.readiness(response)).resolves.toMatchObject({
      state: 'draining',
      status: 'unavailable',
    });
    expect(status).toHaveBeenCalledWith(503);
  });
});
