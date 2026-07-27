import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import {
  GAME_REPOSITORY,
  type GameAllocationCursor,
  type GameRepository,
} from './application/ports/game.repository.js';
import { GameAllocationService } from './game-allocation.service.js';
import { GameEphemeralStateService } from './game-ephemeral-state.service.js';
import { GameRoomService } from './game-room.service.js';
import { GameSnapshotPresenter } from './game-snapshot.presenter.js';

export interface GameReconciliationReport {
  readonly activeGameRepairs: number;
  readonly graceRepairs: number;
  readonly snapshotRepairs: number;
  readonly staleActiveGameRepairs: number;
  readonly stateRepairs: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class GameReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly batchSize: number;
  private databaseCursor: GameAllocationCursor | undefined;
  private readonly intervalMs: number;
  private readonly logger = new Logger(GameReconciliationService.name);
  private redisCursor = '0';
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly allocations: GameAllocationService,
    config: AppConfigService,
    private readonly ephemeral: GameEphemeralStateService,
    @Inject(GAME_REPOSITORY)
    private readonly games: GameRepository,
    private readonly metrics: MetricsService,
    private readonly presenter: GameSnapshotPresenter,
    private readonly redis: RedisService,
    private readonly rooms: GameRoomService,
  ) {
    this.batchSize = config.values.JOB_BATCH_SIZE;
    this.intervalMs = config.values.JOB_ACTIVE_DRIFT_MS;
  }

  onApplicationBootstrap(): void {
    void this.runSafely();
    this.timer = setInterval(() => {
      void this.runSafely();
    }, this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<GameReconciliationReport> {
    const report: GameReconciliationReport = {
      activeGameRepairs: 0,
      graceRepairs: 0,
      snapshotRepairs: 0,
      staleActiveGameRepairs: 0,
      stateRepairs: 0,
    };
    const mutable = { ...report };
    await this.reconcileDurableGames(mutable);
    await this.reconcileRedisActiveKeys(mutable);
    return mutable;
  }

  private async reconcileDurableGames(report: {
    activeGameRepairs: number;
    graceRepairs: number;
    snapshotRepairs: number;
    staleActiveGameRepairs: number;
    stateRepairs: number;
  }): Promise<void> {
    const allocations = await this.allocations.listActive(
      this.batchSize,
      this.databaseCursor,
    );
    const last = allocations.at(-1);
    this.databaseCursor =
      allocations.length === this.batchSize && last !== undefined
        ? { id: last.game.id, updatedAt: last.game.updatedAt }
        : undefined;

    for (const allocation of allocations) {
      const state = await this.ephemeral.inspectAllocation(allocation);
      if (!state.available) {
        throw new Error('Redis is unavailable for active-game reconciliation.');
      }
      const driftCount =
        state.missingActiveGuestSessionIds.length +
        state.missingStateGuestSessionIds.length +
        state.graceDriftGuestSessionIds.length +
        (state.snapshotMissing ? 1 : 0);
      if (driftCount === 0) {
        continue;
      }

      const snapshot = await this.rooms.snapshot(
        allocation.game.id,
        allocation.players[0].guestSessionId,
      );
      if (!(await this.ephemeral.restoreSnapshot(snapshot, this.presenter))) {
        throw new Error('Redis rejected active-game reconciliation.');
      }
      for (const guestSessionId of state.missingActiveGuestSessionIds) {
        report.activeGameRepairs += 1;
        this.repaired('active_game', allocation.game.id, guestSessionId);
      }
      for (const guestSessionId of state.missingStateGuestSessionIds) {
        report.stateRepairs += 1;
        this.repaired('user_state', allocation.game.id, guestSessionId);
      }
      for (const guestSessionId of state.graceDriftGuestSessionIds) {
        report.graceRepairs += 1;
        this.repaired('grace', allocation.game.id, guestSessionId);
      }
      if (state.snapshotMissing) {
        report.snapshotRepairs += 1;
        this.repaired('snapshot', allocation.game.id);
      }
    }
  }

  private async reconcileRedisActiveKeys(report: {
    staleActiveGameRepairs: number;
  }): Promise<void> {
    await this.redis.ensureConnected();
    const [nextCursor, keys] = await this.redis.connection.scan(
      this.redisCursor,
      'MATCH',
      'user:*:active-game',
      'COUNT',
      this.batchSize,
    );
    this.redisCursor = nextCursor;

    for (const key of keys.slice(0, this.batchSize)) {
      const guestSessionId = key.slice('user:'.length, -':active-game'.length);
      if (!UUID_PATTERN.test(guestSessionId)) {
        continue;
      }
      const cachedGameId = await this.redis.connection.get(key);
      const eligibility = await this.games.getGuestMatchEligibility(
        guestSessionId,
        new Date(),
      );
      if (cachedGameId === eligibility.activeGameId) {
        continue;
      }
      const repaired =
        eligibility.activeGameId === null
          ? await this.ephemeral.clearActiveGame(
              guestSessionId,
              cachedGameId ?? '',
            )
          : await this.ephemeral.restoreActiveGame(
              eligibility.activeGameId,
              guestSessionId,
            );
      if (!repaired) {
        continue;
      }
      report.staleActiveGameRepairs += 1;
      this.repaired(
        'stale_active_game',
        eligibility.activeGameId ?? cachedGameId ?? undefined,
        guestSessionId,
      );
    }
  }

  private repaired(
    kind: string,
    gameId?: string,
    guestSessionId?: string,
  ): void {
    this.metrics.increment(
      'cluchess_reconciliation_repairs_total',
      'Reconciliation repairs by job and kind.',
      { job: 'active_drift', kind },
    );
    this.logger.log({
      ...(gameId === undefined ? {} : { gameId }),
      ...(guestSessionId === undefined ? {} : { guestSessionId }),
      job: 'active_drift',
      repair: kind,
    });
  }

  private async runSafely(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    const startedAt = performance.now();
    this.metrics.increment(
      'cluchess_reconciliation_runs_total',
      'Reconciliation job runs by job and outcome.',
      { job: 'active_drift', outcome: 'started' },
    );
    try {
      const report = await this.runOnce();
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: 'active_drift', outcome: 'success' },
      );
      this.logger.log({
        durationMs: Math.round(performance.now() - startedAt),
        job: 'active_drift',
        report,
      });
    } catch {
      this.metrics.increment(
        'cluchess_cleanup_failures_total',
        'Background cleanup and reconciliation failures by job.',
        { job: 'active_drift' },
      );
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: 'active_drift', outcome: 'failure' },
      );
      this.logger.warn({
        durationMs: Math.round(performance.now() - startedAt),
        job: 'active_drift',
      });
    } finally {
      this.running = false;
    }
  }
}
