import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.MIGRATION_DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.DATABASE_POOL_MAX = '5';
process.env.DATABASE_TX_TIMEOUT_MS = '3000';
process.env.DRAIN_TIMEOUT_MS = '4000';
