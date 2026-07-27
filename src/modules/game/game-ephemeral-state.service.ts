import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import type { MoveSubmission } from './application/ports/gameplay.repository.js';

@Injectable()
export class GameEphemeralStateService {
  private readonly logger = new Logger(GameEphemeralStateService.name);
  private readonly stateTtlMs: number;

  constructor(
    config: AppConfigService,
    private readonly redis: RedisService,
  ) {
    this.stateTtlMs = config.values.MATCH_STATE_TTL_MS;
  }

  async afterMove(submission: MoveSubmission): Promise<void> {
    try {
      await this.redis.ensureConnected();
      const pipeline = this.redis.connection.pipeline();
      pipeline.del(this.snapshotKey(submission.accepted.gameId));
      if (submission.ended !== null) {
        for (const guestSessionId of submission.guestSessionIds) {
          pipeline.del(
            this.activeGameKey(guestSessionId),
            this.queueGuardKey(guestSessionId),
          );
          pipeline.set(
            this.stateKey(guestSessionId),
            'IDLE',
            'PX',
            this.stateTtlMs,
          );
        }
      }
      const results = await pipeline.exec();
      if (
        results === null ||
        results.some(([commandError]) => commandError !== null)
      ) {
        throw new Error('Redis rejected one or more cleanup commands.');
      }
    } catch {
      this.logger.warn(
        { gameId: submission.accepted.gameId },
        'Post-commit game cache cleanup failed',
      );
    }
  }

  async afterStart(gameId: string): Promise<void> {
    try {
      await this.redis.ensureConnected();
      await this.redis.connection.del(this.snapshotKey(gameId));
    } catch {
      this.logger.warn(
        { gameId },
        'Post-commit game snapshot invalidation failed',
      );
    }
  }

  private activeGameKey(guestSessionId: string): string {
    return `user:${guestSessionId}:active-game`;
  }

  private queueGuardKey(guestSessionId: string): string {
    return `mm:queued:${guestSessionId}`;
  }

  private snapshotKey(gameId: string): string {
    return `game:${gameId}:snapshot`;
  }

  private stateKey(guestSessionId: string): string {
    return `user:${guestSessionId}:state`;
  }
}
