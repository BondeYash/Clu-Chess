import { Module } from '@nestjs/common';
import { PostgresHealthService } from './postgres-health.service.js';

@Module({
  exports: [PostgresHealthService],
  providers: [PostgresHealthService],
})
export class PersistenceModule {}
