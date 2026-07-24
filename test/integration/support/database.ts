import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

interface Queryable {
  query: Pool['query'];
}

export interface AllocatedGame {
  gameId: string;
  guestSessionIds: readonly [string, string];
  matchId: string;
}

export function createPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error('Integration database URL was not provided');
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    options: '-c timezone=UTC -c statement_timeout=5000',
  });
}

export async function truncateApplicationTables(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE games, guest_sessions CASCADE');
}

export async function createGuestSession(
  queryable: Queryable,
  label: string = randomUUID(),
): Promise<string> {
  const result = await queryable.query<{ id: string }>(
    `
      INSERT INTO guest_sessions (
        display_name,
        avatar_key,
        current_jti,
        expires_at
      )
      VALUES ($1, 'pawn', gen_random_uuid(), clock_timestamp() + interval '1 day')
      RETURNING id
    `,
    [`guest-${label}`],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('Guest session insert returned no identifier');
  }
  return id;
}

export async function allocateGame(
  pool: Pool,
  options: {
    guestSessionIds?: readonly [string, string];
    matchId?: string;
  } = {},
): Promise<AllocatedGame> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const guestSessionIds =
      options.guestSessionIds ??
      ([
        await createGuestSession(client),
        await createGuestSession(client),
      ] as const);
    const matchId = options.matchId ?? randomUUID();
    const gameId = await insertGameAggregate(client, matchId, guestSessionIds);
    await client.query('COMMIT');
    return { gameId, guestSessionIds, matchId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function insertGameAggregate(
  client: PoolClient,
  matchId: string,
  guestSessionIds: readonly [string, string],
): Promise<string> {
  const gameResult = await client.query<{ id: string }>(
    `
      INSERT INTO games (
        match_id,
        initial_fen,
        current_fen,
        time_initial_ms,
        increment_ms,
        white_clock_ms,
        black_clock_ms
      )
      VALUES ($1, $2, $2, 300000, 2000, 300000, 300000)
      RETURNING id
    `,
    [matchId, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  );
  const gameId = gameResult.rows[0]?.id;
  if (gameId === undefined) {
    throw new Error('Game insert returned no identifier');
  }

  await client.query(
    `
      INSERT INTO game_players (
        game_id,
        guest_session_id,
        color,
        slot
      )
      VALUES
        ($1, $2, 'w', 0),
        ($1, $3, 'b', 1)
    `,
    [gameId, guestSessionIds[0], guestSessionIds[1]],
  );

  const sortedGuestIds = [...guestSessionIds].sort();
  await client.query(
    `
      INSERT INTO active_game_assignments (guest_session_id, game_id)
      VALUES ($1, $3), ($2, $3)
    `,
    [sortedGuestIds[0], sortedGuestIds[1], gameId],
  );

  return gameId;
}
