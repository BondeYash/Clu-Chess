import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import type { TestProject } from 'vitest/node';

const executeFile = promisify(execFile);

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

async function deployMigrations(databaseUrl: string): Promise<void> {
  await executeFile(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
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

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16.9-alpine')
      .withDatabase('cluchess')
      .withUsername('cluchess')
      .withPassword('cluchess_test')
      .withStartupTimeout(60_000)
      .start(),
    new GenericContainer('redis:7.4.5-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .withStartupTimeout(60_000)
      .start(),
  ]);

  try {
    const databaseUrl = `${postgres.getConnectionUri()}?schema=public`;
    const redisUrl = connectionUrl(redis);
    await deployMigrations(databaseUrl);
    project.provide('databaseUrl', databaseUrl);
    project.provide('redisUrl', redisUrl);
  } catch (error) {
    await Promise.all([postgres.stop(), redis.stop()]);
    throw error;
  }

  return async (): Promise<void> => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}

function connectionUrl(container: StartedTestContainer): string {
  return `redis://${container.getHost()}:${String(
    container.getMappedPort(6379),
  )}`;
}
