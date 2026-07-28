import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { MetricsService } from '../../src/common/metrics/metrics.service.js';
import { RedisService } from '../../src/common/redis/redis.service.js';
import type { MoveInput } from '../../src/modules/chess/application/ports/chess-engine.js';
import type { MoveSubmission } from '../../src/modules/game/application/ports/gameplay.repository.js';
import { GameAllocationService } from '../../src/modules/game/game-allocation.service.js';
import { GameMoveService } from '../../src/modules/game/game-move.service.js';
import { GameRoomService } from '../../src/modules/game/game-room.service.js';
import { GameServiceError } from '../../src/modules/game/domain/game-service.errors.js';
import {
  createGuestSession,
  createPool,
  truncateApplicationTables,
} from './support/database.js';

describe('authoritative gameplay transactions', () => {
  let allocations: GameAllocationService;
  let app: INestApplicationContext;
  let moves: GameMoveService;
  let pool: Pool;
  let redis: RedisService;
  let rooms: GameRoomService;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    allocations = app.get(GameAllocationService);
    moves = app.get(GameMoveService);
    pool = createPool();
    redis = app.get(RedisService);
    rooms = app.get(GameRoomService);
    await redis.ensureConnected();
  });

  beforeEach(async () => {
    await pool.query('DROP TRIGGER IF EXISTS gameplay_forced_failure ON moves');
    await pool.query('DROP FUNCTION IF EXISTS gameplay_forced_failure()');
    await truncateApplicationTables(pool);
    await redis.connection.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('commits one legal move and replays its exact acknowledgement', async () => {
    const game = await createPlayableGame();
    const clientMoveId = randomUUID();
    const first = await submit(game, 'w', 2, clientMoveId, {
      from: 'e2',
      to: 'e4',
    });
    const duplicate = await submit(game, 'w', 2, clientMoveId, {
      from: 'e2',
      to: 'e4',
    });

    expect(first).toMatchObject({
      accepted: {
        clientMoveId,
        gameVersion: 3,
        ply: 1,
        turn: 'b',
        uci: 'e2e4',
      },
      duplicate: false,
      ended: null,
    });
    expect(duplicate).toEqual({ ...first, duplicate: true });

    const snapshot = await rooms.snapshot(game.gameId, game.black);
    expect(snapshot.game).toMatchObject({
      currentFen: first.accepted.fenAfter,
      status: 'IN_PROGRESS',
      turnColor: 'b',
      version: 3,
    });
    expect(snapshot.clocks.running).toBe('b');
    expect(snapshot.moves).toMatchObject([
      {
        clientMoveId,
        color: 'w',
        ply: 1,
        uci: 'e2e4',
      },
    ]);

    const audit = await auditGame(game.gameId);
    expect(audit).toMatchObject({
      commands: 1,
      maxPly: 1,
      minPly: 1,
      moves: 1,
      version: 3,
    });
  });

  it('returns stable authorization, turn, legality, version, and key errors', async () => {
    const game = await createPlayableGame();
    const outsider = await createGuestSession(pool);

    await expectMoveError(
      () =>
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 2,
          gameId: game.gameId,
          guestSessionId: game.black,
          move: { from: 'e7', to: 'e5' },
        }),
      'NOT_YOUR_TURN',
      2,
    );
    await expectMoveError(
      () =>
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 2,
          gameId: game.gameId,
          guestSessionId: game.white,
          move: { from: 'e2', to: 'e5' },
        }),
      'ILLEGAL_MOVE',
      2,
    );
    await expectMoveError(
      () =>
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 1,
          gameId: game.gameId,
          guestSessionId: game.white,
          move: { from: 'e2', to: 'e4' },
        }),
      'STALE_GAME_VERSION',
      2,
    );
    await expectMoveError(
      () =>
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 2,
          gameId: game.gameId,
          guestSessionId: outsider,
          move: { from: 'e2', to: 'e4' },
        }),
      'NOT_A_PLAYER',
      2,
    );
    await pool.query(
      `
        UPDATE games
        SET white_clock_ms = 0
        WHERE id = $1
      `,
      [game.gameId],
    );
    await expectMoveError(
      () =>
        moves.submit({
          clientMoveId: randomUUID(),
          expectedVersion: 2,
          gameId: game.gameId,
          guestSessionId: game.white,
          move: { from: 'e2', to: 'e4' },
        }),
      'CLOCK_EXPIRED',
      2,
    );
    await pool.query(
      `
        UPDATE games
        SET white_clock_ms = time_initial_ms, turn_started_at = clock_timestamp()
        WHERE id = $1
      `,
      [game.gameId],
    );

    const clientMoveId = randomUUID();
    await submit(game, 'w', 2, clientMoveId, { from: 'e2', to: 'e4' });
    await expectMoveError(
      () =>
        moves.submit({
          clientMoveId,
          expectedVersion: 3,
          gameId: game.gameId,
          guestSessionId: game.black,
          move: { from: 'e7', to: 'e5' },
        }),
      'IDEMPOTENCY_KEY_REUSED',
    );

    const renderedMetrics = app.get(MetricsService).render();
    expect(renderedMetrics).toContain(
      'cluchess_moves_rejected_total{code="STALE_GAME_VERSION"} 1',
    );
    expect(renderedMetrics).toContain('cluchess_optimistic_conflicts_total 1');
  });

  it('serializes simultaneous same-version moves so exactly one commits', async () => {
    const game = await createPlayableGame();
    const attempts = await Promise.allSettled([
      submit(game, 'w', 2, randomUUID(), { from: 'e2', to: 'e4' }),
      submit(game, 'w', 2, randomUUID(), { from: 'd2', to: 'd4' }),
    ]);
    const accepted = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<MoveSubmission> =>
        attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === 'rejected',
    );

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      authoritativeVersion: 3,
      code: 'NOT_YOUR_TURN',
      responseType: 'move.rejected',
    });
    expect(await auditGame(game.gameId)).toMatchObject({
      commands: 1,
      maxPly: 1,
      minPly: 1,
      moves: 1,
      version: 3,
    });
  });

  it('rolls back a forced pre-commit failure and accepts a clean retry', async () => {
    const game = await createPlayableGame();
    const clientMoveId = randomUUID();
    await pool.query(`
      CREATE FUNCTION gameplay_forced_failure()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced gameplay insert failure';
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER gameplay_forced_failure
      BEFORE INSERT ON moves
      FOR EACH ROW
      EXECUTE FUNCTION gameplay_forced_failure()
    `);

    await expect(
      submit(game, 'w', 2, clientMoveId, { from: 'e2', to: 'e4' }),
    ).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      responseType: 'move.rejected',
    });
    expect(await auditGame(game.gameId)).toMatchObject({
      commands: 0,
      moves: 0,
      version: 2,
    });

    await pool.query('DROP TRIGGER gameplay_forced_failure ON moves');
    await pool.query('DROP FUNCTION gameplay_forced_failure()');
    await expect(
      submit(game, 'w', 2, clientMoveId, { from: 'e2', to: 'e4' }),
    ).resolves.toMatchObject({
      accepted: { gameVersion: 3, ply: 1 },
      duplicate: false,
    });
  });

  it('commits checkmate, releases active state, and keeps terminal retries exact', async () => {
    const game = await createPlayableGame();
    await Promise.all(
      [game.white, game.black].map(async (guestSessionId) => {
        await redis.connection.set(
          `user:${guestSessionId}:active-game`,
          game.gameId,
        );
        await redis.connection.set(`user:${guestSessionId}:state`, 'IN_GAME');
      }),
    );
    const sequence: readonly Readonly<{
      color: 'b' | 'w';
      move: MoveInput;
    }>[] = [
      { color: 'w', move: { from: 'e2', to: 'e4' } },
      { color: 'b', move: { from: 'e7', to: 'e5' } },
      { color: 'w', move: { from: 'd1', to: 'h5' } },
      { color: 'b', move: { from: 'b8', to: 'c6' } },
      { color: 'w', move: { from: 'f1', to: 'c4' } },
      { color: 'b', move: { from: 'g8', to: 'f6' } },
      { color: 'w', move: { from: 'h5', to: 'f7' } },
    ];

    let final: MoveSubmission | undefined;
    let finalClientMoveId = '';
    for (const [index, item] of sequence.entries()) {
      finalClientMoveId = randomUUID();
      final = await submit(
        game,
        item.color,
        index + 2,
        finalClientMoveId,
        item.move,
      );
    }
    if (final === undefined) {
      throw new Error('Checkmate sequence did not submit any move');
    }

    expect(final).toMatchObject({
      accepted: {
        check: true,
        gameVersion: 9,
        ply: 7,
        san: 'Qxf7#',
      },
      ended: {
        gameVersion: 9,
        result: 'white_win',
        termination: 'checkmate',
      },
    });
    expect(
      await submit(game, 'w', 8, finalClientMoveId, {
        from: 'h5',
        to: 'f7',
      }),
    ).toEqual({ ...final, duplicate: true });
    await expectMoveError(
      () =>
        submit(game, 'b', 9, randomUUID(), {
          from: 'a7',
          to: 'a6',
        }),
      'GAME_ALREADY_ENDED',
      9,
    );

    expect(await auditGame(game.gameId)).toMatchObject({
      assignments: 0,
      commands: 7,
      maxPly: 7,
      minPly: 1,
      moves: 7,
      result: '1-0',
      status: 'COMPLETED',
      termination: 'CHECKMATE',
      version: 9,
    });
    for (const guestSessionId of [game.white, game.black]) {
      expect(
        await redis.connection.exists(`user:${guestSessionId}:active-game`),
      ).toBe(0);
      expect(await redis.connection.get(`user:${guestSessionId}:state`)).toBe(
        'IDLE',
      );
    }

    const snapshot = await rooms.snapshot(game.gameId, game.black);
    expect(snapshot.moves).toHaveLength(7);
    expect(snapshot.clocks.running).toBeNull();
    expect(snapshot.game).toMatchObject({
      result: 'white_win',
      status: 'COMPLETED',
      termination: 'checkmate',
      version: 9,
    });
  });

  it('records an automatic insufficient-material draw in the move transaction', async () => {
    const game = await createPlayableGame();
    const initialFen = 'k7/8/8/8/8/8/4b3/4K3 w - - 0 1';
    await pool.query(
      `
        UPDATE games
        SET initial_fen = $2, current_fen = $2, pgn = ''
        WHERE id = $1
      `,
      [game.gameId, initialFen],
    );

    const result = await submit(game, 'w', 2, randomUUID(), {
      from: 'e1',
      to: 'e2',
    });

    expect(result).toMatchObject({
      accepted: { gameVersion: 3, ply: 1, uci: 'e1e2' },
      ended: {
        gameVersion: 3,
        result: 'draw',
        termination: 'insufficient_material',
      },
    });
    expect(await auditGame(game.gameId)).toMatchObject({
      assignments: 0,
      moves: 1,
      result: '1/2-1/2',
      status: 'COMPLETED',
      termination: 'INSUFFICIENT_MATERIAL',
      version: 3,
    });
  });

  async function createPlayableGame(): Promise<
    Readonly<{
      black: string;
      gameId: string;
      white: string;
    }>
  > {
    const first = await createGuestSession(pool);
    const second = await createGuestSession(pool);
    const game = await allocations.allocate({
      a: first,
      aScore: Date.now() - 1,
      b: second,
      bScore: Date.now(),
      createdAt: Date.now(),
      gameId: randomUUID(),
      matchId: randomUUID(),
      mode: 'blitz',
    });
    const white = game.players.find((player) => player.color === 'w');
    const black = game.players.find((player) => player.color === 'b');
    if (white === undefined || black === undefined) {
      throw new Error('Allocated game does not contain both colors');
    }
    await rooms.ready(game.game.id, white.guestSessionId, 0);
    await rooms.ready(game.game.id, black.guestSessionId, 0);
    const snapshot = await rooms.snapshot(game.game.id, white.guestSessionId);
    return {
      black: black.guestSessionId,
      gameId: snapshot.game.id,
      white: white.guestSessionId,
    };
  }

  function submit(
    game: Readonly<{ black: string; gameId: string; white: string }>,
    color: 'b' | 'w',
    expectedVersion: number,
    clientMoveId: string,
    move: MoveInput,
  ): Promise<MoveSubmission> {
    return moves.submit({
      clientMoveId,
      expectedVersion,
      gameId: game.gameId,
      guestSessionId: color === 'w' ? game.white : game.black,
      move,
    });
  }

  async function auditGame(gameId: string): Promise<
    Readonly<{
      assignments: number;
      commands: number;
      maxPly: number | null;
      minPly: number | null;
      moves: number;
      result: string | null;
      status: string;
      termination: string | null;
      version: number;
    }>
  > {
    const result = await pool.query<{
      assignments: number;
      commands: number;
      maxPly: number | null;
      minPly: number | null;
      moves: number;
      result: string | null;
      status: string;
      termination: string | null;
      version: number;
    }>(
      `
        SELECT
          game.version,
          game.status,
          game.result,
          game.termination,
          (
            SELECT count(*)::int
            FROM moves
            WHERE game_id = game.id
          ) AS moves,
          (
            SELECT count(*)::int
            FROM game_commands
            WHERE game_id = game.id
          ) AS commands,
          (
            SELECT count(*)::int
            FROM active_game_assignments
            WHERE game_id = game.id
          ) AS assignments,
          (
            SELECT min(ply)::int
            FROM moves
            WHERE game_id = game.id
          ) AS "minPly",
          (
            SELECT max(ply)::int
            FROM moves
            WHERE game_id = game.id
          ) AS "maxPly"
        FROM games AS game
        WHERE game.id = $1
      `,
      [gameId],
    );
    const audit = result.rows[0];
    if (audit === undefined) {
      throw new Error('Game audit returned no row');
    }
    return audit;
  }
});

async function expectMoveError(
  action: () => Promise<unknown>,
  code: string,
  authoritativeVersion?: number,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(GameServiceError);
    expect(error).toMatchObject({
      ...(authoritativeVersion === undefined ? {} : { authoritativeVersion }),
      code,
      responseType: 'move.rejected',
    });
    return;
  }
  throw new Error(`Expected move error ${code}`);
}
