import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  imports: [PersistenceModule],
})
export class HealthModule {}
