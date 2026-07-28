import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LOG_REDACTION_PATHS } from '../../src/common/logging/logging.module.js';
import { SafeLogContextService } from '../../src/common/logging/safe-log-context.service.js';

describe('structured log privacy', () => {
  it('redacts authentication, cookie, key, and datastore secrets', () => {
    let output = '';
    const logger = pino(
      {
        redact: {
          censor: '[REDACTED]',
          paths: [...LOG_REDACTION_PATHS],
        },
      },
      {
        write: (chunk: string) => {
          output += chunk;
        },
      },
    );

    logger.info({
      authorization: 'Bearer secret-jwt',
      databaseUrl: 'postgresql://user:database-secret@db/cluchess',
      privateKey: 'private-key-secret',
      redisUrl: 'rediss://default:redis-secret@redis',
      request: { token: 'nested-token-secret' },
      token: 'token-secret',
    });

    expect(output).toContain('[REDACTED]');
    expect(output).not.toMatch(
      /secret-jwt|database-secret|private-key-secret|redis-secret|nested-token-secret|token-secret/,
    );
  });

  it('uses stable irreversible guest references', () => {
    const safeLogs = new SafeLogContextService();
    const guestId = 'b99a5064-3a5b-40c6-a226-079d1a422c60';
    const reference = safeLogs.guestReference(guestId);

    expect(reference).toMatch(/^[a-f0-9]{16}$/);
    expect(reference).toBe(safeLogs.guestReference(guestId));
    expect(reference).not.toContain(guestId);
  });
});
