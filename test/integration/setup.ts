import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.MIGRATION_DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.DATABASE_POOL_MAX = '5';
process.env.DATABASE_TX_TIMEOUT_MS = '3000';
process.env.DRAIN_TIMEOUT_MS = '4000';
process.env.JOB_MATCH_DRAIN_MS = '60000';
process.env.JOB_QUEUE_SWEEP_MS = '60000';
process.env.JOB_RESERVATION_RECONCILE_MS = '60000';
process.env.JOB_ACTIVE_DRIFT_MS = '60000';
process.env.RL_CONNECTIONS_PER_IP = '2';
process.env.SOCKET_RECOVERY_MAX_DISCONNECTION_MS = '5000';
