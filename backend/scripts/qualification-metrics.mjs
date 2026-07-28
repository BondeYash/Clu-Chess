import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import Redis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;
const outputPath = resolve(
  process.argv[2] ??
    process.env.QUALIFICATION_METRICS_OUTPUT ??
    '/evidence/metrics.json',
);
const tokenPath =
  process.env.METRICS_BEARER_TOKEN_FILE ??
  '/run/secrets/cluchess/metrics-token';
const token = (await readFile(tokenPath, 'utf8')).trim();
const appUrls = (
  process.env.QUALIFICATION_APP_URLS ?? 'http://app-a:3000,http://app-b:3000'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://cluchess_runtime:cluchess_runtime_dev@postgres:5432/cluchess?schema=public',
  max: 1,
});
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

try {
  await redis.connect();
  const [applications, nginx, redisInfo, postgres] = await Promise.all([
    Promise.all(appUrls.map(readApplicationMetrics)),
    fetchText(
      process.env.QUALIFICATION_NGINX_STATUS_URL ??
        'http://nginx:8080/nginx_status',
    ),
    redis.info(),
    readPostgresMetrics(),
  ]);
  const report = {
    applications,
    capturedAt: new Date().toISOString(),
    nginx,
    postgres,
    redis: parseRedisInfo(redisInfo),
    schemaVersion: 1,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`Qualification metrics written to ${outputPath}\n`);
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}

async function readApplicationMetrics(baseUrl) {
  return {
    baseUrl,
    metrics: await fetchText(`${baseUrl}/metrics`, {
      Authorization: `Bearer ${token}`,
    }),
  };
}

async function readPostgresMetrics() {
  const [database, activity, games] = await Promise.all([
    pool.query(`
      SELECT
        datname,
        numbackends::integer,
        xact_commit::bigint::text,
        xact_rollback::bigint::text,
        blks_read::bigint::text,
        blks_hit::bigint::text,
        tup_inserted::bigint::text,
        tup_updated::bigint::text,
        tup_deleted::bigint::text
      FROM pg_stat_database
      WHERE datname = current_database()
    `),
    pool.query(`
      SELECT state, COUNT(*)::integer AS connections
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
      ORDER BY state NULLS FIRST
    `),
    pool.query(`
      SELECT
        COUNT(*)::integer AS games,
        COUNT(*) FILTER (WHERE status IN (
          'CREATED',
          'WAITING_FOR_PLAYERS',
          'READY',
          'IN_PROGRESS',
          'RECONNECTING'
        ))::integer AS active_games,
        COALESCE(SUM(version), 0)::bigint::text AS total_versions
      FROM games
    `),
  ]);
  return {
    activity: activity.rows,
    database: database.rows[0] ?? null,
    games: games.rows[0] ?? null,
  };
}

async function fetchText(url, headers = {}) {
  const response = await globalThis.fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return body;
}

function parseRedisInfo(value) {
  const wanted = new Set([
    'connected_clients',
    'used_memory',
    'used_memory_peak',
    'instantaneous_ops_per_sec',
    'total_commands_processed',
    'keyspace_hits',
    'keyspace_misses',
    'expired_keys',
    'evicted_keys',
    'rejected_connections',
  ]);
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('#') && line.includes(':'))
      .map((line) => line.split(':', 2))
      .filter(([key]) => wanted.has(key)),
  );
}
