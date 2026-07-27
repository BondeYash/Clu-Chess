import { Inject, Injectable } from '@nestjs/common';
import {
  GAME_REPOSITORY,
  type GameAllocation,
  type GameRepository,
  type GameSnapshotRecord,
} from './application/ports/game.repository.js';
import type { StartedGame } from './application/ports/gameplay.repository.js';
import { clockViewAt, type ClockView } from './domain/game-clock.js';
import { GameServiceError } from './domain/game-service.errors.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';

export type GameSnapshotView = GameSnapshotRecord &
  Readonly<{ clocks: ClockView }>;

export type ReadyGameResult = Readonly<{
  snapshot: GameSnapshotView;
  started: StartedGame | null;
}>;

@Injectable()
export class GameRoomService {
  constructor(
    private readonly ephemeralState: GameEphemeralStateService,
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

  async ready(
    gameId: string,
    guestSessionId: string,
    expectedVersion: number,
    observedAt = new Date(),
  ): Promise<ReadyGameResult> {
    const allocation = await this.games.markReady({
      expectedVersion,
      gameId,
      guestSessionId,
      observedAt,
    });
    let started: StartedGame | null = null;
    if (allocation.game.status === 'READY') {
      const result = await this.games.startIfReady(gameId);
      if (result.started) {
        const startedGame = result.allocation.game;
        const startedAt = startedGame.startedAt;
        if (startedAt === null) {
          throw new GameServiceError(
            'GAME_STATE_CORRUPT',
            'A started game has no authoritative start time.',
            false,
          );
        }
        started = {
          clocks: {
            blackMs: startedGame.blackClockMs,
            observedAt: startedAt.getTime(),
            running: 'w',
            whiteMs: startedGame.whiteClockMs,
          },
          gameId: startedGame.id,
          gameVersion: startedGame.version,
          initialFen: startedGame.initialFen,
        };
        await this.ephemeralState.afterStart(gameId);
      }
    }
    return {
      snapshot: await this.snapshot(gameId, guestSessionId),
      started,
    };
  }

  async snapshot(
    gameId: string,
    guestSessionId: string,
  ): Promise<GameSnapshotView> {
    const snapshot = await this.games.findSnapshot(gameId);
    if (snapshot === null) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'The requested game does not exist.',
        false,
      );
    }
    if (
      !snapshot.players.some(
        (player) => player.guestSessionId === guestSessionId,
      )
    ) {
      throw new GameServiceError(
        'NOT_A_PLAYER',
        'The authenticated guest is not a member of this game.',
        false,
      );
    }

    const game = snapshot.game;
    const running =
      game.status === 'IN_PROGRESS' || game.status === 'RECONNECTING'
        ? game.turnColor
        : null;
    try {
      return {
        ...snapshot,
        clocks: clockViewAt(
          {
            blackMs: game.blackClockMs,
            incrementMs: game.incrementMs,
            running,
            turnStartedAt: running === null ? null : game.turnStartedAt,
            whiteMs: game.whiteClockMs,
          },
          snapshot.observedAt,
        ),
      };
    } catch {
      throw new GameServiceError(
        'GAME_STATE_CORRUPT',
        'The persisted game clock is inconsistent.',
        false,
      );
    }
  }

  async activeSnapshot(guestSessionId: string): Promise<GameSnapshotView> {
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
    return this.snapshot(eligibility.activeGameId, guestSessionId);
  }
}
