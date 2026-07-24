import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/integration/**/*.spec.ts'],
    hookTimeout: 30_000,
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
  },
});
