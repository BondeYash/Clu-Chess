import { Inject, Injectable } from '@nestjs/common';
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
  ) {}

  async submit(input: SubmitMove): Promise<MoveSubmission> {
    let submission: MoveSubmission;
    try {
      submission = await this.gameplay.submitMove(input);
    } catch (error) {
      if (error instanceof GameServiceError) {
        throw error;
      }
      if (error instanceof DatabaseError) {
        throw new GameServiceError(
          'DEPENDENCY_UNAVAILABLE',
          'The authoritative game store is temporarily unavailable.',
          error.retryable,
          undefined,
          'move.rejected',
        );
      }
      throw error;
    }

    await this.ephemeralState.afterMove(submission);
    if (submission.ended === null) {
      await this.deadlines.scheduleGame(submission.accepted.gameId);
    } else {
      this.deadlines.cancel(submission.accepted.gameId);
    }
    return submission;
  }
}
