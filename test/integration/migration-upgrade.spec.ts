import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);

async function runPrisma(
  databaseUrl: string,
  arguments_: readonly string[],
): Promise<void> {
  await executeFile(
    process.execPath,
    ['node_modules/prisma/build/index.js', ...arguments_],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: databaseUrl,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

describe('migration upgrade path', () => {
  it('upgrades a Phase 1 database in place and remains migration-clean', async () => {
    const postgres = await new PostgreSqlContainer('postgres:16.9-alpine')
      .withDatabase('cluchess_upgrade')
      .withUsername('cluchess')
      .withPassword('cluchess_test')
      .withStartupTimeout(60_000)
      .start();
    const databaseUrl = `${postgres.getConnectionUri()}?schema=public`;
    const pool = new Pool({ connectionString: databaseUrl });

    try {
      await runPrisma(databaseUrl, [
        'migrate',
        'deploy',
        '--config',
        'test/fixtures/phase-1/prisma.config.ts',
      ]);
      const before = await pool.query<{ migration_name: string }>(
        'SELECT migration_name FROM _prisma_migrations',
      );
      expect(before.rows).toEqual([
        { migration_name: '20260724000000_phase_1_baseline' },
      ]);

      await runPrisma(databaseUrl, ['migrate', 'deploy']);
      await runPrisma(databaseUrl, ['migrate', 'status']);

      const after = await pool.query<{ migration_name: string }>(
        `
            SELECT migration_name
            FROM _prisma_migrations
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
            ORDER BY migration_name
          `,
      );
      expect(after.rows.map((row) => row.migration_name)).toEqual([
        '20260724000000_phase_1_baseline',
        '20260724010000_phase_2_durable_persistence',
      ]);

      const gamesTable = await pool.query<{ name: string | null }>(
        `SELECT to_regclass('public.games')::TEXT AS name`,
      );
      expect(gamesTable.rows[0]?.name).toBe('games');
    } finally {
      await pool.end();
      await postgres.stop();
    }
  }, 90_000);
});
