import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/api-fetch', () => ({
  apiFetch: apiFetchMock,
}));

import { gameRecoveryApi } from './game-recovery-api';

describe('gameRecoveryApi', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({});
  });

  it('encodes the game path and keeps the bearer outside the query key', async () => {
    await gameRecoveryApi.getSnapshot(
      '11111111-1111-4111-8111-111111111111',
      'private-token',
    );

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/v1/games/11111111-1111-4111-8111-111111111111/snapshot',
      expect.objectContaining({ token: 'private-token' }),
    );
  });
});
