import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);

describe('migration status', () => {
  it('is current and has no Prisma-recognized drift after all migrations', async () => {
    const status = await executeFile(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'status'],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    expect(status.stdout).toContain('Database schema is up to date');

    const drift = await executeFile(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    expect(drift.stdout).toContain('No difference detected');
  });
});
