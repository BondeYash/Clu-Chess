import { Module } from '@nestjs/common';
import { ChessModule } from '../chess/chess.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { GAME_REPOSITORY } from './application/ports/game.repository.js';
import { GAMEPLAY_REPOSITORY } from './application/ports/gameplay.repository.js';
import { GameAllocationService } from './game-allocation.service.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';
import { GameMoveService } from './game-move.service.js';
import { GameRoomService } from './game-room.service.js';
import { PrismaGameRepository } from './infrastructure/prisma-game.repository.js';
import { PrismaGameplayRepository } from './infrastructure/prisma-gameplay.repository.js';

@Module({
  exports: [GameAllocationService, GameMoveService, GameRoomService],
  imports: [ChessModule, PersistenceModule],
  providers: [
    GameAllocationService,
    GameEphemeralStateService,
    GameMoveService,
    GameRoomService,
    PrismaGameRepository,
    PrismaGameplayRepository,
    {
      provide: GAME_REPOSITORY,
      useExisting: PrismaGameRepository,
    },
    {
      provide: GAMEPLAY_REPOSITORY,
      useExisting: PrismaGameplayRepository,
    },
  ],
})
export class GameModule {}
