import type {
  ActiveGameResponse,
  CreateSessionResponse,
  GetSessionResponse,
  RenewSessionResponse,
  ResetSessionResponse,
} from '@cluchess/protocol-v1/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { createQueryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';

import type { SessionApiClient } from './session-api';
import { SessionCoordinator } from './session-coordinator';
import {
  createSessionStorageAdapter,
  type SessionStoragePort,
} from './session-storage';

const now = Date.parse('2026-07-28T08:00:00.000Z');
const guestId = '11111111-1111-4111-8111-111111111111';
const activeGameId = '22222222-2222-4222-8222-222222222222';
const correlationId = '33333333-3333-4333-8333-333333333333';
const farExpiry = '2026-07-28T20:00:00.000Z';
const nearExpiry = '2026-07-28T08:04:00.000Z';

describe('SessionCoordinator', () => {
  let storage: SessionStoragePort;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    storage = createSessionStorageAdapter({
      createId: () => '44444444-4444-4444-8444-444444444444',
    });
  });

  it('creates exactly one guest on first visit and strips its token from results', async () => {
    const api = createApi({
      getCurrent: vi.fn().mockRejectedValue(unauthorized()),
    });
    const coordinator = createCoordinator(api, storage);

    const result = await coordinator.bootstrap({ allowCreate: true });

    expect(api.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      activeGameId: null,
      guest: { id: guestId, name: 'SilentKnight482' },
      status: 'ready',
    });
    expect(JSON.stringify(result)).not.toContain('private-jwt');
    expect(storage.getToken()).toBe('private-jwt');
    expect(window.localStorage.length).toBe(0);

    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.session.bootstrap(true), result);
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      'private-jwt',
    );
  });

  it('escalates an in-flight public recovery when navigation requires a guest', async () => {
    const api = createApi({
      getCurrent: vi.fn().mockRejectedValue(unauthorized()),
    });
    const coordinator = createCoordinator(api, storage);

    const publicRecovery = coordinator.bootstrap({ allowCreate: false });
    const protectedRecovery = coordinator.bootstrap({ allowCreate: true });

    await expect(publicRecovery).resolves.toEqual({ status: 'anonymous' });
    await expect(protectedRecovery).resolves.toMatchObject({
      guest: { id: guestId },
      status: 'ready',
    });
    expect(api.create).toHaveBeenCalledOnce();
  });

  it('recovers a cookie session and renews only to obtain a tab token', async () => {
    const api = createApi();
    const coordinator = createCoordinator(api, storage);

    const result = await coordinator.bootstrap({ allowCreate: true });

    expect(result.status).toBe('ready');
    expect(api.getCurrent).toHaveBeenCalledWith(undefined);
    expect(api.renew).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      undefined,
    );
    expect(api.create).not.toHaveBeenCalled();
  });

  it('clears a rejected bearer before trying cookie recovery once', async () => {
    storage.setToken('expired-token');
    const getCurrent = vi
      .fn<SessionApiClient['getCurrent']>()
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce(currentSession());
    const api = createApi({ getCurrent });
    const coordinator = createCoordinator(api, storage);

    await coordinator.bootstrap({ allowCreate: true });

    expect(getCurrent.mock.calls).toEqual([['expired-token'], []]);
    expect(api.create).not.toHaveBeenCalled();
    expect(storage.getToken()).toBe('renewed-jwt');
  });

  it('renews a near-expiry token and schedules five minutes before expiry', async () => {
    storage.setToken('current-token');
    const api = createApi({
      getCurrent: vi
        .fn()
        .mockResolvedValue(currentSession({ expiresAt: nearExpiry })),
    });
    const coordinator = createCoordinator(api, storage);

    const result = await coordinator.bootstrap({ allowCreate: true });

    expect(api.renew).toHaveBeenCalledOnce();
    expect(coordinator.renewalDelay(result)).toBe(
      Date.parse(farExpiry) - now - 5 * 60 * 1_000,
    );
  });

  it('reuses one key after a lost response and across bounded 503 retries', async () => {
    const keys: string[] = [];
    const create = vi
      .fn<SessionApiClient['create']>()
      .mockImplementation(async (key) => {
        keys.push(key);
        if (keys.length < 3) throw retryable('SERVICE_UNAVAILABLE', 503);
        return createdSession();
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const api = createApi({
      create,
      getCurrent: vi.fn().mockRejectedValue(unauthorized()),
    });
    const coordinator = new SessionCoordinator({
      api,
      now: () => now,
      sleep,
      storage,
    });

    await coordinator.bootstrap({ allowCreate: true });

    expect(keys).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('honors 429 retry timing without changing the operation key', async () => {
    const create = vi
      .fn<SessionApiClient['create']>()
      .mockRejectedValueOnce(retryable('RATE_LIMITED', 429, 1_750))
      .mockResolvedValueOnce(createdSession());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionCoordinator({
      api: createApi({
        create,
        getCurrent: vi.fn().mockRejectedValue(unauthorized()),
      }),
      now: () => now,
      sleep,
      storage,
    });

    await coordinator.bootstrap({ allowCreate: true });

    expect(sleep).toHaveBeenCalledWith(1_750);
    expect(create.mock.calls[0]?.[0]).toBe(create.mock.calls[1]?.[0]);
  });

  it('never creates a replacement while an active identity may exist', async () => {
    storage.setToken('expired-token');
    storage.setActiveGameHint(activeGameId);
    const api = createApi({
      getCurrent: vi.fn().mockRejectedValue(unauthorized()),
    });
    const coordinator = createCoordinator(api, storage);

    await expect(coordinator.bootstrap({ allowCreate: true })).resolves.toEqual(
      {
        activeGameId,
        status: 'identity-lost',
      },
    );
    expect(api.create).not.toHaveBeenCalled();
  });

  it('resets idempotently, clears old state, and creates a new guest', async () => {
    storage.setToken('old-token');
    storage.setActiveGameHint(activeGameId);
    const api = createApi({
      getCurrent: vi.fn().mockRejectedValue(unauthorized()),
    });
    const coordinator = createCoordinator(api, storage);

    const result = await coordinator.resetAndCreate();

    expect(api.reset).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444',
      'old-token',
    );
    expect(api.create).toHaveBeenCalledOnce();
    expect(result.status).toBe('ready');
    expect(storage.getActiveGameHint()).toBeNull();
    expect(storage.getToken()).toBe('private-jwt');
  });

  it('keeps the reset key and token after exhausted retryable failures', async () => {
    storage.setToken('old-token');
    const reset = vi
      .fn<SessionApiClient['reset']>()
      .mockRejectedValue(retryable('SERVICE_UNAVAILABLE', 503));
    const coordinator = createCoordinator(createApi({ reset }), storage);

    await expect(coordinator.resetAndCreate()).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });

    expect(reset).toHaveBeenCalledTimes(3);
    expect(new Set(reset.mock.calls.map(([key]) => key)).size).toBe(1);
    expect(storage.getToken()).toBe('old-token');
  });
});

