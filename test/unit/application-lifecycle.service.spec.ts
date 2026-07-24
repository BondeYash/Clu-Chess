import { describe, expect, it, vi } from 'vitest';
import { ApplicationLifecycleService } from '../../src/common/lifecycle/application-lifecycle.service.js';

describe('ApplicationLifecycleService', () => {
  it('moves from startup to ready', () => {
    const lifecycle = new ApplicationLifecycleService();

    expect(lifecycle.currentState).toBe('starting');
    lifecycle.onApplicationBootstrap();
    expect(lifecycle.isReady).toBe(true);
  });

  it('drains registered hooks only once', async () => {
    const lifecycle = new ApplicationLifecycleService();
    const hook = vi.fn().mockResolvedValue(undefined);
    lifecycle.registerDrainHook(hook);

    const firstDrain = lifecycle.beginDrain('SIGTERM');
    const secondDrain = lifecycle.beginDrain('SIGTERM');
    await Promise.all([firstDrain, secondDrain]);

    expect(lifecycle.currentState).toBe('draining');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('allows a drain hook to be unregistered', async () => {
    const lifecycle = new ApplicationLifecycleService();
    const hook = vi.fn().mockResolvedValue(undefined);
    const unregister = lifecycle.registerDrainHook(hook);
    unregister();

    await lifecycle.beginDrain('test');
    expect(hook).not.toHaveBeenCalled();
  });

  it('settles failed hooks so shutdown can continue', async () => {
    const lifecycle = new ApplicationLifecycleService();
    lifecycle.registerDrainHook(
      vi.fn().mockRejectedValue(new Error('expected hook failure')),
    );

    await expect(lifecycle.beginDrain('test')).resolves.toBeUndefined();
    expect(lifecycle.currentState).toBe('draining');
  });
});
