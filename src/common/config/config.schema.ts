import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const duration = (defaultValue: number, minimum = 1): z.ZodType<number> =>
  z.coerce.number().int().min(minimum).default(defaultValue);

const count = (defaultValue: number, minimum = 1): z.ZodType<number> =>
  z.coerce.number().int().min(minimum).default(defaultValue);

const booleanFromString = (defaultValue: boolean): z.ZodType<boolean> =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const urlWithProtocol = (protocols: readonly string[]): z.ZodType<string> =>
  z
    .url()
    .refine(
      (value) => protocols.some((protocol) => value.startsWith(protocol)),
      {
        message: `must use ${protocols.join(' or ')}`,
      },
    );

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: urlWithProtocol(['postgresql://', 'postgres://']).default(
      'postgresql://cluchess:cluchess_dev@localhost:5432/cluchess?schema=public',
    ),
    DATABASE_POOL_MAX: count(20),
    DATABASE_TX_TIMEOUT_MS: duration(3000),
    REDIS_URL: urlWithProtocol(['redis://', 'rediss://']).default(
      'redis://localhost:6379',
    ),
    JWT_PRIVATE_KEY_FILE: z
      .string()
      .min(1)
      .default('/run/secrets/cluchess/jwt-private.pem'),
    JWT_PUBLIC_KEYS_DIR: z
      .string()
      .min(1)
      .default('/run/secrets/cluchess/public'),
    JWT_KID: z.string().min(1).max(128).default('local-dev-1'),
    JWT_TTL_SECONDS: duration(43_200),
    JWT_CLOCK_SKEW_SECONDS: duration(30, 0),
    SESSION_COOKIE_ENABLED: booleanFromString(true),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('cluchess_guest'),
    SESSION_RETENTION_DAYS: count(30),
    ORIGIN_ALLOWLIST: z.string().min(1).default('http://localhost:5173'),
    TIME_INITIAL_MS: duration(300_000),
    TIME_INCREMENT_MS: duration(2000, 0),
    JOIN_DEADLINE_MS: duration(20_000),
    GRACE_MS: duration(30_000),
    RESERVATION_TTL_MS: duration(30_000),
    PRESENCE_TTL_MS: duration(45_000),
    QUEUE_GUARD_TTL_MS: duration(120_000),
    QUEUE_MAX_WAIT_MS: duration(120_000),
    MATCH_STATE_TTL_MS: duration(3_600_000),
    SNAPSHOT_CACHE_TTL_MS: duration(60_000),
    MAX_WS_BUFFER_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(8192)
      .default(8192),
    DRAIN_TIMEOUT_MS: duration(15_000),
    DRAIN_SOCKET_GRACE_MS: duration(500),
    SOCKET_PING_INTERVAL_MS: duration(25_000),
    SOCKET_PING_TIMEOUT_MS: duration(20_000),
    SOCKET_RECOVERY_MAX_DISCONNECTION_MS: duration(120_000),
    SOCKET_ADAPTER_STREAM_MAX_LEN: count(10_000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    OTEL_ENABLED: booleanFromString(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default('http://otel-collector:4318'),
    METRICS_ENABLED: booleanFromString(true),
    INSTANCE_ID: z.string().min(1).max(128).default('local'),
    RL_SESSION_CREATE_LIMIT: count(10),
    RL_SESSION_CREATE_WINDOW_MS: duration(60_000),
    RL_SESSION_RENEW_LIMIT: count(30),
    RL_SESSION_RENEW_WINDOW_MS: duration(60_000),
    RL_SESSION_RESET_LIMIT: count(10),
    RL_SESSION_RESET_WINDOW_MS: duration(60_000),
    RL_SESSION_GET_LIMIT: count(60),
    RL_SESSION_GET_WINDOW_MS: duration(60_000),
    RL_QUEUE_LIMIT: count(5),
    RL_QUEUE_WINDOW_MS: duration(10_000),
    RL_MOVE_LIMIT: count(10),
    RL_MOVE_WINDOW_MS: duration(1000),
    RL_SYNC_LIMIT: count(120),
    RL_SYNC_WINDOW_MS: duration(60_000),
    RL_CONNECTIONS_PER_IP: count(20),
    JOB_MATCH_DRAIN_MS: duration(250),
    JOB_QUEUE_SWEEP_MS: duration(5000),
    JOB_RESERVATION_RECONCILE_MS: duration(5000),
    JOB_DEADLINE_SWEEP_MS: duration(1000),
    JOB_ACTIVE_DRIFT_MS: duration(15_000),
    JOB_REVOCATION_REBUILD_MS: duration(300_000),
    JOB_SESSION_CLEANUP_MS: duration(3_600_000),
    JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .superRefine((environment, context) => {
    const origins = environment.ORIGIN_ALLOWLIST.split(',').map((origin) =>
      origin.trim(),
    );

    for (const origin of origins) {
      try {
        const parsed = new URL(origin);
        if (
          environment.NODE_ENV === 'production' &&
          parsed.protocol !== 'https:'
        ) {
          context.addIssue({
            code: 'custom',
            message: 'production origins must use HTTPS',
            path: ['ORIGIN_ALLOWLIST'],
          });
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'must contain only valid comma-separated origins',
          path: ['ORIGIN_ALLOWLIST'],
        });
      }
    }

    if (environment.PRESENCE_TTL_MS <= environment.SOCKET_PING_INTERVAL_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must exceed SOCKET_PING_INTERVAL_MS',
        path: ['PRESENCE_TTL_MS'],
      });
    }

    if (environment.QUEUE_GUARD_TTL_MS <= environment.PRESENCE_TTL_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must exceed PRESENCE_TTL_MS',
        path: ['QUEUE_GUARD_TTL_MS'],
      });
    }

    if (environment.MATCH_STATE_TTL_MS <= environment.RESERVATION_TTL_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must exceed RESERVATION_TTL_MS',
        path: ['MATCH_STATE_TTL_MS'],
      });
    }

    if (environment.DRAIN_TIMEOUT_MS <= environment.DATABASE_TX_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must exceed DATABASE_TX_TIMEOUT_MS',
        path: ['DRAIN_TIMEOUT_MS'],
      });
    }

    if (environment.DRAIN_SOCKET_GRACE_MS >= environment.DRAIN_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must be less than DRAIN_TIMEOUT_MS',
        path: ['DRAIN_SOCKET_GRACE_MS'],
      });
    }

    if (
      environment.DRAIN_TIMEOUT_MS <=
      environment.DATABASE_TX_TIMEOUT_MS +
        environment.DRAIN_SOCKET_GRACE_MS +
        100
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'must exceed DATABASE_TX_TIMEOUT_MS plus DRAIN_SOCKET_GRACE_MS and shutdown overhead',
        path: ['DRAIN_TIMEOUT_MS'],
      });
    }
  });

export type AppEnvironment = Readonly<z.output<typeof environmentSchema>>;

export function parseEnvironment(
  input: NodeJS.ProcessEnv,
): Readonly<AppEnvironment> {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      )
      .join('; ');
    throw new Error(`Invalid application configuration: ${details}`);
  }

  return Object.freeze(parsed.data);
}

export function assertRuntimeKeyFiles(environment: AppEnvironment): void {
  const publicKeyPath = join(
    environment.JWT_PUBLIC_KEYS_DIR,
    `${environment.JWT_KID}.pem`,
  );

  for (const [label, path] of [
    ['JWT private key', environment.JWT_PRIVATE_KEY_FILE],
    ['JWT public key', publicKeyPath],
  ] as const) {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw new Error('not a readable file');
      }
      accessSync(path, constants.R_OK);
    } catch {
      throw new Error(`${label} file is unavailable at configured path`);
    }
  }
}
