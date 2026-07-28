import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import type { Response as SuperAgentResponse } from 'superagent';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { RedisService } from '../../src/common/redis/redis.service.js';
import type { IssuedSessionClaims } from '../../src/modules/session/application/ports/guest-session.repository.js';
import { SessionRepositoryError } from '../../src/modules/session/application/session-repository.errors.js';
import { PrismaGuestSessionRepository } from '../../src/modules/session/infrastructure/prisma-guest-session.repository.js';
import { SessionMaintenanceService } from '../../src/modules/session/session-maintenance.service.js';
import {
  createSessionResponseSchema,
  getSessionResponseSchema,
  renewSessionResponseSchema,
  resetSessionResponseSchema,
} from '../../src/modules/session/session.schemas.js';
import {
  allocateGame,
  createGuestSession,
  createPool,
  truncateApplicationTables,
} from './support/database.js';
import { signalContainer } from './support/docker-engine.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorResponseSchema = z.object({
  correlationId: z.uuid(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfterMs: z.number().optional(),
    retryable: z.boolean(),
  }),
});

describe('anonymous session REST lifecycle', () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: RedisService;
  let server: Server;

  beforeAll(async () => {
    pool = createPool();
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('v1', {
      exclude: [
        { method: RequestMethod.ALL, path: 'healthz' },
        { method: RequestMethod.ALL, path: 'readyz' },
      ],
    });
    await app.init();
    redis = app.get(RedisService);
    await redis.ensureConnected();
    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    await truncateApplicationTables(pool);
    await redis.connection.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creates and durably replays one identity with the approved cookie', async () => {
    const idempotencyKey = randomUUID();
    const correlationId = randomUUID();
    const first = await createSession(idempotencyKey, correlationId, 201);
    const replay = await createSession(idempotencyKey, correlationId, 200);
    const firstBody = createSessionResponseSchema.parse(responseBody(first));
    const replayBody = createSessionResponseSchema.parse(responseBody(replay));

    expect(firstBody).toEqual(replayBody);
    expect(firstBody.correlationId).toBe(correlationId);
    expect(firstBody.guest.avatar.length).toBeGreaterThan(0);
    expect(firstBody.guest.expiresAt).toMatch(/Z$/);
    expect(firstBody.guest.id).toMatch(UUID_V4);
    expect(firstBody.guest.name).toMatch(
      /^[A-Z][a-z]+[A-Z][a-z]+(?:\d{2,4}|[a-f0-9]{12})$/,
    );
    expect(firstBody.token.length).toBeGreaterThan(0);
    expect(Object.keys(firstBody.guest).sort()).toEqual(
      ['avatar', 'expiresAt', 'id', 'name'].sort(),
    );
    const cookie = first.headers['set-cookie']?.[0];
    expect(cookie).toContain('cluchess_guest=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM guest_sessions',
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('survives concurrent and Redis-cold idempotent retries', async () => {
    const idempotencyKey = randomUUID();
    const [one, two] = await Promise.all([
      createSession(idempotencyKey, randomUUID(), undefined),
      createSession(idempotencyKey, randomUUID(), undefined),
    ]);
    const oneBody = createSessionResponseSchema.parse(responseBody(one));
    const twoBody = createSessionResponseSchema.parse(responseBody(two));

    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(oneBody.guest).toEqual(twoBody.guest);
    expect(oneBody.token).toBe(twoBody.token);

    await redis.connection.flushdb();
    const replay = await createSession(idempotencyKey, randomUUID(), 200);
    const replayBody = createSessionResponseSchema.parse(responseBody(replay));
    expect(replayBody.guest).toEqual(oneBody.guest);
    expect(replayBody.token).toBe(oneBody.token);
  });

  it('renews idempotently while the prior token remains valid', async () => {
    const created = createSessionResponseSchema.parse(
      responseBody(await createSession(randomUUID(), randomUUID(), 201)),
    );
    const renewalKey = randomUUID();
    const first = await request(server)
      .post('/v1/session/renew')
      .set('Authorization', `Bearer ${created.token}`)
      .set('Idempotency-Key', renewalKey)
      .send({})
      .expect(200);
    const replay = await request(server)
      .post('/v1/session/renew')
      .set('Authorization', `Bearer ${created.token}`)
      .set('Idempotency-Key', renewalKey)
      .send({})
      .expect(200);
    const firstBody = renewSessionResponseSchema.parse(responseBody(first));
    const replayBody = renewSessionResponseSchema.parse(responseBody(replay));

    expect(firstBody.token).toBe(replayBody.token);
    expect(firstBody.expiresAt).toBe(replayBody.expiresAt);
    expect(firstBody.token).not.toBe(created.token);
    expect(Object.keys(firstBody).sort()).toEqual(
      ['correlationId', 'expiresAt', 'token'].sort(),
    );

    const current = await request(server)
      .get('/v1/session')
      .set('Authorization', `Bearer ${created.token}`)
      .expect(200);
    const currentBody = getSessionResponseSchema.parse(responseBody(current));
    expect(currentBody.guest.id).toBe(created.guest.id);
    expect(currentBody.guest).toMatchObject({
      avatar: created.guest.avatar,
      expiresAt: firstBody.expiresAt,
      id: created.guest.id,
      name: created.guest.name,
    });
    expect(currentBody.guest.issuedAt).toMatch(/Z$/);
  });

  it('accepts cookie authentication and rejects cross-operation key reuse', async () => {
    const idempotencyKey = randomUUID();
    const created = createSessionResponseSchema.parse(
      responseBody(await createSession(idempotencyKey, randomUUID(), 201)),
    );

    await request(server)
      .get('/v1/session')
      .set('Cookie', `cluchess_guest=${created.token}`)
      .expect(200);
    const conflict = await request(server)
      .post('/v1/session/renew')
      .set('Authorization', `Bearer ${created.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(409);
    expect(responseBody(conflict)).toMatchObject({
      error: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        retryable: false,
      },
    });
  });

  it('durably resets all credentials and permits only the exact reset replay', async () => {
    const created = createSessionResponseSchema.parse(
      responseBody(await createSession(randomUUID(), randomUUID(), 201)),
    );
    const resetKey = randomUUID();
    const first = await resetSession(created.token, resetKey, 200);
    const replay = await resetSession(created.token, resetKey, 200);
    const firstBody = resetSessionResponseSchema.parse(responseBody(first));
    const replayBody = resetSessionResponseSchema.parse(responseBody(replay));

    expect(firstBody.ok).toBe(true);
    expect(replayBody.ok).toBe(true);
    expect(first.headers['set-cookie']?.[0]).toContain(
      'cluchess_guest=; Path=/;',
    );
    await request(server)
      .get('/v1/session')
      .set('Authorization', `Bearer ${created.token}`)
      .expect(401);
    await resetSession(created.token, randomUUID(), 401);

    const jti = tokenClaims(created.token).jti;
    expect(
      await redis.connection.exists(`jwt:revoked-session:${created.guest.id}`),
    ).toBe(1);
    expect(await redis.connection.exists(`jwt:denylist:${String(jti)}`)).toBe(
      1,
    );

    await redis.connection.flushdb();
    await app.get(SessionMaintenanceService).runOnce();
    expect(
      await redis.connection.exists(`jwt:revoked-session:${created.guest.id}`),
    ).toBe(1);
  });

  it('returns stable validation, authentication, and rate-limit errors', async () => {
    const malformed = await request(server)
      .post('/v1/session')
      .set('Idempotency-Key', 'not-a-uuid')
      .send({})
      .expect(400);
    expect(responseBody(malformed)).toMatchObject({
      error: { code: 'BAD_REQUEST', retryable: false },
    });
    await request(server)
      .post('/v1/session')
      .set('Idempotency-Key', randomUUID())
      .send({ unexpected: true })
      .expect(400);
    await request(server).get('/v1/session').expect(401);

    for (let index = 0; index < 9; index += 1) {
      await createSession(randomUUID(), randomUUID(), 201);
    }
    const limited = await createSession(randomUUID(), randomUUID(), 429);
    const limitedBody = errorResponseSchema.parse(responseBody(limited));
    expect(limitedBody.error.code).toBe('RATE_LIMITED');
    expect(limitedBody.error.retryable).toBe(true);
    expect(limitedBody.error.retryAfterMs).toBeGreaterThan(0);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('keeps p95 creation and renewal within the local 150 ms target', async () => {
    const baseline = createSessionResponseSchema.parse(
      responseBody(await createSession(randomUUID(), randomUUID(), 201)),
    );
    const createDurations: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const startedAt = performance.now();
      await createSession(randomUUID(), randomUUID(), 201);
      createDurations.push(performance.now() - startedAt);
    }
    const renewDurations: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const startedAt = performance.now();
      await request(server)
        .post('/v1/session/renew')
        .set('Authorization', `Bearer ${baseline.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200);
      renewDurations.push(performance.now() - startedAt);
    }

    expect(percentile95(createDurations)).toBeLessThanOrEqual(150);
    expect(percentile95(renewDurations)).toBeLessThanOrEqual(150);
  });

  it('fails renew and reset closed with 503 while Redis is unavailable', async () => {
    const created = createSessionResponseSchema.parse(
      responseBody(await createSession(randomUUID(), randomUUID(), 201)),
    );
    const containerId = inject('redisContainerId');
    await signalContainer(containerId, 'pause');
    try {
      const renewUnavailable = await request(server)
        .post('/v1/session/renew')
        .set('Authorization', `Bearer ${created.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(503);
      expect(responseBody(renewUnavailable)).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE', retryable: true },
      });
      const resetUnavailable = await resetSession(
        created.token,
        randomUUID(),
        503,
      );
      expect(responseBody(resetUnavailable)).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE', retryable: true },
      });
    } finally {
      await signalContainer(containerId, 'unpause');
      await eventually(async () => {
        await redis.connection.ping();
      });
    }
  });

  it('returns 503 and recovers after PostgreSQL becomes unavailable', async () => {
    const containerId = inject('postgresContainerId');
    await signalContainer(containerId, 'pause');
    try {
      const unavailable = await createSession(randomUUID(), randomUUID(), 503);
      expect(responseBody(unavailable)).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE', retryable: true },
      });
    } finally {
      await signalContainer(containerId, 'unpause');
      await eventually(async () => {
        await pool.query('SELECT 1');
      });
    }
  });

  it('resolves durable display-name collisions without duplicate guests', async () => {
    const repository = app.get(PrismaGuestSessionRepository);
    const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const claims = (): IssuedSessionClaims => ({
      expiresAt: new Date(issuedAt.getTime() + 43_200_000),
      issuedAt,
      jti: randomUUID(),
    });
    const outcomes = await Promise.allSettled([
      repository.create({
        avatarKey: 'knight-midnight',
        displayName: 'BraveKnight42',
        guestSessionId: randomUUID(),
        idempotencyHash: hash(randomUUID()),
        issuedClaims: claims(),
      }),
      repository.create({
        avatarKey: 'knight-sunrise',
        displayName: 'BraveKnight42',
        guestSessionId: randomUUID(),
        idempotencyHash: hash(randomUUID()),
        issuedClaims: claims(),
      }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (
      rejected?.status !== 'rejected' ||
      !(rejected.reason instanceof SessionRepositoryError)
    ) {
      throw new Error('Expected a display-name conflict');
    }
    expect(rejected.reason.kind).toBe('display-name-conflict');
  });

  it('cleans only old, expired, unreferenced guest sessions', async () => {
    const unreferenced = await createGuestSession(pool, 'old-unreferenced');
    const allocated = await allocateGame(pool);
    const referenced = allocated.guestSessionIds[0];
    await pool.query(
      `
        UPDATE guest_sessions
        SET
          issued_at = clock_timestamp() - interval '32 days',
          expires_at = clock_timestamp() - interval '31 days'
        WHERE id = ANY($1::UUID[])
      `,
      [[unreferenced, referenced]],
    );

    const deleted = await app.get(SessionMaintenanceService).runOnce();
    const remaining = await pool.query<{ id: string }>(
      'SELECT id FROM guest_sessions WHERE id = ANY($1::UUID[])',
      [[unreferenced, referenced]],
    );

    expect(deleted).toBe(1);
    expect(remaining.rows.map((row) => row.id)).toEqual([referenced]);
  });

  async function createSession(
    idempotencyKey: string,
    correlationId: string,
    status: number | undefined,
  ): Promise<SuperAgentResponse> {
    const pending = request(server)
      .post('/v1/session')
      .set('Idempotency-Key', idempotencyKey)
      .set('X-Correlation-Id', correlationId)
      .send({});
    return status === undefined ? pending : pending.expect(status);
  }

  async function resetSession(
    token: string,
    idempotencyKey: string,
    status: number,
  ): Promise<SuperAgentResponse> {
    return request(server)
      .post('/v1/session/reset')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(status);
  }
});

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function responseBody(response: SuperAgentResponse): unknown {
  return response.body as unknown;
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const value = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (value === undefined) {
    throw new Error('Cannot calculate a percentile from no samples');
  }
  return value;
}

function tokenClaims(token: string): Readonly<Record<string, unknown>> {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    throw new Error('Issued token did not contain claims');
  }
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Readonly<Record<string, unknown>>;
}

async function eventually(action: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  }
  throw lastError;
}
