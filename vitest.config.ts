import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'src/common/redis/redis.service.ts',
        'src/generated/**',
        'src/instrumentation.ts',
        'src/main.ts',
        'src/modules/**/**.module.ts',
        'src/modules/persistence/postgres-health.service.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        branches: 75,
        functions: 75,
        lines: 80,
        statements: 80,
      },
    },
    environment: 'node',
    include: ['test/unit/**/*.spec.ts'],
    mockReset: true,
    restoreMocks: true,
    setupFiles: ['test/setup.ts'],
  },
});
