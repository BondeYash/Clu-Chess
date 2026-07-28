import { describe, expect, it } from 'vitest';

import {
  RealtimeError,
  fromProtocolError,
  isRealtimeError,
} from './realtime-error';

describe('RealtimeError', () => {
  it('preserves safe protocol metadata and identifies realtime failures', () => {
    const error = fromProtocolError(
      {
        authoritativeVersion: 12,
        code: 'STALE_GAME_VERSION',
        message: 'Refresh from the authoritative snapshot.',
        retryable: true,
      },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(error).toMatchObject({
      authoritativeVersion: 12,
      code: 'STALE_GAME_VERSION',
      correlationId: '11111111-1111-4111-8111-111111111111',
      name: 'RealtimeError',
      retryable: true,
    });
    expect(isRealtimeError(error)).toBe(true);
    expect(isRealtimeError(new Error('ordinary'))).toBe(false);
  });

  it('supports transport failures without optional protocol metadata', () => {
    const cause = new Error('network');
    const error = new RealtimeError({
      cause,
      code: 'TRANSPORT_OFFLINE',
      message: 'Live transport is offline.',
      retryable: true,
    });

    expect(error.cause).toBe(cause);
    expect(error.authoritativeVersion).toBeUndefined();
    expect(error.correlationId).toBeUndefined();
  });
});
