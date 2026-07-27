import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import type { MoveSubmission } from './application/ports/gameplay.repository.js';
import type { GameAllocation } from './application/ports/game.repository.js';
import type { GameSnapshotView } from './game-room.service.js';
import type { GameSnapshotPresenter } from './game-snapshot.presenter.js';

const ACTIVE_STATUSES = new Set([
  'CREATED',
  'WAITING_FOR_PLAYERS',
  'READY',
  'IN_PROGRESS',
  'RECONNECTING',
]);

export interface EphemeralAllocationState {
  readonly available: boolean;
  readonly graceDriftGuestSessionIds: readonly string[];
  readonly missingActiveGuestSessionIds: readonly string[];
  readonly missingStateGuestSessionIds: readonly string[];
  readonly snapshotMissing: boolean;
}

export interface CachedGameSnapshot {
  readonly gameVersion: number;
  readonly payload: unknown;
}

@Injectable()
export class GameEphemeralStateService {
  private readonly logger = new Logger(GameEphemeralStateService.name);
  private readonly snapshotTtlMs: number;
  private readonly stateTtlMs: number;

  constructor(
    config: AppConfigService,
    private readonly redis: RedisService,
  ) {
    this.snapshotTtlMs = config.values.SNAPSHOT_CACHE_TTL_MS;
    this.stateTtlMs = config.values.MATCH_STATE_TTL_MS;
  }