function createCoordinator(
  api: SessionApiClient,
  value: SessionStoragePort,
): SessionCoordinator {
  return new SessionCoordinator({
    api,
    now: () => now,
    sleep: vi.fn().mockResolvedValue(undefined),
    storage: value,
  });
}

function createApi(
  overrides: Partial<SessionApiClient> = {},
): SessionApiClient {
  return {
    create: vi.fn().mockResolvedValue(createdSession()),
    getActive: vi.fn().mockResolvedValue(activeGame(null)),
    getCurrent: vi.fn().mockResolvedValue(currentSession()),
    renew: vi.fn().mockResolvedValue(renewedSession()),
    reset: vi.fn().mockResolvedValue(resetSession()),
    ...overrides,
  };
}

function createdSession(): CreateSessionResponse {
  return {
    correlationId,
    guest: {
      avatar: 'knight_amber_01',
      expiresAt: farExpiry,
      id: guestId,
      name: 'SilentKnight482',
    },
    token: 'private-jwt',
  };
}

function currentSession(
  guestOverrides: Partial<GetSessionResponse['guest']> = {},
): GetSessionResponse {
  return {
    correlationId,
    guest: {
      avatar: 'knight_amber_01',
      expiresAt: farExpiry,
      id: guestId,
      issuedAt: '2026-07-28T07:00:00.000Z',
      name: 'SilentKnight482',
      ...guestOverrides,
    },
  };
}

function renewedSession(): RenewSessionResponse {
  return {
    correlationId,
    expiresAt: farExpiry,
    token: 'renewed-jwt',
  };
}

function resetSession(): ResetSessionResponse {
  return { correlationId, ok: true };
}

function activeGame(gameId: string | null): ActiveGameResponse {
  return { correlationId, gameId };
}

function unauthorized(): ApiError {
  return new ApiError({
    code: 'UNAUTHORIZED',
    correlationId,
    message: 'Unauthorized',
    retryable: false,
    status: 401,
  });
}

function retryable(
  code: 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE',
  status: number,
  retryAfterMs?: number,
): ApiError {
  return new ApiError({
    code,
    correlationId,
    message: code,
    retryable: true,
    retryAfterMs,
    status,
  });
}
