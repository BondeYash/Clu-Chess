import { Module } from '@nestjs/common';
import { ChessModule } from '../chess/chess.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { GAME_LIFECYCLE_REPOSITORY } from './application/ports/game-lifecycle.repository.js';
import { GAME_REPOSITORY } from './application/ports/game.repository.js';
import { GAMEPLAY_REPOSITORY } from './application/ports/gameplay.repository.js';
import { GameAllocationService } from './game-allocation.service.js';
import { GameDeadlineService } from './game-deadline.service.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';
import { GameLifecycleDeliveryRegistry } from './game-lifecycle-delivery.registry.js';
import { GameLifecycleService } from './game-lifecycle.service.js';
import { GameMoveService } from './game-move.service.js';
import { GameReconciliationService } from './game-reconciliation.service.js';
import { GameRecoveryService } from './game-recovery.service.js';
import { GameRoomService } from './game-room.service.js';
import { GameSnapshotPresenter } from './game-snapshot.presenter.js';
import { PrismaGameLifecycleRepository } from './infrastructure/prisma-game-lifecycle.repository.js';
import { PrismaGameRepository } from './infrastructure/prisma-game.repository.js';
import { PrismaGameplayRepository } from './infrastructure/prisma-gameplay.repository.js';

@Module({
  exports: [
    GameAllocationService,
    GameDeadlineService,
    GameLifecycleDeliveryRegistry,
    GameLifecycleService,
    GameMoveService,
    GameRecoveryService,
    GameReconciliationService,
    GameRoomService,
    GameSnapshotPresenter,
  ],
  imports: [ChessModule, PersistenceModule, PresenceModule],
  providers: [
    GameAllocationService,
    GameDeadlineService,
    GameEphemeralStateService,
    GameLifecycleDeliveryRegistry,
    GameLifecycleService,
    GameMoveService,
    GameRecoveryService,
    GameReconciliationService,
    GameRoomService,
    GameSnapshotPresenter,
    PrismaGameLifecycleRepository,
    PrismaGameRepository,
    PrismaGameplayRepository,
    {
      provide: GAME_LIFECYCLE_REPOSITORY,
      useExisting: PrismaGameLifecycleRepository,
    },
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
