import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../src/common/config/app-config.service.js';
import { ApplicationLifecycleService } from '../../src/common/lifecycle/application-lifecycle.service.js';
import type { MetricsService } from '../../src/common/metrics/metrics.service.js';

function createLifecycle(): {
  lifecycle: ApplicationLifecycleService;
  setGauge: ReturnType<typeof vi.fn>;
} {
  const setGauge = vi.fn();
  return {
    lifecycle: new ApplicationLifecycleService(
      {
        values: { INSTANCE_ID: 'unit-a' },
      } as unknown as AppConfigService,
      { setGauge } as unknown as MetricsService,
    ),
    setGauge,
  };
}

describe('ApplicationLifecycleService', () => {
  it('moves from startup to ready', () => {
    const { lifecycle } = createLifecycle();

    expect(lifecycle.currentState).toBe('starting');
    lifecycle.onApplicationBootstrap();
    expect(lifecycle.isReady).toBe(true);
  });

  it('drains registered hooks only once', async () => {
    const { lifecycle } = createLifecycle();
    const hook = vi.fn().mockResolvedValue(undefined);
    lifecycle.registerDrainHook(hook);

    const firstDrain = lifecycle.beginDrain('SIGTERM');
    const secondDrain = lifecycle.beginDrain('SIGTERM');
    await Promise.all([firstDrain, secondDrain]);

    expect(lifecycle.currentState).toBe('draining');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('allows a drain hook to be unregistered', async () => {
    const { lifecycle } = createLifecycle();
    const hook = vi.fn().mockResolvedValue(undefined);
    const unregister = lifecycle.registerDrainHook(hook);
    unregister();

    await lifecycle.beginDrain('test');
    expect(hook).not.toHaveBeenCalled();
  });

  it('settles failed hooks so shutdown can continue', async () => {
    const { lifecycle } = createLifecycle();
    lifecycle.registerDrainHook(
      vi.fn().mockRejectedValue(new Error('expected hook failure')),
    );

    await expect(lifecycle.beginDrain('test')).resolves.toBeUndefined();
    expect(lifecycle.currentState).toBe('draining');
  });

  it('tracks work by boundary and resolves idle waiters', async () => {
    const { lifecycle, setGauge } = createLifecycle();
    const finishHttp = lifecycle.trackWork('http');
    const finishRealtime = lifecycle.trackWork('realtime');

    expect(lifecycle.inFlightWork).toBe(2);
    const idle = lifecycle.waitForIdle(1000);
    finishHttp();
    finishHttp();
    expect(lifecycle.inFlightWork).toBe(1);
    finishRealtime();

    await expect(idle).resolves.toBe(true);
    expect(lifecycle.inFlightWork).toBe(0);
    expect(setGauge).toHaveBeenCalledWith(
      'cluchess_in_flight_work',
      expect.any(String),
      0,
      { instance: 'unit-a', kind: 'realtime' },
    );
  });
});
