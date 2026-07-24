import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['test/integration/global-setup.ts'],
    include: ['test/integration/**/*.spec.ts'],
    hookTimeout: 60_000,
    pool: 'forks',
    setupFiles: ['test/integration/setup.ts', 'test/setup.ts'],
    testTimeout: 30_000,
  },
});
