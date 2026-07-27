import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { SessionModule } from '../session/session.module.js';
import { RecoveryController } from './recovery.controller.js';
import { RecoveryExceptionFilter } from './recovery-exception.filter.js';
import { RecoveryRateLimitService } from './recovery-rate-limit.service.js';

@Module({
  controllers: [RecoveryController],
  imports: [GameModule, SessionModule],
  providers: [RecoveryExceptionFilter, RecoveryRateLimitService],
})
export class RecoveryModule {}
