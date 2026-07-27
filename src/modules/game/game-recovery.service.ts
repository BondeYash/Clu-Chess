import { Inject, Injectable } from '@nestjs/common';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { TelemetryService } from '../../common/telemetry/telemetry.service.js';
import { DatabaseError } from '../persistence/database-errors.js';
import { gameSnapshotPayloadSchema } from '../realtime/protocol/protocol.schemas.js';
import {
  GAME_REPOSITORY,
  type GameRepository,
} from './application/ports/game.repository.js';
import { GameServiceError } from './domain/game-service.errors.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';
import { GameRoomService } from './game-room.service.js';
import {
  GameSnapshotPresenter,
  type GameSnapshotPayload,
} from './game-snapshot.presenter.js';

export type RecoveredGameSnapshot = Readonly<{
  gameId: string;
  gameVersion: number;
  payload: GameSnapshotPayload;
}>;

@Injectable()
export class GameRecoveryService {
  constructor(
    private readonly ephemeral: GameEphemeralStateService,
    @Inject(GAME_REPOSITORY)
    private readonly games: GameRepository,
    private readonly metrics: MetricsService,
    private readonly presenter: GameSnapshotPresenter,
    private readonly rooms: GameRoomService,
    private readonly telemetry: TelemetryService,
  ) {}

  async activeGameId(guestSessionId: string): Promise<string | null> {
    try {
      const cached = await this.ephemeral.readActiveGame(guestSessionId);
      const eligibility = await this.games.getGuestMatchEligibility(
        guestSessionId,
        new Date(),
      );
      const authoritative = eligibility.activeGameId;
      this.metrics.increment(
        'cluchess_recovery_cache_reads_total',
        'Recovery cache reads by result.',
        {
          cache: 'active_game',
          result: cached === authoritative ? 'hit' : 'miss',
        },
      );
      if (authoritative === null) {
        if (typeof cached === 'string') {
          await this.ephemeral.clearActiveGame(guestSessionId, cached);
        }
      } else {
        await this.ephemeral.restoreActiveGame(authoritative, guestSessionId);
      }
      return authoritative;
    } catch (error) {
      throw this.mapDatabaseFailure(error);
    }
  }

  async snapshot(
    gameId: string,
    guestSessionId: string,
  ): Promise<RecoveredGameSnapshot> {
    return this.telemetry.withSpan(
      'game.snapshot.recover',
      { 'cluchess.command': 'game.sync' },
      async () => this.snapshotInternal(gameId, guestSessionId),
    );
  }

  private async snapshotInternal(
    gameId: string,
    guestSessionId: string,
  ): Promise<RecoveredGameSnapshot> {
    try {
      const cached = await this.ephemeral.readSnapshot(gameId, guestSessionId);
      const cachedPayload =
        cached === null || cached === undefined
          ? undefined
          : gameSnapshotPayloadSchema.safeParse(cached.payload);
      const cachedVersion = cached?.gameVersion;
      if (
        cachedVersion !== undefined &&
        cachedPayload?.success === true &&
        ['ABANDONED', 'COMPLETED', 'EXPIRED'].includes(
          cachedPayload.data.status,
        )
      ) {
        const allocation = await this.rooms.authorize(gameId, guestSessionId);
        if (
          allocation.game.version === cachedVersion &&
          allocation.game.status === cachedPayload.data.status
        ) {
          this.metrics.increment(
            'cluchess_recovery_cache_reads_total',
            'Recovery cache reads by result.',
            { cache: 'snapshot', result: 'hit' },
          );
          return {
            gameId,
            gameVersion: cachedVersion,
            payload: cachedPayload.data,
          };
        }
      }
      const snapshot = await this.rooms.snapshot(gameId, guestSessionId);
      const payload = this.presenter.present(snapshot, guestSessionId);
      await this.ephemeral.restoreSnapshot(snapshot, this.presenter);
      this.metrics.increment(
        'cluchess_recovery_cache_reads_total',
        'Recovery cache reads by result.',
        {
          cache: 'snapshot',
          result: cached === null ? 'miss' : 'bypass',
        },
      );
      return {
        gameId,
        gameVersion: snapshot.game.version,
        payload,
      };
    } catch (error) {
      throw this.mapDatabaseFailure(error);
    }
  }

  async activeSnapshot(guestSessionId: string): Promise<RecoveredGameSnapshot> {
    const gameId = await this.activeGameId(guestSessionId);
    if (gameId === null) {
      throw new GameServiceError(
        'GAME_NOT_FOUND',
        'The guest has no active game.',
        false,
      );
    }
    return this.snapshot(gameId, guestSessionId);
  }

  private mapDatabaseFailure(error: unknown): unknown {
    if (error instanceof GameServiceError) {
      return error;
    }
    if (error instanceof DatabaseError) {
      return new GameServiceError(
        'DEPENDENCY_UNAVAILABLE',
        'The authoritative game store is temporarily unavailable.',
        true,
      );
    }
    return error;
  }
}
