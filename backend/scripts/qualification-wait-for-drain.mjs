import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import pg from 'pg';

const { Pool } = pg;
const timeoutMs = Number(process.env.QUALIFICATION_DRAIN_TIMEOUT_MS ?? 120_000);
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://cluchess_runtime:cluchess_runtime_dev@postgres:5432/cluchess?schema=public',
  max: 1,
});
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const deadline = Date.now() + timeoutMs;
let observed;

try {
  await redis.connect();
  while (Date.now() < deadline) {
    const [assignments, reservations, queueMembers, graceKeys] =
      await Promise.all([
        pool.query(
          'SELECT COUNT(*)::integer AS count FROM active_game_assignments',
        ),
        scan('match:*:reservation'),
        redis.zcard('mm:queue:blitz'),
        scan('game:*:grace:*'),
      ]);
    observed = {
      activeAssignments: assignments.rows[0].count,
      graceKeys: graceKeys.length,
      queueMembers,
      reservations: reservations.length,
    };
    if (Object.values(observed).every((value) => value === 0)) {
      process.stdout.write(
        `Qualification state drained: ${JSON.stringify(observed)}\n`,
      );
      process.exit(0);
    }
    await delay(500);
  }
  throw new Error(
    `qualification state did not drain within ${timeoutMs}ms: ${JSON.stringify(observed)}`,
  );
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}

async function scan(match) {
  let cursor = '0';
  const keys = [];
  do {
    const response = await redis.scan(cursor, 'MATCH', match, 'COUNT', '500');
    cursor = response[0];
    keys.push(...response[1]);
  } while (cursor !== '0');
  return keys;
}
