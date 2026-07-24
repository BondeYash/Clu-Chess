import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

function createClientOptions(
  config: AppConfigService,
  logger: Logger,
): Prisma.PrismaClientOptions {
  const timeoutMs = config.values.DATABASE_TX_TIMEOUT_MS;
  const pool = new Pool({
    connectionString: config.values.DATABASE_URL,
    connectionTimeoutMillis: 1500,
    idleTimeoutMillis: 30_000,
    max: config.values.DATABASE_POOL_MAX,
    options: `-c timezone=UTC -c statement_timeout=${String(timeoutMs)}`,
  });
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onConnectionError: () => {
      logger.error('PostgreSQL connection error');
    },
    onPoolError: () => {
      logger.error('PostgreSQL idle client error');
    },
    schema: 'public',
  });

  return {
    adapter,
    errorFormat: config.isProduction ? 'minimal' : 'pretty',
    transactionOptions: {
      maxWait: timeoutMs,
      timeout: timeoutMs,
    },
  };
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: AppConfigService) {
    const logger = new Logger(PrismaService.name);
    super(createClientOptions(config, logger));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
