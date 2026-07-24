import { describe, expect, it } from 'vitest';
import {
  assertRuntimeKeyFiles,
  parseEnvironment,
} from '../../src/common/config/config.schema.js';

describe('application configuration', () => {
  it('applies safe local defaults and returns an immutable value', () => {
    const environment = parseEnvironment({});

    expect(environment.PORT).toBe(3000);
    expect(environment.TIME_INITIAL_MS).toBe(300_000);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('coerces supported environment values', () => {
    const environment = parseEnvironment({
      METRICS_ENABLED: 'false',
      PORT: '4000',
    });

    expect(environment.METRICS_ENABLED).toBe(false);
    expect(environment.PORT).toBe(4000);
  });

  it('rejects invalid production origins without echoing secrets', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://user:secret@db:5432/cluchess',
        NODE_ENV: 'production',
        ORIGIN_ALLOWLIST: 'http://insecure.example',
      }),
    ).toThrow('production origins must use HTTPS');

    try {
      parseEnvironment({
        DATABASE_URL: 'not-a-database-secret',
      });
    } catch (error) {
      expect(String(error)).not.toContain('not-a-database-secret');
    }
  });

  it('rejects unsafe timing relationships', () => {
    expect(() =>
      parseEnvironment({
        PRESENCE_TTL_MS: '1000',
        SOCKET_PING_INTERVAL_MS: '1000',
      }),
    ).toThrow('PRESENCE_TTL_MS');
    expect(() =>
      parseEnvironment({
        PRESENCE_TTL_MS: '50000',
        QUEUE_GUARD_TTL_MS: '50000',
      }),
    ).toThrow('QUEUE_GUARD_TTL_MS');
    expect(() =>
      parseEnvironment({
        DATABASE_TX_TIMEOUT_MS: '4000',
        DRAIN_TIMEOUT_MS: '4000',
      }),
    ).toThrow('DRAIN_TIMEOUT_MS');
  });

  it('requires both active signing-key files', () => {
    const environment = parseEnvironment(process.env);
    expect(() => {
      assertRuntimeKeyFiles(environment);
    }).not.toThrow();
    expect(() => {
      assertRuntimeKeyFiles({
        ...environment,
        JWT_PRIVATE_KEY_FILE: '/missing/private.pem',
      });
    }).toThrow('JWT private key file is unavailable');
  });
});
