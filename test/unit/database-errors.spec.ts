import { describe, expect, it } from 'vitest';
import {
  DatabaseError,
  toDatabaseError,
} from '../../src/modules/persistence/database-errors.js';

describe('database error classification', () => {
  it.each([
    ['23505', 'unique', false],
    ['23514', 'constraint', false],
    ['40001', 'retryable', true],
    ['40P01', 'retryable', true],
    ['08006', 'unavailable', true],
  ] as const)(
    'maps %s to a stable %s failure',
    (code, expectedKind, expectedRetryable) => {
      const original = Object.assign(new Error('sensitive SQL detail'), {
        code,
      });
      const mapped = toDatabaseError(original);

      expect(mapped).toBeInstanceOf(DatabaseError);
      expect(mapped.kind).toBe(expectedKind);
      expect(mapped.retryable).toBe(expectedRetryable);
      expect(mapped.message).not.toContain('sensitive');
      expect(mapped.cause).toBe(original);
    },
  );

  it('reads nested driver codes and preserves an existing stable error', () => {
    const nested = toDatabaseError({
      cause: Object.assign(new Error('driver detail'), { code: '55P03' }),
    });
    expect(nested).toMatchObject({ kind: 'retryable', retryable: true });

    const stable = new DatabaseError('constraint', false);
    expect(toDatabaseError(stable)).toBe(stable);
  });

  it('uses a non-retryable unknown category for unrecognized failures', () => {
    expect(toDatabaseError(new Error('unexpected'))).toMatchObject({
      kind: 'unknown',
      retryable: false,
    });
  });
});
