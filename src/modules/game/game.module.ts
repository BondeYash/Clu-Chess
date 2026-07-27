import { Module } from '@nestjs/common';
import { ChessModule } from '../chess/chess.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { GAME_REPOSITORY } from './application/ports/game.repository.js';
import { GameAllocationService } from './game-allocation.service.js';
import { GameRoomService } from './game-room.service.js';
import { PrismaGameRepository } from './infrastructure/prisma-game.repository.js';

@Module({
  exports: [GameAllocationService, GameRoomService],
  imports: [ChessModule, PersistenceModule],
  providers: [
    GameAllocationService,
    GameRoomService,
    PrismaGameRepository,
    {
      provide: GAME_REPOSITORY,
      useExisting: PrismaGameRepository,
    },
  ],
})
export class GameModule {}
