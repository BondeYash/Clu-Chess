import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error';
import { presentApiError } from './error-copy';

describe('API error presentation', () => {
  it.each([
    ['UNAUTHORIZED', 'Your guest session needs attention'],
    ['RATE_LIMITED', 'The board needs a brief pause'],
    ['SERVICE_UNAVAILABLE', 'CluChess is temporarily unavailable'],
    ['REQUEST_TIMEOUT', 'The service is responding slowly'],
  ])('maps %s to safe plain-language copy', (code, title) => {
    expect(
      presentApiError(
        new ApiError({
          code,
          correlationId: '11111111-1111-4111-8111-111111111111',
          message: 'Raw service detail',
          retryable: true,
          status: 503,
        }),
      ),
    ).toMatchObject({
      correlationId: '11111111-1111-4111-8111-111111111111',
      title,
    });
  });

  it('uses a non-disclosing fallback for unknown failures', () => {
    const copy = presentApiError(new Error('database hostname'));
    expect(copy.message).not.toContain('database');
    expect(copy.actionLabel).toBe('Try again');
  });
});
