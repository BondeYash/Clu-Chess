import { Inject, Injectable } from '@nestjs/common';
import {
  GAME_REPOSITORY,
  type GameAllocation,
  type GameRepository,
} from './application/ports/game.repository.js';
import { GameServiceError } from './domain/game-service.errors.js';

@Injectable()
export class GameRoomService {
  constructor(
    @Inject(GAME_REPOSITORY)
    private readonly games: GameRepository,
  ) {}

  async authorize(
    gameId: string,
    guestSessionId: string,
  ): Promise<GameAllocation> {
    const allocation = await this.games.findById(gameId);
    if (allocation === null) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'The requested game does not exist.',
        false,
      );
    }
    if (
      !allocation.players.some(
        (player) => player.guestSessionId === guestSessionId,
      )
    ) {
      throw new GameServiceError(
        'NOT_A_PLAYER',
        'The authenticated guest is not a member of this game.',
        false,
      );
    }
    return allocation;
  }

  ready(
    gameId: string,
    guestSessionId: string,
    expectedVersion: number,
    observedAt = new Date(),
  ): Promise<GameAllocation> {
    return this.games.markReady({
      expectedVersion,
      gameId,
      guestSessionId,
      observedAt,
    });
  }

  snapshot(gameId: string, guestSessionId: string): Promise<GameAllocation> {
    return this.authorize(gameId, guestSessionId);
  }

  async activeSnapshot(guestSessionId: string): Promise<GameAllocation> {
    const eligibility = await this.games.getGuestMatchEligibility(
      guestSessionId,
      new Date(),
    );
    if (eligibility.activeGameId === null) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'The guest has no active game.',
        false,
      );
    }
    return this.authorize(eligibility.activeGameId, guestSessionId);
  }
}
