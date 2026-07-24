import { Module } from '@nestjs/common';
import { PostgresHealthService } from './postgres-health.service.js';
import { PrismaService } from './prisma.service.js';
import { TransactionService } from './transaction.service.js';

@Module({
  exports: [PostgresHealthService, PrismaService, TransactionService],
  providers: [PostgresHealthService, PrismaService, TransactionService],
})
export class PersistenceModule {}
