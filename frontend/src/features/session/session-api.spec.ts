import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/api-fetch', () => ({
  apiFetch: apiFetchMock,
}));

import { sessionApi } from './session-api';

describe('sessionApi', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({ correlationId: 'test' });
  });

  it('wires create and reset mutations with idempotency and bearer metadata', async () => {
    await sessionApi.create('create-key');
    await sessionApi.reset('reset-key', 'private-token');

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/v1/session',
      expect.objectContaining({
        body: {},
        idempotencyKey: 'create-key',
        method: 'POST',
      }),
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/v1/session/reset',
      expect.objectContaining({
        body: {},
        idempotencyKey: 'reset-key',
        method: 'POST',
        token: 'private-token',
      }),
    );
  });

  it('supports cookie-only and bearer session reads', async () => {
    await sessionApi.getCurrent();
    await sessionApi.getCurrent('private-token');
    await sessionApi.getActive('private-token');

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/v1/session',
      expect.not.objectContaining({ token: expect.anything() }),
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/v1/session',
      expect.objectContaining({ token: 'private-token' }),
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      3,
      '/v1/games/active',
      expect.objectContaining({ token: 'private-token' }),
    );
  });

  it('renews through either cookie or bearer authentication', async () => {
    await sessionApi.renew('renew-cookie');
    await sessionApi.renew('renew-bearer', 'private-token');

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/v1/session/renew',
      expect.objectContaining({
        idempotencyKey: 'renew-cookie',
        method: 'POST',
      }),
    );
    expect(apiFetchMock.mock.calls[0]?.[1]).not.toHaveProperty('token');
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/v1/session/renew',
      expect.objectContaining({
        idempotencyKey: 'renew-bearer',
        token: 'private-token',
      }),
    );
  });
});
