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
    if (submission.ended !== null) {
      await this.afterTerminal(
        submission.accepted.gameId,
        submission.guestSessionIds,
      );
      return;
    }
    try {
      await this.redis.ensureConnected();
      await this.redis.connection.del(
        this.snapshotKey(submission.accepted.gameId),
      );
    } catch {
      this.logger.warn(
        { gameId: submission.accepted.gameId },
        'Post-commit game cache cleanup failed',
      );
    }
  }

  async afterTerminal(
    gameId: string,
    guestSessionIds: readonly [string, string],
  ): Promise<void> {
    try {
      await this.redis.ensureConnected();
      const pipeline = this.redis.connection.pipeline();
      pipeline.del(this.snapshotKey(gameId));
      for (const guestSessionId of guestSessionIds) {
        pipeline.del(
          this.activeGameKey(guestSessionId),
          this.graceKey(gameId, guestSessionId),
          this.queueGuardKey(guestSessionId),
        );
        pipeline.set(
          this.stateKey(guestSessionId),
          'IDLE',
          'PX',
          this.stateTtlMs,
        );
      }
      const results = await pipeline.exec();
      if (
        results === null ||
        results.some(([commandError]) => commandError !== null)
      ) {
        throw new Error('Redis rejected one or more cleanup commands.');
      }
    } catch {
      this.logger.warn({ gameId }, 'Post-commit terminal game cleanup failed');
    }
  }

  async afterDisconnect(
    gameId: string,
    guestSessionId: string,
    graceDeadline: number,
  ): Promise<void> {
    try {
      await this.redis.ensureConnected();
      const ttl = Math.max(1, graceDeadline - Date.now());
      await this.redis.connection.set(
        this.graceKey(gameId, guestSessionId),
        String(graceDeadline),
        'PX',
        ttl,
      );
      await this.redis.connection.del(this.snapshotKey(gameId));
    } catch {
      this.logger.warn(
        { gameId, guestSessionId },
        'Post-commit disconnect state update failed',
      );
    }
  }

  async afterReconnect(gameId: string, guestSessionId: string): Promise<void> {
    try {
      await this.redis.ensureConnected();
      await this.redis.connection.del(
        this.graceKey(gameId, guestSessionId),
        this.snapshotKey(gameId),
      );
    } catch {
      this.logger.warn(
        { gameId, guestSessionId },
        'Post-commit reconnect state update failed',
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

  private graceKey(gameId: string, guestSessionId: string): string {
    return `game:${gameId}:grace:${guestSessionId}`;
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
