import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { MatchmakingScriptService } from './infrastructure/matchmaking-script.service.js';
import { MatchmakingService } from './matchmaking.service.js';

@Module({
  exports: [MatchmakingService],
  imports: [GameModule, PresenceModule],
  providers: [MatchmakingScriptService, MatchmakingService],
})
export class MatchmakingModule {}
