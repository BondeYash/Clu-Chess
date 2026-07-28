import { beforeEach, describe, expect, it } from 'vitest';

import { createSessionStorageAdapter } from './session-storage';

describe('session storage adapter', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps tokens per-tab and never writes localStorage', () => {
    const storage = createSessionStorageAdapter();
    storage.setToken('private-jwt');

    expect(storage.getToken()).toBe('private-jwt');
    expect(window.sessionStorage.getItem('cluchess:v1:socket-token')).toBe(
      'private-jwt',
    );
    expect(window.localStorage.length).toBe(0);
  });

  it('reuses pending operation keys until a final outcome', () => {
    let sequence = 0;
    const storage = createSessionStorageAdapter({
      createId: () => `key-${++sequence}`,
    });

    expect(storage.getOrCreateOperationKey('create')).toBe('key-1');
    expect(storage.getOrCreateOperationKey('create')).toBe('key-1');
    storage.clearOperation('create');
    expect(storage.getOrCreateOperationKey('create')).toBe('key-2');
  });

  it('preserves stable memory state when browser storage is unavailable', () => {
    const storage = createSessionStorageAdapter({
      createId: () => 'memory-key',
      storage: undefined,
    });
    storage.setToken('memory-token');

    expect(storage.getToken()).toBe('memory-token');
    expect(storage.getOrCreateOperationKey('renew')).toBe('memory-key');
    expect(storage.getOrCreateOperationKey('renew')).toBe('memory-key');
  });

  it('clears only CluChess guest state after reset', () => {
    window.sessionStorage.setItem('another-feature', 'keep');
    const storage = createSessionStorageAdapter({
      createId: () => 'pending-key',
    });
    storage.setToken('token');
    storage.setActiveGameHint('11111111-1111-4111-8111-111111111111');
    storage.getOrCreateOperationKey('reset');

    storage.clearAll();

    expect(storage.getToken()).toBeNull();
    expect(storage.getActiveGameHint()).toBeNull();
    expect(window.sessionStorage.getItem('another-feature')).toBe('keep');
  });
});
