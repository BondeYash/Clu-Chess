import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertRuntimeKeyFiles,
  parseEnvironment,
} from '../../src/common/config/config.schema.js';

describe('application configuration', () => {
  it('applies safe local defaults and returns an immutable value', () => {
    const environment = parseEnvironment({});

    expect(environment.PORT).toBe(3000);
    expect(environment.SESSION_COOKIE_ENABLED).toBe(true);
    expect(environment.SESSION_COOKIE_NAME).toBe('cluchess_guest');
    expect(environment.SESSION_RETENTION_DAYS).toBe(30);
    expect(environment.TRUST_PROXY_HOPS).toBe(0);
    expect(environment.RL_SESSION_GET_LIMIT).toBe(60);
    expect(environment.TIME_INITIAL_MS).toBe(300_000);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('coerces supported environment values', () => {
    const environment = parseEnvironment({
      METRICS_ENABLED: 'false',
      PORT: '4000',
      SESSION_COOKIE_ENABLED: 'false',
    });

    expect(environment.METRICS_ENABLED).toBe(false);
    expect(environment.PORT).toBe(4000);
    expect(environment.SESSION_COOKIE_ENABLED).toBe(false);
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

  it('requires authenticated TLS datastore URLs in production', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://runtime:secret@db.internal:5432/cluchess',
        NODE_ENV: 'production',
        ORIGIN_ALLOWLIST: 'https://chess.example',
        REDIS_URL: 'redis://redis.internal:6379',
      }),
    ).toThrow('production PostgreSQL');

    expect(() =>
      parseEnvironment({
        DATABASE_URL:
          'postgresql://runtime:secret@db.internal:5432/cluchess?sslmode=verify-full',
        NODE_ENV: 'production',
        ORIGIN_ALLOWLIST: 'https://chess.example',
        REDIS_URL: 'rediss://default:secret@redis.internal:6379',
      }),
    ).not.toThrow();
  });

  it('confines the insecure production exception to local Docker hosts', () => {
    const localDockerEnvironment = {
      ALLOW_INSECURE_LOCAL_PRODUCTION: 'true',
      DATABASE_URL: 'postgresql://runtime:local-only@postgres:5432/cluchess',
      NODE_ENV: 'production',
      ORIGIN_ALLOWLIST: 'https://localhost:3443',
      REDIS_URL: 'redis://redis:6379',
    };

    expect(() => parseEnvironment(localDockerEnvironment)).not.toThrow();
    expect(() =>
      parseEnvironment({
        ...localDockerEnvironment,
        DATABASE_URL:
          'postgresql://runtime:local-only@db.internal:5432/cluchess',
      }),
    ).toThrow('isolated local Docker topology');
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
        MATCH_STATE_TTL_MS: '30000',
        RESERVATION_TTL_MS: '30000',
      }),
    ).toThrow('MATCH_STATE_TTL_MS');
    expect(() =>
      parseEnvironment({
        DATABASE_TX_TIMEOUT_MS: '4000',
        DRAIN_TIMEOUT_MS: '4000',
      }),
    ).toThrow('DRAIN_TIMEOUT_MS');
    expect(() =>
      parseEnvironment({
        DRAIN_SOCKET_GRACE_MS: '4000',
        DRAIN_TIMEOUT_MS: '4000',
      }),
    ).toThrow('DRAIN_SOCKET_GRACE_MS');
    expect(() =>
      parseEnvironment({
        DATABASE_TX_TIMEOUT_MS: '3000',
        DRAIN_SOCKET_GRACE_MS: '1000',
        DRAIN_TIMEOUT_MS: '4000',
      }),
    ).toThrow('shutdown overhead');
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

  it('requires a non-empty production metrics scrape token', () => {
    const tokenPath = join(
      tmpdir(),
      `cluchess-test-metrics-token-${String(process.pid)}`,
    );
    const environment = parseEnvironment({
      ...process.env,
      ALLOW_INSECURE_LOCAL_PRODUCTION: 'true',
      DATABASE_URL: 'postgresql://runtime:local-only@postgres:5432/cluchess',
      METRICS_BEARER_TOKEN_FILE: tokenPath,
      NODE_ENV: 'production',
      ORIGIN_ALLOWLIST: 'https://localhost:3443',
      REDIS_URL: 'redis://redis:6379',
    });

    try {
      writeFileSync(tokenPath, 'short');
      expect(() => {
        assertRuntimeKeyFiles(environment);
      }).toThrow('Metrics bearer token file is unavailable');

      writeFileSync(tokenPath, 'a'.repeat(32));
      expect(() => {
        assertRuntimeKeyFiles(environment);
      }).not.toThrow();
    } finally {
      unlinkSync(tokenPath);
    }
  });
});
