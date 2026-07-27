import { Inject, Injectable } from '@nestjs/common';
import type { Span } from '@opentelemetry/api';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { TelemetryService } from '../../common/telemetry/telemetry.service.js';
import { DatabaseError } from '../persistence/database-errors.js';
import {
  GAMEPLAY_REPOSITORY,
  type GameplayRepository,
  type MoveSubmission,
  type SubmitMove,
} from './application/ports/gameplay.repository.js';
import { GameServiceError } from './domain/game-service.errors.js';
import { GameDeadlineService } from './game-deadline.service.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';

@Injectable()
export class GameMoveService {
  constructor(
    private readonly deadlines: GameDeadlineService,
    private readonly ephemeralState: GameEphemeralStateService,
    @Inject(GAMEPLAY_REPOSITORY)
    private readonly gameplay: GameplayRepository,
    private readonly metrics: MetricsService,
    private readonly telemetry: TelemetryService,
  ) {}

  async submit(input: SubmitMove): Promise<MoveSubmission> {
    return this.telemetry.withSpan(
      'move.tx',
      { 'cluchess.command': 'move.submit' },
      async (span) => this.submitObserved(input, span),
    );
  }

  private async submitObserved(
    input: SubmitMove,
    span: Span | undefined,
  ): Promise<MoveSubmission> {
    const startedAt = performance.now();
    let submission: MoveSubmission;
    try {
      submission = await this.gameplay.submitMove(input);
    } catch (error) {
      if (error instanceof GameServiceError) {
        this.recordRejection(error.code);
        span?.setAttribute('cluchess.outcome', error.code);
        throw error;
      }
      if (error instanceof DatabaseError) {
        this.recordRejection('DEPENDENCY_UNAVAILABLE');
        span?.setAttribute('cluchess.outcome', 'DEPENDENCY_UNAVAILABLE');
        throw new GameServiceError(
          'DEPENDENCY_UNAVAILABLE',
          'The authoritative game store is temporarily unavailable.',
          true,
          undefined,
          'move.rejected',
        );
      }
      throw error;
    } finally {
      this.metrics.observe(
        'cluchess_move_latency_seconds',
        'Move validation and persistence latency.',
        (performance.now() - startedAt) / 1000,
      );
    }

    span?.setAttribute(
      'cluchess.outcome',
      submission.duplicate ? 'duplicate' : 'accepted',
    );
    this.metrics.increment(
      submission.duplicate
        ? 'cluchess_duplicate_moves_total'
        : 'cluchess_moves_accepted_total',
      submission.duplicate
        ? 'Idempotent accepted move replays.'
        : 'Newly committed accepted moves.',
    );
    await this.ephemeralState.afterMove(submission);
    if (submission.ended === null) {
      await this.deadlines.scheduleGame(submission.accepted.gameId);
    } else {
      this.deadlines.cancel(submission.accepted.gameId);
    }
    return submission;
  }

  private recordRejection(code: string): void {
    this.metrics.increment(
      'cluchess_moves_rejected_total',
      'Rejected move submissions by bounded error code.',
      { code },
    );
    if (code === 'STALE_GAME_VERSION') {
      this.metrics.increment(
        'cluchess_optimistic_conflicts_total',
        'Optimistic game-version conflicts.',
      );
    }
  }
}
