import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import Redis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://cluchess_runtime:cluchess_runtime_dev@postgres:5432/cluchess?schema=public';
const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
const outputPath = resolve(
  process.argv[2] ??
    process.env.QUALIFICATION_AUDIT_OUTPUT ??
    '/evidence/correctness-audit.json',
);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const redis = new Redis(redisUrl, {
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const checks = [];

try {
  await pool.query('SELECT 1');
  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');

  await sqlCheck(
    'sql.no_duplicate_client_move_ids',
    `
      SELECT game_id, client_move_id, COUNT(*)::integer AS occurrences
      FROM moves
      GROUP BY game_id, client_move_id
      HAVING COUNT(*) <> 1
    `,
  );
  await sqlCheck(
    'sql.contiguous_ply_sequences',
    `
      SELECT
        game_id,
        COUNT(*)::integer AS move_count,
        MIN(ply)::integer AS minimum_ply,
        MAX(ply)::integer AS maximum_ply,
        COUNT(DISTINCT ply)::integer AS distinct_plies
      FROM moves
      GROUP BY game_id
      HAVING
        MIN(ply) <> 1
        OR MAX(ply) <> COUNT(*)
        OR COUNT(DISTINCT ply) <> COUNT(*)
    `,
  );
  await sqlCheck(
    'sql.approved_game_version_rule',
    `
      WITH accepted_moves AS (
        SELECT game_id, COUNT(*)::integer AS move_count
        FROM moves
        GROUP BY game_id
      ),
      command_versions AS (
        SELECT game_id, MAX(result_version)::integer AS maximum_command_version
        FROM game_commands
        GROUP BY game_id
      )
      SELECT
        game.id,
        game.version,
        COALESCE(accepted_moves.move_count, 0)::integer AS accepted_move_count,
        (
          game.version - COALESCE(accepted_moves.move_count, 0)
        )::integer AS non_move_version_delta,
        command_versions.maximum_command_version
      FROM games AS game
      LEFT JOIN accepted_moves ON accepted_moves.game_id = game.id
      LEFT JOIN command_versions ON command_versions.game_id = game.id
      WHERE
        game.version < COALESCE(accepted_moves.move_count, 0)
        OR command_versions.maximum_command_version > game.version
    `,
  );
  await sqlCheck(
    'sql.exactly_two_distinct_players_and_colors',
    `
      SELECT
        game.id,
        COUNT(player.id)::integer AS player_count,
        COUNT(DISTINCT player.guest_session_id)::integer AS distinct_players,
        COUNT(DISTINCT player.color)::integer AS distinct_colors
      FROM games AS game
      LEFT JOIN game_players AS player ON player.game_id = game.id
      GROUP BY game.id
      HAVING
        COUNT(player.id) <> 2
        OR COUNT(DISTINCT player.guest_session_id) <> 2
        OR COUNT(DISTINCT player.color) <> 2
    `,
  );
  await sqlCheck(
    'sql.no_multiple_active_assignments',
    `
      SELECT guest_session_id, COUNT(*)::integer AS assignment_count
      FROM active_game_assignments
      GROUP BY guest_session_id
      HAVING COUNT(*) > 1
    `,
  );
  await sqlCheck(
    'sql.active_assignments_reference_active_games',
    `
      SELECT assignment.guest_session_id, assignment.game_id, game.status
      FROM active_game_assignments AS assignment
      JOIN games AS game ON game.id = assignment.game_id
      WHERE game.status NOT IN (
        'CREATED',
        'WAITING_FOR_PLAYERS',
        'READY',
        'IN_PROGRESS',
        'RECONNECTING'
      )
    `,
  );
  await sqlCheck(
    'sql.terminal_games_have_valid_outcome',
    `
      SELECT id, status, result, termination
      FROM games
      WHERE
        status IN ('COMPLETED', 'ABANDONED', 'EXPIRED')
        AND (
          result IS NULL
          OR termination IS NULL
          OR result NOT IN ('1-0', '0-1', '1/2-1/2', '*')
          OR termination NOT IN (
            'CHECKMATE',
            'RESIGNATION',
            'TIMEOUT',
            'STALEMATE',
            'INSUFFICIENT_MATERIAL',
            'THREEFOLD_REPETITION',
            'FIFTY_MOVE_RULE',
            'AGREEMENT',
            'ABANDONMENT',
            'JOIN_TIMEOUT',
            'SYSTEM'
          )
        )
    `,
  );
  await sqlCheck(
    'sql.non_terminal_games_have_no_outcome',
    `
      SELECT id, status, result, termination
      FROM games
      WHERE
        status NOT IN ('COMPLETED', 'ABANDONED', 'EXPIRED')
        AND (result IS NOT NULL OR termination IS NOT NULL)
    `,
  );

  const assignments = new Map(
    (
      await pool.query(
        'SELECT guest_session_id::text, game_id::text FROM active_game_assignments',
      )
    ).rows.map((row) => [row.guest_session_id, row.game_id]),
  );
  const durableGrace = new Map(
    (
      await pool.query(`
        SELECT
          game_id::text,
          guest_session_id::text,
          FLOOR(EXTRACT(EPOCH FROM reconnect_grace_ends_at) * 1000)::bigint::text AS deadline_ms
        FROM game_players
        WHERE reconnect_grace_ends_at > clock_timestamp()
      `)
    ).rows.map((row) => [
      `game:${row.game_id}:grace:${row.guest_session_id}`,
      Number(row.deadline_ms),
    ]),
  );

  await redisReservationAudit();
  await redisQueueAudit();
  await redisActiveStateAudit(assignments);
  await redisGraceAudit(durableGrace);
  await redisStreamAudit();
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}

const failed = checks.filter((check) => !check.ok);
const report = {
  checks,
  failed: failed.length,
  generatedAt: new Date().toISOString(),
  passed: checks.length - failed.length,
  schemaVersion: 1,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed.length > 0) {
  process.exitCode = 1;
}

async function sqlCheck(name, statement) {
  const result = await pool.query(statement);
  record(name, result.rows.length === 0, {
    violations: result.rows.length,
    examples: result.rows.slice(0, 10),
  });
}

async function redisReservationAudit() {
  const keys = await scan('match:*:reservation');
  const violations = [];
  for (const key of keys) {
    const [ttl, values] = await Promise.all([
      redis.pttl(key),
      redis.hgetall(key),
    ]);
    if (
      ttl <= 0 ||
      values.a === undefined ||
      values.b === undefined ||
      values.gameId === undefined ||
      values.matchId === undefined
    ) {
      violations.push({ key, ttl });
    }
  }
  record(
    'redis.reservations_are_bounded_and_well_formed',
    violations.length === 0,
    {
      inspected: keys.length,
      violations: violations.slice(0, 10),
    },
  );
}

async function redisQueueAudit() {
  const guardKeys = await scan('mm:queued:*');
  const violations = [];
  for (const key of guardKeys) {
    const guestId = key.slice('mm:queued:'.length);
    const [mode, ttl, state] = await Promise.all([
      redis.get(key),
      redis.pttl(key),
      redis.get(`user:${guestId}:state`),
    ]);
    const score =
      mode === null ? null : await redis.zscore(`mm:queue:${mode}`, guestId);
    if (ttl <= 0 || mode !== 'blitz' || state !== 'QUEUED' || score === null) {
      violations.push({ guestId, mode, score, state, ttl });
    }
  }
  const queuedGuests = await redis.zrange('mm:queue:blitz', 0, -1);
  for (const guestId of queuedGuests) {
    if (!(await redis.exists(`mm:queued:${guestId}`))) {
      violations.push({ guestId, reason: 'queue member has no guard' });
    }
  }
  record(
    'redis.queue_guards_match_queue_and_user_state',
    violations.length === 0,
    {
      guards: guardKeys.length,
      queueMembers: queuedGuests.length,
      violations: violations.slice(0, 10),
    },
  );
}

async function redisActiveStateAudit(assignments) {
  const activeKeys = await scan('user:*:active-game');
  const stateKeys = await scan('user:*:state');
  const violations = [];
  for (const key of activeKeys) {
    const guestId = key.slice('user:'.length, -':active-game'.length);
    const [gameId, state] = await Promise.all([
      redis.get(key),
      redis.get(`user:${guestId}:state`),
    ]);
    if (gameId !== assignments.get(guestId) || state !== 'IN_GAME') {
      violations.push({
        durableGameId: assignments.get(guestId) ?? null,
        gameId,
        guestId,
        state,
      });
    }
  }
  for (const [guestId, gameId] of assignments) {
    const [cachedGameId, state] = await Promise.all([
      redis.get(`user:${guestId}:active-game`),
      redis.get(`user:${guestId}:state`),
    ]);
    if (cachedGameId !== gameId || state !== 'IN_GAME') {
      violations.push({ cachedGameId, gameId, guestId, state });
    }
  }
  for (const key of stateKeys) {
    const guestId = key.slice('user:'.length, -':state'.length);
    const state = await redis.get(key);
    if (!['IDLE', 'QUEUED', 'RESERVED', 'IN_GAME'].includes(state)) {
      violations.push({ guestId, reason: 'invalid state', state });
    }
  }
  record(
    'redis.active_games_and_user_states_match_postgresql',
    violations.length === 0,
    {
      activeAssignments: assignments.size,
      activeKeys: activeKeys.length,
      stateKeys: stateKeys.length,
      violations: violations.slice(0, 10),
    },
  );
}

async function redisGraceAudit(durableGrace) {
  const keys = await scan('game:*:grace:*');
  const violations = [];
  for (const key of keys) {
    const [ttl, value] = await Promise.all([redis.pttl(key), redis.get(key)]);
    const expected = durableGrace.get(key);
    if (
      ttl <= 0 ||
      expected === undefined ||
      value === null ||
      Math.abs(Number(value) - expected) > 1000
    ) {
      violations.push({ expected: expected ?? null, key, ttl, value });
    }
  }
  for (const [key, deadline] of durableGrace) {
    if (!(await redis.exists(key))) {
      violations.push({
        deadline,
        key,
        reason: 'durable grace has no Redis key',
      });
    }
  }
  record('redis.grace_keys_match_durable_deadlines', violations.length === 0, {
    durableGrace: durableGrace.size,
    keys: keys.length,
    violations: violations.slice(0, 10),
  });
}

async function redisStreamAudit() {
  const exists = await redis.exists('cluchess:socket.io');
  const length = exists ? await redis.xlen('cluchess:socket.io') : 0;
  record('redis.socket_stream_is_bounded', length <= 10_000, {
    maximum: 10_000,
    observed: length,
  });
}

async function scan(match) {
  let cursor = '0';
  const keys = [];
  do {
    const response = await redis.scan(cursor, 'MATCH', match, 'COUNT', '500');
    cursor = response[0];
    keys.push(...response[1]);
  } while (cursor !== '0');
  return keys.sort();
}

function record(name, ok, details) {
  checks.push({ details, name, ok });
}
