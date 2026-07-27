import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { RedisService } from '../../src/common/redis/redis.service.js';
import type { GameAllocation } from '../../src/modules/game/application/ports/game.repository.js';
import { GameAllocationService } from '../../src/modules/game/game-allocation.service.js';
import { GameDeadlineService } from '../../src/modules/game/game-deadline.service.js';
import { GameLifecycleService } from '../../src/modules/game/game-lifecycle.service.js';
import { GameRoomService } from '../../src/modules/game/game-room.service.js';
import { PresenceService } from '../../src/modules/presence/presence.service.js';
import type { AuthenticatedGuest } from '../../src/modules/session/jwt-token.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import {
  createGuestSession,
  createPool,
  truncateApplicationTables,
} from './support/database.js';

type GamePair = Readonly<{
  black: string;
  gameId: string;
  white: string;
}>;

describe('non-move game lifecycle', () => {
  let allocations: GameAllocationService;
  let app: INestApplicationContext;
  let deadlines: GameDeadlineService;
  let lifecycle: GameLifecycleService;
  let pool: Pool;
  let presence: PresenceService;
  let redis: RedisService;
  let rooms: GameRoomService;
  let sessions: SessionService;

  beforeAll(async () => {
    pool = createPool();
    await startApplication();
  });

  beforeEach(async () => {
    await truncateApplicationTables(pool);
    await redis.connection.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('persists resignation once and replays the exact terminal response', async () => {
    const game = await createPlayableGame();
    await seedEphemeralGame(game);
    const eventId = randomUUID();
    const first = await lifecycle.resign({
      eventId,
      expectedVersion: 2,
      gameId: game.gameId,
      guestSessionId: game.white,
    });
    const replay = await lifecycle.resign({
      eventId,
      expectedVersion: 2,
      gameId: game.gameId,
      guestSessionId: game.white,
    });

    expect(first).toMatchObject({
      duplicate: false,
      ended: {
        gameVersion: 3,
        result: 'black_win',
        termination: 'resignation',
      },
    });
    expect(replay).toEqual({ ...first, duplicate: true });
    expect(await audit(game.gameId)).toMatchObject({
      assignments: 0,
      commands: 1,
      result: '0-1',
      status: 'COMPLETED',
      termination: 'RESIGNATION',
      version: 3,
    });
    await expectIdleEphemeralState(game);
  });

  it('adjudicates exact flag fall from the durable clock', async () => {
    const game = await createPlayableGame();
    await pool.query(
      `
        UPDATE games
        SET white_clock_ms = 0, turn_started_at = clock_timestamp()
        WHERE id = $1
      `,
      [game.gameId],
    );

    await deadlines.runSweep();

    expect(await audit(game.gameId)).toMatchObject({
      assignments: 0,
      result: '0-1',
      status: 'COMPLETED',
      termination: 'TIMEOUT',
      version: 3,
    });
  });

  it('expires one-player and double no-shows with their approved results', async () => {
    const oneJoined = await createWaitingGame();
    await rooms.ready(oneJoined.gameId, oneJoined.white, 0);
    const neitherJoined = await createWaitingGame();
    await pool.query(
      `
        UPDATE games
        SET join_deadline_at = clock_timestamp() - interval '1 second'
        WHERE id = ANY($1::uuid[])
      `,
      [[oneJoined.gameId, neitherJoined.gameId]],
    );

    await deadlines.runSweep();

    expect(await audit(oneJoined.gameId)).toMatchObject({
      assignments: 0,
      result: '1-0',
      status: 'EXPIRED',
      termination: 'JOIN_TIMEOUT',
      version: 1,
    });
    expect(await audit(neitherJoined.gameId)).toMatchObject({
      assignments: 0,
      result: '*',
      status: 'EXPIRED',
      termination: 'JOIN_TIMEOUT',
      version: 1,
    });
  });

  it('abandons one absent player and voids a double abandonment', async () => {
    const single = await createPlayableGame();
    await presence.markConnected(single.black, 'test:black');
    await lifecycle.disconnected(single.white);
    await expireGrace(single.gameId);
    await deadlines.runSweep();

    expect(await audit(single.gameId)).toMatchObject({
      assignments: 0,
      result: '0-1',
      status: 'ABANDONED',
      termination: 'ABANDONMENT',
      version: 4,
    });

    const double = await createPlayableGame();
    await lifecycle.disconnected(double.white);
    await lifecycle.disconnected(double.black);
    await expireGrace(double.gameId);
    await deadlines.runSweep();

    expect(await audit(double.gameId)).toMatchObject({
      assignments: 0,
      result: '*',
      status: 'ABANDONED',
      termination: 'SYSTEM',
      version: 5,
    });
  });

  it('uses final-socket presence semantics and cancels grace on reconnect', async () => {
    const game = await createPlayableGame();
    await presence.markConnected(game.white, 'tab:one');
    await presence.markConnected(game.white, 'tab:two');

    expect(await presence.remove(game.white, 'tab:one')).toBe(1);
    expect(await audit(game.gameId)).toMatchObject({
      status: 'IN_PROGRESS',
      version: 2,
    });

    expect(await presence.remove(game.white, 'tab:two')).toBe(0);
    const disconnected = await lifecycle.disconnected(game.white);
    expect(disconnected).toMatchObject({
      color: 'w',
      gameVersion: 3,
    });
    expect(await audit(game.gameId)).toMatchObject({
      status: 'RECONNECTING',
      version: 3,
    });

    await presence.markConnected(game.white, 'tab:three');
    const reconnected = await lifecycle.reconnected(game.white);
    expect(reconnected).toMatchObject({
      color: 'w',
      gameVersion: 4,
    });
    expect(await audit(game.gameId)).toMatchObject({
      status: 'IN_PROGRESS',
      version: 4,
    });
    expect(
      await redis.connection.exists(`game:${game.gameId}:grace:${game.white}`),
    ).toBe(0);
  });

  it('immediately abandons an active game during an idempotent session reset', async () => {
    const playing = await createPlayableGame();
    const authenticated = await authenticatedGuest(playing.white);
    const idempotencyKey = randomUUID();

    await sessions.reset(authenticated, idempotencyKey, false);
    await sessions.reset(authenticated, idempotencyKey, true);

    expect(await audit(playing.gameId)).toMatchObject({
      assignments: 0,
      result: '0-1',
      status: 'ABANDONED',
      termination: 'ABANDONMENT',
      version: 3,
    });

    const waiting = await createWaitingGame();
    await sessions.reset(
      await authenticatedGuest(waiting.white),
      randomUUID(),
      false,
    );
    expect(await audit(waiting.gameId)).toMatchObject({
      assignments: 0,
      result: '0-1',
      status: 'ABANDONED',
      termination: 'ABANDONMENT',
      version: 1,
    });
  });

  it('serializes competing resignation and timeout attempts to one result', async () => {
    const game = await createPlayableGame();
    await pool.query(
      `
        UPDATE games
        SET white_clock_ms = 0, turn_started_at = clock_timestamp()
        WHERE id = $1
      `,
      [game.gameId],
    );

    await Promise.allSettled([
      lifecycle.resign({
        eventId: randomUUID(),
        expectedVersion: 2,
        gameId: game.gameId,
        guestSessionId: game.black,
      }),
      lifecycle.adjudicateGame(game.gameId),
    ]);

    const settled = await audit(game.gameId);
    expect(settled).toMatchObject({
      assignments: 0,
      status: 'COMPLETED',
      version: 3,
    });
    expect(['0-1', '1-0']).toContain(settled.result);
    expect(['RESIGNATION', 'TIMEOUT']).toContain(settled.termination);
    expect(settled.commands === 0 || settled.commands === 1).toBe(true);
  });

  it('rebuilds overdue clock work after an application restart', async () => {
    const game = await createPlayableGame();
    await app.close();
    await pool.query(
      `
        UPDATE games
        SET white_clock_ms = 0, turn_started_at = clock_timestamp()
        WHERE id = $1
      `,
      [game.gameId],
    );

    await startApplication();

    await eventually(async () => {
      expect(await audit(game.gameId)).toMatchObject({
        assignments: 0,
        status: 'COMPLETED',
        termination: 'TIMEOUT',
        version: 3,
      });
    });
  });

  async function startApplication(): Promise<void> {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    allocations = app.get(GameAllocationService);
    deadlines = app.get(GameDeadlineService);
    lifecycle = app.get(GameLifecycleService);
    presence = app.get(PresenceService);
    redis = app.get(RedisService);
    rooms = app.get(GameRoomService);
    sessions = app.get(SessionService);
    await redis.ensureConnected();
  }

  async function createPlayableGame(): Promise<GamePair> {
    const game = await createWaitingGame();
    await rooms.ready(game.gameId, game.white, 0);
    await rooms.ready(game.gameId, game.black, 0);
    return game;
  }

  async function createWaitingGame(): Promise<GamePair> {
    const first = await createGuestSession(pool);
    const second = await createGuestSession(pool);
    const allocation = await allocations.allocate({
      a: first,
      aScore: Date.now() - 1,
      b: second,
      bScore: Date.now(),
      createdAt: Date.now(),
      gameId: randomUUID(),
      matchId: randomUUID(),
      mode: 'blitz',
    });
    return gamePair(allocation);
  }

  function gamePair(allocation: GameAllocation): GamePair {
    const white = allocation.players.find((player) => player.color === 'w');
    const black = allocation.players.find((player) => player.color === 'b');
    if (white === undefined || black === undefined) {
      throw new Error('Allocated game does not contain both colors.');
    }
    return {
      black: black.guestSessionId,
      gameId: allocation.game.id,
      white: white.guestSessionId,
    };
  }

  async function expireGrace(gameId: string): Promise<void> {
    await pool.query(
      `
        UPDATE game_players
        SET
          disconnected_at = clock_timestamp() - interval '2 seconds',
          reconnect_grace_ends_at = clock_timestamp() - interval '1 second'
        WHERE game_id = $1 AND disconnected_at IS NOT NULL
      `,
      [gameId],
    );
    await pool.query(
      `
        UPDATE games
        SET reconnect_deadline_at = clock_timestamp() - interval '1 second'
        WHERE id = $1
      `,
      [gameId],
    );
  }

  async function seedEphemeralGame(game: GamePair): Promise<void> {
    for (const guestSessionId of [game.white, game.black]) {
      await redis.connection.set(
        `user:${guestSessionId}:active-game`,
        game.gameId,
      );
      await redis.connection.set(`user:${guestSessionId}:state`, 'IN_GAME');
    }
  }

  async function expectIdleEphemeralState(game: GamePair): Promise<void> {
    for (const guestSessionId of [game.white, game.black]) {
      expect(
        await redis.connection.exists(`user:${guestSessionId}:active-game`),
      ).toBe(0);
      expect(await redis.connection.get(`user:${guestSessionId}:state`)).toBe(
        'IDLE',
      );
    }
  }

  async function authenticatedGuest(
    guestSessionId: string,
  ): Promise<AuthenticatedGuest> {
    const result = await pool.query<{
      avatarKey: string;
      displayName: string;
      expiresAt: Date;
      issuedAt: Date;
      jti: string;
    }>(
      `
        SELECT
          avatar_key AS "avatarKey",
          display_name AS "displayName",
          expires_at AS "expiresAt",
          issued_at AS "issuedAt",
          current_jti AS "jti"
        FROM guest_sessions
        WHERE id = $1
      `,
      [guestSessionId],
    );
    const guest = result.rows[0];
    if (guest === undefined) {
      throw new Error('Authenticated test guest was not found.');
    }
    return {
      avatarKey: guest.avatarKey,
      expiresAt: guest.expiresAt,
      guestSessionId,
      issuedAt: guest.issuedAt,
      jti: guest.jti,
      name: guest.displayName,
    };
  }

  async function audit(gameId: string): Promise<
    Readonly<{
      assignments: number;
      commands: number;
      result: string | null;
      status: string;
      termination: string | null;
      version: number;
    }>
  > {
    const result = await pool.query<{
      assignments: number;
      commands: number;
      result: string | null;
      status: string;
      termination: string | null;
      version: number;
    }>(
      `
        SELECT
          game.result,
          game.status,
          game.termination,
          game.version,
          (
            SELECT count(*)::int
            FROM active_game_assignments
            WHERE game_id = game.id
          ) AS assignments,
          (
            SELECT count(*)::int
            FROM game_commands
            WHERE game_id = game.id
          ) AS commands
        FROM games AS game
        WHERE game.id = $1
      `,
      [gameId],
    );
    const game = result.rows[0];
    if (game === undefined) {
      throw new Error('Lifecycle audit returned no game.');
    }
    return game;
  }
});

async function eventually(action: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  throw lastError;
}
