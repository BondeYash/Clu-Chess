import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { DatabaseError } from '../persistence/database-errors.js';
import {
  GAME_LIFECYCLE_REPOSITORY,
  type DeadlineState,
  type GameLifecycleRepository,
  type PlayerDisconnected,
  type PlayerReconnected,
  type ResignGame,
  type TerminalSubmission,
} from './application/ports/game-lifecycle.repository.js';
import { GameServiceError } from './domain/game-service.errors.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';
import { GameLifecycleDeliveryRegistry } from './game-lifecycle-delivery.registry.js';

@Injectable()
export class GameLifecycleService {
  private readonly graceMs: number;
  private readonly jobBatchSize: number;

  constructor(
    config: AppConfigService,
    private readonly delivery: GameLifecycleDeliveryRegistry,
    private readonly ephemeralState: GameEphemeralStateService,
    @Inject(GAME_LIFECYCLE_REPOSITORY)
    private readonly lifecycle: GameLifecycleRepository,
    private readonly presence: PresenceService,
  ) {
    this.graceMs = config.values.GRACE_MS;
    this.jobBatchSize = config.values.JOB_BATCH_SIZE;
  }

  async resign(input: ResignGame): Promise<TerminalSubmission> {
    try {
      const submission = await this.lifecycle.resign(input);
      await this.completeTerminal(submission);
      return submission;
    } catch (error) {
      if (error instanceof GameServiceError) {
        throw error;
      }
      if (error instanceof DatabaseError) {
        throw new GameServiceError(
          'DEPENDENCY_UNAVAILABLE',
          'The authoritative game store is temporarily unavailable.',
          error.retryable,
        );
      }
      throw error;
    }
  }

  async terminateForReset(guestSessionId: string): Promise<void> {
    const submission = await this.lifecycle.terminateForReset(guestSessionId);
    if (submission !== null) {
      await this.completeTerminal(submission);
    }
  }

  async disconnected(
    guestSessionId: string,
  ): Promise<PlayerDisconnected | null> {
    const event = await this.lifecycle.markDisconnected(
      guestSessionId,
      this.graceMs,
    );
    if (event !== null) {
      await this.ephemeralState.afterDisconnect(
        event.gameId,
        guestSessionId,
        event.graceDeadline,
      );
      this.delivery.playerDisconnected(event);
    }
    return event;
  }

  async reconnected(guestSessionId: string): Promise<PlayerReconnected | null> {
    const event = await this.lifecycle.markReconnected(guestSessionId);
    if (event !== null) {
      await this.ephemeralState.afterReconnect(event.gameId, guestSessionId);
      this.delivery.playerReconnected(event);
    }
    return event;
  }

  async adjudicateGame(gameId: string): Promise<TerminalSubmission | null> {
    const noShow = await this.lifecycle.adjudicateNoShow(gameId);
    if (noShow !== null) {
      await this.completeTerminal(noShow);
      return noShow;
    }

    const timeout = await this.lifecycle.adjudicateTimeout(gameId);
    if (timeout !== null) {
      await this.completeTerminal(timeout);
      return timeout;
    }

    const grace = await this.lifecycle.findGraceState(gameId);
    if (grace === null) {
      return null;
    }
    let absentGuestSessionIds: readonly string[];
    try {
      const presence = await Promise.all(
        grace.guestSessionIds.map(async (guestSessionId) => ({
          guestSessionId,
          present: await this.presence.isPresent(guestSessionId),
        })),
      );
      absentGuestSessionIds = presence
        .filter((candidate) => !candidate.present)
        .map((candidate) => candidate.guestSessionId);
    } catch {
      return null;
    }
    if (
      !grace.dueGuestSessionIds.some((guestSessionId) =>
        absentGuestSessionIds.includes(guestSessionId),
      )
    ) {
      return null;
    }
    const abandonment = await this.lifecycle.adjudicateAbandonment(
      gameId,
      absentGuestSessionIds,
    );
    if (abandonment !== null) {
      await this.completeTerminal(abandonment);
    }
    return abandonment;
  }

  findDeadline(gameId: string): Promise<DeadlineState | null> {
    return this.lifecycle.findDeadline(gameId);
  }

  findDueGameIds(): Promise<readonly string[]> {
    return this.lifecycle.findDueGameIds(this.jobBatchSize);
  }

  findSchedulableGameIds(): Promise<readonly string[]> {
    return this.lifecycle.findSchedulableGameIds(this.jobBatchSize);
  }

  private async completeTerminal(
    submission: TerminalSubmission,
  ): Promise<void> {
    await this.ephemeralState.afterTerminal(
      submission.ended.gameId,
      submission.guestSessionIds,
    );
    if (!submission.duplicate) {
      this.delivery.gameEnded(submission);
    }
  }
}
