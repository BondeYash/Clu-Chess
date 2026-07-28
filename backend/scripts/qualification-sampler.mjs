import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;
const outputPath = resolve(process.argv[2] ?? '/evidence/samples.ndjson');
const intervalMs = Number(process.env.QUALIFICATION_SAMPLE_INTERVAL_MS ?? 5000);
const maximumDurationMs = Number(
  process.env.QUALIFICATION_SAMPLE_DURATION_MS ?? 7_200_000,
);
const appUrls = (
  process.env.QUALIFICATION_APP_URLS ?? 'http://app-a:3000,http://app-b:3000'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const token = (
  await readFile(
    process.env.METRICS_BEARER_TOKEN_FILE ??
      '/run/secrets/cluchess/metrics-token',
    'utf8',
  )
).trim();
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
let stopping = false;
process.once('SIGINT', () => {
  stopping = true;
});
process.once('SIGTERM', () => {
  stopping = true;
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, '', { mode: 0o600 });
await redis.connect();
const deadline = Date.now() + maximumDurationMs;
try {
  while (!stopping && Date.now() < deadline) {
    const sampleStartedAt = Date.now();
    try {
      const [applications, database, redisInfo, streamLength, nginx] =
        await Promise.all([
          Promise.all(
            appUrls.map(async (url) => ({
              metrics: await fetchText(`${url}/metrics`, {
                Authorization: `Bearer ${token}`,
              }),
              url,
            })),
          ),
          pool.query(`
            SELECT
              (SELECT COUNT(*)::integer FROM games WHERE status IN (
                'CREATED',
                'WAITING_FOR_PLAYERS',
                'READY',
                'IN_PROGRESS',
                'RECONNECTING'
              )) AS active_games,
              (SELECT COUNT(*)::integer FROM active_game_assignments) AS active_assignments,
              (
                SELECT COUNT(*)::integer
                FROM pg_stat_activity
                WHERE datname = current_database()
              ) AS database_connections
          `),
          redis.info(),
          redis
            .exists('cluchess:socket.io')
            .then((exists) => (exists ? redis.xlen('cluchess:socket.io') : 0)),
          fetchText(
            process.env.QUALIFICATION_NGINX_STATUS_URL ??
              'http://nginx:8080/nginx_status',
          ),
        ]);
      await appendFile(
        outputPath,
        `${JSON.stringify({
          applications,
          capturedAt: new Date().toISOString(),
          nginx,
          postgres: database.rows[0],
          redis: {
            ...parseRedisInfo(redisInfo),
            socketStreamLength: streamLength,
          },
          schemaVersion: 1,
        })}\n`,
        { mode: 0o600 },
      );
    } catch (error) {
      await appendFile(
        outputPath,
        `${JSON.stringify({
          capturedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          schemaVersion: 1,
        })}\n`,
        { mode: 0o600 },
      );
    }
    await delay(Math.max(1, intervalMs - (Date.now() - sampleStartedAt)));
  }
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}

async function fetchText(url, headers = {}) {
  const response = await globalThis.fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

function parseRedisInfo(value) {
  const wanted = new Set([
    'connected_clients',
    'used_memory',
    'used_memory_peak',
    'instantaneous_ops_per_sec',
    'total_commands_processed',
    'evicted_keys',
    'rejected_connections',
  ]);
  return Object.fromEntries(
    value
      .split(/\r?\n/u)
      .filter((line) => !line.startsWith('#') && line.includes(':'))
      .map((line) => line.split(':', 2))
      .filter(([key]) => wanted.has(key))
      .map(([key, raw]) => [key, Number(raw)]),
  );
}
