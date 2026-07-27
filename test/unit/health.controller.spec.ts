import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
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

function lifecycle(): ApplicationLifecycleService {
  return new ApplicationLifecycleService(
    {
      values: { INSTANCE_ID: 'health-test' },
    } as unknown as AppConfigService,
    { setGauge: vi.fn() } as unknown as MetricsService,
  );
}

describe('HealthController', () => {
  it('keeps liveness independent of lifecycle and dependencies', () => {
    const applicationLifecycle = lifecycle();
    const health = controller(
      applicationLifecycle,
      {} as PostgresHealthService,
      {} as RedisService,
    );

    expect(health.liveness()).toEqual({ status: 'ok' });
  });

  it('requires the internal bearer token for non-loopback production metrics', () => {
    const metrics = {
      render: vi.fn().mockReturnValue('metric 1\n'),
    } as unknown as MetricsService;
    const health = new HealthController(
      {
        isProduction: true,
        metricsBearerToken: 'internal-metrics-token',
      } as AppConfigService,
      lifecycle(),
      metrics,
      {} as PostgresHealthService,
      {} as RedisService,
    );
    const response = { type: vi.fn() } as unknown as Response;
    const request = {
      headers: {},
      ip: '10.0.0.5',
      socket: {},
    } as Request;

    expect(() => health.metricsEndpoint(request, response)).toThrow(
      ForbiddenException,
    );
    expect(
      health.metricsEndpoint(
        {
          ...request,
          headers: { authorization: 'Bearer internal-metrics-token' },
        } as Request,
        response,
      ),
    ).toBe('metric 1\n');
  });

  it('is ready only when lifecycle and dependencies are healthy', async () => {
    const applicationLifecycle = lifecycle();
    applicationLifecycle.onApplicationBootstrap();
    const postgres = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'up' }),
    } as unknown as PostgresHealthService;
    const redis = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'up' }),
    } as unknown as RedisService;
    const health = controller(applicationLifecycle, postgres, redis);
    const { response, status } = responseStub();

    await expect(health.readiness(response)).resolves.toMatchObject({
      status: 'ok',
    });
    expect(status).toHaveBeenCalledWith(200);
  });

  it('fails readiness while a dependency is down or the app drains', async () => {
    const applicationLifecycle = lifecycle();
    applicationLifecycle.onApplicationBootstrap();
    await applicationLifecycle.beginDrain('test');
    const postgres = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'up' }),
    } as unknown as PostgresHealthService;
    const redis = {
      check: vi.fn().mockResolvedValue({ latencyMs: 1, status: 'down' }),
    } as unknown as RedisService;
    const health = controller(applicationLifecycle, postgres, redis);
    const { response, status } = responseStub();

    await expect(health.readiness(response)).resolves.toMatchObject({
      state: 'draining',
      status: 'unavailable',
    });
    expect(status).toHaveBeenCalledWith(503);
  });
});
