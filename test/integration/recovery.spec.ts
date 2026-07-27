import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
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
import { AppModule } from '../../src/app.module.js';
import { RedisService } from '../../src/common/redis/redis.service.js';
import { GameReconciliationService } from '../../src/modules/game/game-reconciliation.service.js';
import { GameRecoveryService } from '../../src/modules/game/game-recovery.service.js';
import { GameLifecycleService } from '../../src/modules/game/game-lifecycle.service.js';
import { GameMoveService } from '../../src/modules/game/game-move.service.js';
import { GameRoomService } from '../../src/modules/game/game-room.service.js';
import { MatchmakingService } from '../../src/modules/matchmaking/matchmaking.service.js';
import { PresenceService } from '../../src/modules/presence/presence.service.js';
import {
  activeGameResponseSchema,
  recoveredSnapshotResponseSchema,
} from '../../src/modules/recovery/recovery.schemas.js';
import { createSessionResponseSchema } from '../../src/modules/session/session.schemas.js';
import {
  allocateGame,
  createPool,
  truncateApplicationTables,
} from './support/database.js';
import { signalContainer } from './support/docker-engine.js';

interface TestGuest {
  readonly id: string;
  readonly token: string;
}

describe('authoritative game recovery and reconciliation', () => {
  let app: INestApplication;
  let lifecycle: GameLifecycleService;
  let matchmaking: MatchmakingService;
  let moves: GameMoveService;
  let pool: Pool;
  let presence: PresenceService;
  let reconciler: GameReconciliationService;
  let recovery: GameRecoveryService;
  let redis: RedisService;
  let rooms: GameRoomService;
  let server: Server;

  beforeAll(async () => {
    pool = createPool();
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('v1', {
      exclude: [
        { method: RequestMethod.ALL, path: 'healthz' },
        { method: RequestMethod.ALL, path: 'metrics' },
        { method: RequestMethod.ALL, path: 'readyz' },
      ],
    });
    await app.init();
    lifecycle = app.get(GameLifecycleService);
    matchmaking = app.get(MatchmakingService);
    moves = app.get(GameMoveService);
    presence = app.get(PresenceService);
    reconciler = app.get(GameReconciliationService);
    recovery = app.get(GameRecoveryService);
    redis = app.get(RedisService);
    rooms = app.get(GameRoomService);
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

  it('restores the same active game and full member snapshot after refresh', async () => {
    const [white, black, outsider] = await Promise.all([
      createGuest(),
      createGuest(),
      createGuest(),
    ]);
    const game = await allocateGame(pool, {
      guestSessionIds: [white.id, black.id],
    });

    const active = activeGameResponseSchema.parse(
      body(
        await request(server)
          .get('/v1/games/active')
          .set('Authorization', `Bearer ${white.token}`)
          .expect(200),
      ),
    );
    expect(active.gameId).toBe(game.gameId);

    const first = recoveredSnapshotResponseSchema.parse(
      body(
        await request(server)
          .get(`/v1/games/${game.gameId}/snapshot`)
          .set('Authorization', `Bearer ${white.token}`)
          .expect(200),
      ),
    );
    expect(first).toMatchObject({
      gameId: game.gameId,
      gameVersion: 0,
      opponent: { color: 'black' },
      status: 'CREATED',
      you: { color: 'white' },
    });
    expect(first.you.name.length).toBeGreaterThan(0);
    expect(first.opponent.name.length).toBeGreaterThan(0);
    expect(await redis.connection.get(`user:${white.id}:active-game`)).toBe(
      game.gameId,
    );
    expect(await redis.connection.exists(`game:${game.gameId}:snapshot`)).toBe(
      1,
    );

    await redis.connection.flushdb();
    const refreshed = recoveredSnapshotResponseSchema.parse(
      body(
        await request(server)
          .get(`/v1/games/${game.gameId}/snapshot`)
          .set('Authorization', `Bearer ${white.token}`)
          .expect(200),
      ),
    );
    expect(refreshed).toMatchObject({
      currentFen: first.currentFen,
      gameId: first.gameId,
      gameVersion: first.gameVersion,
      moves: first.moves,
    });
    expect(await redis.connection.get(`user:${black.id}:active-game`)).toBe(
      game.gameId,
    );

    const idle = activeGameResponseSchema.parse(
      body(
        await request(server)
          .get('/v1/games/active')
          .set('Authorization', `Bearer ${outsider.token}`)
          .expect(200),
      ),
    );
    expect(idle.gameId).toBeNull();
  });

  it('enforces authentication, membership, identifiers, and not-found errors', async () => {
    const [white, black, outsider] = await Promise.all([
      createGuest(),
      createGuest(),
      createGuest(),
    ]);
    const game = await allocateGame(pool, {
      guestSessionIds: [white.id, black.id],
    });

    await request(server).get('/v1/games/active').expect(401);
    expect(
      body(
        await request(server)
          .get(`/v1/games/${game.gameId}/snapshot`)
          .set('Authorization', `Bearer ${outsider.token}`)
          .expect(403),
      ),
    ).toMatchObject({
      error: { code: 'NOT_A_PLAYER', retryable: false },
    });
    expect(
      body(
        await request(server)
          .get(`/v1/games/${randomUUID()}/snapshot`)
          .set('Authorization', `Bearer ${white.token}`)
          .expect(404),
      ),
    ).toMatchObject({
      error: { code: 'GAME_NOT_FOUND', retryable: false },
    });
    expect(
      body(
        await request(server)
          .get('/v1/games/not-a-uuid/snapshot')
          .set('Authorization', `Bearer ${white.token}`)
          .expect(400),
      ),
    ).toMatchObject({
      error: { code: 'BAD_REQUEST', retryable: false },
    });

    const rateLimitKey = createHash('sha256').update(white.id).digest('hex');
    await redis.connection.set(
      `rl:recovery:active:${rateLimitKey}`,
      '60',
      'PX',
      60_000,
    );
    const limited = await request(server)
      .get('/v1/games/active')
      .set('Authorization', `Bearer ${white.token}`)
      .expect(429);
    expect(body(limited)).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        retryable: true,
      },
    });
    expect(limited.text).toContain('"retryAfterMs":');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('repairs bounded active-game, state, snapshot, grace, and stale-key drift', async () => {
    const [white, black, outsider] = await Promise.all([
      createGuest(),
      createGuest(),
      createGuest(),
    ]);
    const game = await allocateGame(pool, {
      guestSessionIds: [white.id, black.id],
    });
    await pool.query(
      `
        UPDATE game_players
        SET
          disconnected_at = clock_timestamp(),
          reconnect_grace_ends_at = clock_timestamp() + interval '30 seconds'
        WHERE game_id = $1 AND guest_session_id = $2
      `,
      [game.gameId, white.id],
    );
    await redis.connection.set(`user:${outsider.id}:active-game`, game.gameId);

    const report = await reconciler.runOnce();

    expect(report.activeGameRepairs).toBe(2);
    expect(report.stateRepairs).toBe(2);
    expect(report.snapshotRepairs).toBe(1);
    expect(report.graceRepairs).toBe(1);
    expect(await redis.connection.get(`user:${white.id}:active-game`)).toBe(
      game.gameId,
    );
    expect(await redis.connection.get(`user:${white.id}:state`)).toBe(
      'IN_GAME',
    );
    expect(
      await redis.connection.exists(`game:${game.gameId}:grace:${white.id}`),
    ).toBe(1);
    expect(await redis.connection.exists(`game:${game.gameId}:snapshot`)).toBe(
      1,
    );
    expect(
      await redis.connection.exists(`user:${outsider.id}:active-game`),
    ).toBe(0);

    await Promise.all([reconciler.runOnce(), reconciler.runOnce()]);
    expect(await redis.connection.get(`user:${black.id}:active-game`)).toBe(
      game.gameId,
    );
  });

  it('returns the durable terminal snapshot after reconnect grace expires', async () => {
    const [white, black] = await Promise.all([createGuest(), createGuest()]);
    const game = await createPlayableGame(white, black);
    await presence.markConnected(black.id, 'test:black');
    await lifecycle.disconnected(white.id);
    await pool.query(
      `
        UPDATE game_players
        SET
          disconnected_at = clock_timestamp() - interval '2 seconds',
          reconnect_grace_ends_at = clock_timestamp() - interval '1 second'
        WHERE game_id = $1 AND guest_session_id = $2
      `,
      [game.gameId, white.id],
    );
    await lifecycle.adjudicateGame(game.gameId);

    const active = activeGameResponseSchema.parse(
      body(
        await request(server)
          .get('/v1/games/active')
          .set('Authorization', `Bearer ${white.token}`)
          .expect(200),
      ),
    );
    expect(active.gameId).toBeNull();
    const terminal = recoveredSnapshotResponseSchema.parse(
      body(
        await request(server)
          .get(`/v1/games/${game.gameId}/snapshot`)
          .set('Authorization', `Bearer ${white.token}`)
          .expect(200),
      ),
    );
    expect(terminal).toMatchObject({
      gameId: game.gameId,
      result: 'black_win',
      status: 'ABANDONED',
      termination: 'abandonment',
    });
  });

  it('bypasses Redis during authoritative service recovery and restores it', async () => {
    const [white, black] = await Promise.all([createGuest(), createGuest()]);
    const game = await allocateGame(pool, {
      guestSessionIds: [white.id, black.id],
    });
    const redisContainerId = inject('redisContainerId');
    await signalContainer(redisContainerId, 'pause');
    try {
      await expect(recovery.activeGameId(white.id)).resolves.toBe(game.gameId);
      await expect(
        recovery.snapshot(game.gameId, white.id),
      ).resolves.toMatchObject({
        gameId: game.gameId,
        gameVersion: 0,
      });
    } finally {
      await signalContainer(redisContainerId, 'unpause');
      await eventually(async () => {
        await redis.connection.ping();
      });
    }

    await recovery.snapshot(game.gameId, white.id);
    expect(await redis.connection.exists(`game:${game.gameId}:snapshot`)).toBe(
      1,
    );
  });

  it('pauses matchmaking but commits durable moves while Redis is unavailable', async () => {
    const [white, black] = await Promise.all([createGuest(), createGuest()]);
    const game = await createPlayableGame(white, black);
    const redisContainerId = inject('redisContainerId');
    await signalContainer(redisContainerId, 'pause');
    try {
      await expect(matchmaking.drain()).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      });
      await expect(
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 2,
          gameId: game.gameId,
          guestSessionId: white.id,
          move: { from: 'e2', to: 'e4' },
        }),
      ).resolves.toMatchObject({
        accepted: { gameVersion: 3, san: 'e4' },
      });
    } finally {
      await signalContainer(redisContainerId, 'unpause');
      await eventually(async () => {
        await redis.connection.ping();
      });
    }

    const durable = await pool.query<{ moves: string; version: number }>(
      `
        SELECT
          (SELECT count(*)::TEXT FROM moves WHERE game_id = $1) AS moves,
          version
        FROM games
        WHERE id = $1
      `,
      [game.gameId],
    );
    expect(durable.rows[0]).toEqual({ moves: '1', version: 3 });
  });

  it('rejects moves closed without fabricating state while PostgreSQL is unavailable', async () => {
    const [white, black] = await Promise.all([createGuest(), createGuest()]);
    const game = await createPlayableGame(white, black);
    const postgresContainerId = inject('postgresContainerId');
    await signalContainer(postgresContainerId, 'pause');
    try {
      await expect(
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 2,
          gameId: game.gameId,
          guestSessionId: white.id,
          move: { from: 'e2', to: 'e4' },
        }),
      ).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        responseType: 'move.rejected',
        retryable: true,
      });
    } finally {
      await signalContainer(postgresContainerId, 'unpause');
      await eventually(async () => {
        await pool.query('SELECT 1');
      });
    }

    const durable = await pool.query<{ moves: string; version: number }>(
      `
        SELECT
          (SELECT count(*)::TEXT FROM moves WHERE game_id = $1) AS moves,
          version
        FROM games
        WHERE id = $1
      `,
      [game.gameId],
    );
    expect(durable.rows[0]).toEqual({ moves: '0', version: 2 });
  });

  it('exposes reconciliation and adapter degradation metrics', async () => {
    const response = await request(server).get('/metrics').expect(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('cluchess_reconciliation_runs_total');
    expect(response.text).toContain('process_resident_memory_bytes');
  });

  async function createGuest(): Promise<TestGuest> {
    const response = await request(server)
      .post('/v1/session')
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(201);
    const created = createSessionResponseSchema.parse(body(response));
    return { id: created.guest.id, token: created.token };
  }

  async function createPlayableGame(
    white: TestGuest,
    black: TestGuest,
  ): Promise<{ gameId: string }> {
    const game = await allocateGame(pool, {
      guestSessionIds: [white.id, black.id],
    });
    await pool.query(
      `
        UPDATE games
        SET
          status = 'WAITING_FOR_PLAYERS',
          join_deadline_at = clock_timestamp() + interval '20 seconds'
        WHERE id = $1
      `,
      [game.gameId],
    );
    await rooms.ready(game.gameId, white.id, 0);
    await rooms.ready(game.gameId, black.id, 0);
    return { gameId: game.gameId };
  }
});

function body(response: { body: unknown }): unknown {
  return response.body;
}

async function eventually(assertion: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}
