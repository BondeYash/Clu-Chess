import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  allocateGame,
  createGuestSession,
  createPool,
  insertGameAggregate,
  truncateApplicationTables,
} from './support/database.js';

interface DatabaseFailure {
  code?: string;
  constraint?: string;
}

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expectedCode: string,
  expectedConstraint?: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const failure = error as DatabaseFailure;
    expect(failure.code).toBe(expectedCode);
    if (expectedConstraint !== undefined) {
      expect(failure.constraint).toBe(expectedConstraint);
    }
    return;
  }

  throw new Error(`Expected PostgreSQL error ${expectedCode}`);
}

describe('durable persistence constraints', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool();
  });

  beforeEach(async () => {
    await truncateApplicationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has the complete clean-database migration history and durable tables', async () => {
    const migrations = await pool.query<{ migration_name: string }>(
      `
        SELECT migration_name
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY migration_name
      `,
    );
    expect(migrations.rows.map((row) => row.migration_name)).toEqual([
      '20260724000000_phase_1_baseline',
      '20260724010000_phase_2_durable_persistence',
    ]);

    const tables = await pool.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'active_game_assignments',
            'game_commands',
            'game_players',
            'games',
            'guest_sessions',
            'moves',
            'session_commands'
          )
        ORDER BY table_name
      `,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'active_game_assignments',
      'game_commands',
      'game_players',
      'games',
      'guest_sessions',
      'moves',
      'session_commands',
    ]);
  });

  it('enforces case-insensitive display-name uniqueness', async () => {
    await createGuestSession(pool, 'Alice');
    await expectDatabaseFailure(
      createGuestSession(pool, 'ALICE'),
      '23505',
      'guest_sessions_display_name_ci_key',
    );
  });

  it('rejects invalid guest-session timing', async () => {
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO guest_sessions (
            display_name,
            avatar_key,
            issued_at,
            expires_at
          )
          VALUES ('expired', 'pawn', now(), now())
        `,
      ),
      '23514',
      'guest_sessions_expires_after_issued_check',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO guest_sessions (
            display_name,
            avatar_key,
            issued_at,
            expires_at,
            revoked_at
          )
          VALUES (
            'revoked-too-early',
            'pawn',
            now(),
            now() + interval '1 day',
            now() - interval '1 second'
          )
        `,
      ),
      '23514',
      'guest_sessions_revoked_after_issued_check',
    );
  });

  it('rejects a partial game aggregate at commit', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO games (
            match_id,
            initial_fen,
            current_fen,
            time_initial_ms,
            white_clock_ms,
            black_clock_ms
          )
          VALUES (gen_random_uuid(), 'initial', 'initial', 300000, 300000, 300000)
        `,
      );
      await expectDatabaseFailure(
        client.query('COMMIT'),
        '23514',
        'games_exactly_two_players_check',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM games',
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('commits a complete two-player allocation atomically', async () => {
    const allocation = await allocateGame(pool);
    const counts = await pool.query<{
      assignments: string;
      players: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM game_players WHERE game_id = $1) AS players,
          (
            SELECT count(*)
            FROM active_game_assignments
            WHERE game_id = $1
          ) AS assignments
      `,
      [allocation.gameId],
    );

    expect(counts.rows[0]).toEqual({ assignments: '2', players: '2' });
  });

  it('allows only one concurrent active game for a guest', async () => {
    const commonGuest = await createGuestSession(pool, 'common');
    const opponentOne = await createGuestSession(pool, 'opponent-one');
    const opponentTwo = await createGuestSession(pool, 'opponent-two');

    const results = await Promise.allSettled([
      allocateGame(pool, {
        guestSessionIds: [commonGuest, opponentOne],
      }),
      allocateGame(pool, {
        guestSessionIds: [commonGuest, opponentTwo],
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected === undefined) {
      throw new Error('Expected one allocation to be rejected');
    }
    expect(rejected.reason).toMatchObject({
      code: '23505',
      constraint: 'active_game_assignments_pkey',
    });

    const games = await pool.query<{ count: string }>(
      'SELECT count(*) FROM games',
    );
    const commonAssignments = await pool.query<{ count: string }>(
      `
        SELECT count(*)
        FROM active_game_assignments
        WHERE guest_session_id = $1
      `,
      [commonGuest],
    );
    expect(games.rows[0]?.count).toBe('1');
    expect(commonAssignments.rows[0]?.count).toBe('1');
  });

  it('deduplicates match allocation by match ID', async () => {
    const matchId = randomUUID();
    await allocateGame(pool, { matchId });

    await expectDatabaseFailure(
      allocateGame(pool, { matchId }),
      '23505',
      'games_match_id_key',
    );
    const games = await pool.query<{ count: string }>(
      'SELECT count(*) FROM games WHERE match_id = $1',
      [matchId],
    );
    expect(games.rows[0]?.count).toBe('1');
  });

  it('deduplicates moves by client move ID and by ply', async () => {
    const allocation = await allocateGame(pool);
    const clientMoveId = randomUUID();
    const insertMove = async (moveId: string, ply: number): Promise<void> => {
      await pool.query(
        `
          INSERT INTO moves (
            game_id,
            ply,
            client_move_id,
            guest_session_id,
            color,
            san,
            uci,
            fen_before,
            fen_after,
            server_received_at
          )
          VALUES ($1, $2, $3, $4, 'w', 'e4', 'e2e4', 'before', 'after', now())
        `,
        [allocation.gameId, ply, moveId, allocation.guestSessionIds[0]],
      );
    };

    await insertMove(clientMoveId, 1);
    await expectDatabaseFailure(
      insertMove(clientMoveId, 2),
      '23505',
      'moves_game_id_client_move_id_key',
    );
    await expectDatabaseFailure(
      insertMove(randomUUID(), 1),
      '23505',
      'moves_game_id_ply_key',
    );
  });

  it('enforces game scalar and state-machine checks', async () => {
    const allocation = await allocateGame(pool);
    const invalidUpdates = [
      ["mode = 'CLASSICAL'", 'games_mode_check'],
      ["status = 'UNKNOWN'", 'games_status_check'],
      ["turn_color = 'x'", 'games_turn_color_check'],
      ['version = -1', 'games_version_check'],
      ['time_initial_ms = 0', 'games_time_initial_ms_check'],
      ['increment_ms = -1', 'games_increment_ms_check'],
      ['white_clock_ms = -1', 'games_white_clock_ms_check'],
      ['black_clock_ms = -1', 'games_black_clock_ms_check'],
      ["result = 'invalid'", 'games_result_check'],
      [
        `
          status = 'COMPLETED',
          result = '1-0',
          termination = 'invalid',
          ended_at = now()
        `,
        'games_termination_check',
      ],
      ['turn_started_at = now()', 'games_turn_clock_state_check'],
      [
        `
          status = 'COMPLETED',
          result = '1-0',
          termination = 'CHECKMATE',
          started_at = now() + interval '1 minute',
          ended_at = now()
        `,
        'games_ended_after_started_check',
      ],
    ] as const;

    for (const [assignment, constraint] of invalidUpdates) {
      await expectDatabaseFailure(
        pool.query(`UPDATE games SET ${assignment} WHERE id = $1`, [
          allocation.gameId,
        ]),
        '23514',
        constraint,
      );
    }
  });

  it('enforces player shape and per-game uniqueness', async () => {
    const allocation = await allocateGame(pool);
    const players = await pool.query<{
      color: string;
      guest_session_id: string;
      id: string;
    }>(
      `
        SELECT id, color, guest_session_id
        FROM game_players
        WHERE game_id = $1
        ORDER BY slot
      `,
      [allocation.gameId],
    );
    const white = players.rows[0];
    const black = players.rows[1];
    if (white === undefined || black === undefined) {
      throw new Error('Expected two persisted game players');
    }

    await expectDatabaseFailure(
      pool.query("UPDATE game_players SET color = 'x' WHERE id = $1", [
        white.id,
      ]),
      '23514',
      'game_players_color_check',
    );
    await expectDatabaseFailure(
      pool.query('UPDATE game_players SET slot = 2 WHERE id = $1', [white.id]),
      '23514',
      'game_players_slot_check',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          UPDATE game_players
          SET reconnect_grace_ends_at = now()
          WHERE id = $1
        `,
        [white.id],
      ),
      '23514',
      'game_players_disconnect_state_check',
    );
    await expectDatabaseFailure(
      pool.query("UPDATE game_players SET color = 'w' WHERE id = $1", [
        black.id,
      ]),
      '23505',
      'game_players_game_id_color_key',
    );
    await expectDatabaseFailure(
      pool.query('UPDATE game_players SET slot = 0 WHERE id = $1', [black.id]),
      '23505',
      'game_players_game_id_slot_key',
    );
    await expectDatabaseFailure(
      pool.query(
        'UPDATE game_players SET guest_session_id = $1 WHERE id = $2',
        [white.guest_session_id, black.id],
      ),
      '23505',
      'game_players_game_id_guest_session_id_key',
    );
  });

  it('enforces move and durable-command checks and idempotency', async () => {
    const allocation = await allocateGame(pool);
    const guestId = allocation.guestSessionIds[0];

    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO moves (
            game_id,
            ply,
            client_move_id,
            guest_session_id,
            color,
            san,
            uci,
            fen_before,
            fen_after,
            server_received_at
          )
          VALUES ($1, 0, gen_random_uuid(), $2, 'w', '', '', '', '', now())
        `,
        [allocation.gameId, guestId],
      ),
      '23514',
      'moves_ply_check',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO moves (
            game_id,
            ply,
            client_move_id,
            guest_session_id,
            color,
            san,
            uci,
            fen_before,
            fen_after,
            server_received_at
          )
          VALUES ($1, 1, gen_random_uuid(), $2, 'x', '', '', '', '', now())
        `,
        [allocation.gameId, guestId],
      ),
      '23514',
      'moves_color_check',
    );

    await pool.query(
      `
        INSERT INTO session_commands (
          command_type,
          idempotency_hash,
          guest_session_id
        )
        VALUES ('CREATE', 'session-key', $1)
      `,
      [guestId],
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO session_commands (
            command_type,
            idempotency_hash,
            guest_session_id
          )
          VALUES ('CREATE', 'session-key', $1)
        `,
        [guestId],
      ),
      '23505',
      'session_commands_idempotency_hash_key',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO session_commands (
            command_type,
            idempotency_hash,
            guest_session_id
          )
          VALUES ('INVALID', 'invalid-command', $1)
        `,
        [guestId],
      ),
      '23514',
      'session_commands_command_type_check',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO session_commands (
            command_type,
            idempotency_hash,
            guest_session_id,
            issued_jti
          )
          VALUES ('RENEW', 'partial-claims', $1, gen_random_uuid())
        `,
        [guestId],
      ),
      '23514',
      'session_commands_issued_claims_check',
    );

    const eventId = randomUUID();
    await pool.query(
      `
        INSERT INTO game_commands (
          game_id,
          guest_session_id,
          event_id,
          command_type,
          result_version,
          response
        )
        VALUES ($1, $2, $3, 'MOVE', 1, '{}')
      `,
      [allocation.gameId, guestId, eventId],
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO game_commands (
            game_id,
            guest_session_id,
            event_id,
            command_type,
            result_version,
            response
          )
          VALUES ($1, $2, $3, 'MOVE', 1, '{}')
        `,
        [allocation.gameId, guestId, eventId],
      ),
      '23505',
      'game_commands_game_id_event_id_key',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO game_commands (
            game_id,
            guest_session_id,
            event_id,
            command_type,
            result_version,
            response
          )
          VALUES ($1, $2, gen_random_uuid(), 'INVALID', 1, '{}')
        `,
        [allocation.gameId, guestId],
      ),
      '23514',
      'game_commands_command_type_check',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO game_commands (
            game_id,
            guest_session_id,
            event_id,
            command_type,
            result_version,
            response
          )
          VALUES ($1, $2, gen_random_uuid(), 'MOVE', -1, '{}')
        `,
        [allocation.gameId, guestId],
      ),
      '23514',
      'game_commands_result_version_check',
    );
    await expectDatabaseFailure(
      pool.query(
        `
          INSERT INTO game_commands (
            game_id,
            guest_session_id,
            event_id,
            command_type,
            result_version,
            response
          )
          VALUES ($1, $2, gen_random_uuid(), 'MOVE', 1, '[]')
        `,
        [allocation.gameId, guestId],
      ),
      '23514',
      'game_commands_response_object_check',
    );
  });

  it('rejects invalid terminal state and removes assignments atomically on termination', async () => {
    const allocation = await allocateGame(pool);
    await expectDatabaseFailure(
      pool.query(
        `
          UPDATE games
          SET status = 'COMPLETED'
          WHERE id = $1
        `,
        [allocation.gameId],
      ),
      '23514',
      'games_terminal_state_check',
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
          UPDATE games
          SET
            status = 'COMPLETED',
            result = '1-0',
            termination = 'CHECKMATE',
            ended_at = clock_timestamp()
          WHERE id = $1
        `,
        [allocation.gameId],
      );
      await client.query(
        'DELETE FROM active_game_assignments WHERE game_id = $1',
        [allocation.gameId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const assignments = await pool.query<{ count: string }>(
      'SELECT count(*) FROM active_game_assignments WHERE game_id = $1',
      [allocation.gameId],
    );
    expect(assignments.rows[0]?.count).toBe('0');
  });

  it('restricts guest deletion and cascades owned game data', async () => {
    const allocation = await allocateGame(pool);
    await pool.query(
      `
        INSERT INTO moves (
          game_id,
          ply,
          client_move_id,
          guest_session_id,
          color,
          san,
          uci,
          fen_before,
          fen_after,
          server_received_at
        )
        VALUES ($1, 1, gen_random_uuid(), $2, 'w', 'e4', 'e2e4', '', '', now())
      `,
      [allocation.gameId, allocation.guestSessionIds[0]],
    );
    await pool.query(
      `
        INSERT INTO game_commands (
          game_id,
          guest_session_id,
          event_id,
          command_type,
          result_version,
          response
        )
        VALUES ($1, $2, gen_random_uuid(), 'MOVE', 1, '{}')
      `,
      [allocation.gameId, allocation.guestSessionIds[0]],
    );

    await expectDatabaseFailure(
      pool.query('DELETE FROM guest_sessions WHERE id = $1', [
        allocation.guestSessionIds[0],
      ]),
      '23503',
    );
    await pool.query('DELETE FROM games WHERE id = $1', [allocation.gameId]);

    const relatedRows = await pool.query<{
      assignments: string;
      commands: string;
      moves: string;
      players: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM game_players WHERE game_id = $1) AS players,
          (
            SELECT count(*)
            FROM active_game_assignments
            WHERE game_id = $1
          ) AS assignments,
          (SELECT count(*) FROM moves WHERE game_id = $1) AS moves,
          (SELECT count(*) FROM game_commands WHERE game_id = $1) AS commands
      `,
      [allocation.gameId],
    );
    expect(relatedRows.rows[0]).toEqual({
      assignments: '0',
      commands: '0',
      moves: '0',
      players: '0',
    });
    const guests = await pool.query<{ count: string }>(
      'SELECT count(*) FROM guest_sessions',
    );
    expect(guests.rows[0]?.count).toBe('2');
  });

  it('rolls back the aggregate when a child constraint fails', async () => {
    const guestOne = await createGuestSession(pool, 'rollback-one');
    const guestTwo = await createGuestSession(pool, 'rollback-two');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const gameId = await insertGameAggregate(client, randomUUID(), [
        guestOne,
        guestTwo,
      ]);
      await expectDatabaseFailure(
        client.query(
          `
            INSERT INTO moves (
              game_id,
              ply,
              client_move_id,
              guest_session_id,
              color,
              san,
              uci,
              fen_before,
              fen_after,
              server_received_at
            )
            VALUES ($1, 0, gen_random_uuid(), $2, 'w', '', '', '', '', now())
          `,
          [gameId, guestOne],
        ),
        '23514',
        'moves_ply_check',
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const games = await pool.query<{ count: string }>(
      'SELECT count(*) FROM games',
    );
    expect(games.rows[0]?.count).toBe('0');
  });
});