  async clearActiveGame(
    guestSessionId: string,
    expectedGameId: string,
  ): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      return (
        Number(
          await this.redis.connection.eval(
            `
          local current = redis.call('GET', KEYS[1])
          local state = redis.call('GET', KEYS[2])
          if current == ARGV[1] then
            redis.call('DEL', KEYS[1])
            redis.call('SET', KEYS[2], 'IDLE', 'PX', ARGV[2])
            return 1
          end
          if current == false and state == 'IN_GAME' then
            redis.call('SET', KEYS[2], 'IDLE', 'PX', ARGV[2])
            return 1
          end
          return 0
        `,
            2,
            this.activeGameKey(guestSessionId),
            this.stateKey(guestSessionId),
            expectedGameId,
            this.stateTtlMs,
          ),
        ) === 1
      );
    } catch {
      this.logger.warn({ guestSessionId }, 'Active-game cache cleanup failed');
      return false;
    }
  }

  async readSnapshot(
    gameId: string,
    guestSessionId: string,
  ): Promise<CachedGameSnapshot | null | undefined> {
    try {
      await this.redis.ensureConnected();
      const value = await this.redis.connection.get(this.snapshotKey(gameId));
      if (value === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('gameVersion' in parsed) ||
        !Number.isInteger(parsed.gameVersion) ||
        !('payloads' in parsed) ||
        typeof parsed.payloads !== 'object' ||
        parsed.payloads === null ||
        !(guestSessionId in parsed.payloads)
      ) {
        return null;
      }
      return {
        gameVersion: Number(parsed.gameVersion),
        payload: (parsed.payloads as Record<string, unknown>)[guestSessionId],
      };
    } catch {
      return undefined;
    }
  }

  async inspectAllocation(
    allocation: GameAllocation,
  ): Promise<EphemeralAllocationState> {
    try {
      await this.redis.ensureConnected();
      const pipeline = this.redis.connection.pipeline();
      for (const player of allocation.players) {
        pipeline.get(this.activeGameKey(player.guestSessionId));
      }
      for (const player of allocation.players) {
        pipeline.get(this.stateKey(player.guestSessionId));
      }
      pipeline.exists(this.snapshotKey(allocation.game.id));
      for (const player of allocation.players) {
        pipeline.exists(
          this.graceKey(allocation.game.id, player.guestSessionId),
        );
      }
      const results = await pipeline.exec();
      if (results === null || results.some(([error]) => error !== null)) {
        throw new Error('Redis rejected an inspection command.');
      }
      const missingActiveGuestSessionIds = allocation.players
        .filter((_, index) => results[index]?.[1] !== allocation.game.id)
        .map((player) => player.guestSessionId);
      const missingStateGuestSessionIds = allocation.players
        .filter((_, index) => results[index + 2]?.[1] !== 'IN_GAME')
        .map((player) => player.guestSessionId);
      const now = Date.now();
      const graceDriftGuestSessionIds = allocation.players
        .filter((player, index) => {
          const expected =
            player.reconnectGraceEndsAt !== null &&
            player.reconnectGraceEndsAt.getTime() > now;
          const present = Number(results[index + 5]?.[1] ?? 0) === 1;
          return expected !== present;
        })
        .map((player) => player.guestSessionId);
      return {
        available: true,
        graceDriftGuestSessionIds,
        missingActiveGuestSessionIds,
        missingStateGuestSessionIds,
        snapshotMissing: Number(results[4]?.[1] ?? 0) !== 1,
      };
    } catch {
      return {
        available: false,
        graceDriftGuestSessionIds: [],
        missingActiveGuestSessionIds: [],
        missingStateGuestSessionIds: [],
        snapshotMissing: false,
      };
    }
  }

  async readActiveGame(
    guestSessionId: string,
  ): Promise<string | null | undefined> {
    try {
      await this.redis.ensureConnected();
      return await this.redis.connection.get(
        this.activeGameKey(guestSessionId),
      );
    } catch {
      return undefined;
    }
  }

  async restoreActiveGame(
    gameId: string,
    guestSessionId: string,
  ): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      const pipeline = this.redis.connection.pipeline();
      pipeline.set(this.activeGameKey(guestSessionId), gameId);
      pipeline.set(
        this.stateKey(guestSessionId),
        'IN_GAME',
        'PX',
        this.stateTtlMs,
      );
      const results = await pipeline.exec();
      if (results === null || results.some(([error]) => error !== null)) {
        throw new Error('Redis rejected active-game restoration.');
      }
      return true;
    } catch {
      this.logger.warn(
        { gameId, guestSessionId },
        'Active-game cache restoration failed',
      );
      return false;
    }
  }

  async restoreSnapshot(
    snapshot: GameSnapshotView,
    presenter: GameSnapshotPresenter,
  ): Promise<boolean> {
    const gameId = snapshot.game.id;
    try {
      await this.redis.ensureConnected();
      const payloads = Object.fromEntries(
        snapshot.players.map((player) => [
          player.guestSessionId,
          presenter.present(snapshot, player.guestSessionId),
        ]),
      );
      const pipeline = this.redis.connection.pipeline();
      pipeline.set(
        this.snapshotKey(gameId),
        JSON.stringify({
          gameId,
          gameVersion: snapshot.game.version,
          payloads,
        }),
        'PX',
        this.snapshotTtlMs,
      );
      if (ACTIVE_STATUSES.has(snapshot.game.status)) {
        for (const player of snapshot.players) {
          pipeline.set(this.activeGameKey(player.guestSessionId), gameId);
          pipeline.set(
            this.stateKey(player.guestSessionId),
            'IN_GAME',
            'PX',
            this.stateTtlMs,
          );
        }
      }
      for (const player of snapshot.players) {
        const graceEndsAt = player.reconnectGraceEndsAt;
        if (graceEndsAt !== null && graceEndsAt.getTime() > Date.now()) {
          pipeline.set(
            this.graceKey(gameId, player.guestSessionId),
            String(graceEndsAt.getTime()),
            'PX',
            Math.max(1, graceEndsAt.getTime() - Date.now()),
          );
        } else {
          pipeline.del(this.graceKey(gameId, player.guestSessionId));
        }
      }
      const results = await pipeline.exec();
      if (results === null || results.some(([error]) => error !== null)) {
        throw new Error('Redis rejected snapshot restoration.');
      }
      if (!ACTIVE_STATUSES.has(snapshot.game.status)) {
        await Promise.all(
          snapshot.players.map((player) =>
            this.clearActiveGame(player.guestSessionId, gameId),
          ),
        );
      }
      return true;
    } catch {
      this.logger.warn({ gameId }, 'Game snapshot cache restoration failed');
      return false;
    }
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
          this.graceKey(gameId, guestSessionId),
          this.queueGuardKey(guestSessionId),
        );
      }
      await pipeline.exec();
      await Promise.all(
        guestSessionIds.map((guestSessionId) =>
          this.clearActiveGame(guestSessionId, gameId),
        ),
      );
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
