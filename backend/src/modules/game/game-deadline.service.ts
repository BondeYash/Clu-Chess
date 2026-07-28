import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { GameLifecycleService } from './game-lifecycle.service.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

@Injectable()
export class GameDeadlineService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly generations = new Map<string, number>();
  private readonly intervalMs: number;
  private readonly logger = new Logger(GameDeadlineService.name);
  private runningSweep = false;
  private sweepTimer: NodeJS.Timeout | undefined;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    config: AppConfigService,
    private readonly lifecycle: GameLifecycleService,
    private readonly metrics: MetricsService,
  ) {
    this.intervalMs = config.values.JOB_DEADLINE_SWEEP_MS;
  }

  onApplicationBootstrap(): void {
    this.sweepTimer = setInterval(() => {
      void this.runSweep();
    }, this.intervalMs);
    this.sweepTimer.unref();
    void this.rebuild();
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async scheduleGame(gameId: string, minimumDelayMs = 0): Promise<void> {
    const generation = (this.generations.get(gameId) ?? 0) + 1;
    this.generations.set(gameId, generation);
    this.clearTimer(gameId);
    try {
      const state = await this.lifecycle.findDeadline(gameId);
      if (state === null || this.generations.get(gameId) !== generation) {
        return;
      }
      const delay = Math.min(
        MAX_TIMER_DELAY_MS,
        Math.max(minimumDelayMs, state.deadline.getTime() - Date.now()),
      );
      const timer = setTimeout(() => {
        void this.fire(gameId, generation);
      }, delay);
      timer.unref();
      this.timers.set(gameId, timer);
    } catch {
      this.logger.warn(
        { gameId },
        'Authoritative game deadline could not be scheduled',
      );
    }
  }

  cancel(gameId: string): void {
    this.generations.set(gameId, (this.generations.get(gameId) ?? 0) + 1);
    this.clearTimer(gameId);
  }

  async runSweep(): Promise<void> {
    if (this.runningSweep) {
      return;
    }
    this.runningSweep = true;
    try {
      const gameIds = await this.lifecycle.findDueGameIds();
      for (const gameId of gameIds) {
        await this.adjudicateAndReschedule(gameId);
      }
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: 'game_deadline', outcome: 'success' },
      );
      if (gameIds.length > 0) {
        this.metrics.increment(
          'cluchess_reconciliation_repairs_total',
          'Reconciliation repairs by job and kind.',
          { job: 'game_deadline', kind: 'due_game' },
          gameIds.length,
        );
      }
    } catch {
      this.metrics.increment(
        'cluchess_cleanup_failures_total',
        'Background cleanup and reconciliation failures by job.',
        { job: 'game_deadline' },
      );
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: 'game_deadline', outcome: 'failure' },
      );
      this.logger.warn('Authoritative game deadline sweep failed');
    } finally {
      this.runningSweep = false;
    }
  }

  private async rebuild(): Promise<void> {
    try {
      const gameIds = await this.lifecycle.findSchedulableGameIds();
      await Promise.all(gameIds.map((gameId) => this.scheduleGame(gameId)));
    } catch {
      this.logger.warn('Authoritative game deadlines could not be rebuilt');
    }
  }

  private async fire(gameId: string, generation: number): Promise<void> {
    if (this.generations.get(gameId) !== generation) {
      return;
    }
    this.timers.delete(gameId);
    await this.adjudicateAndReschedule(gameId);
  }

  private async adjudicateAndReschedule(gameId: string): Promise<void> {
    try {
      const terminal = await this.lifecycle.adjudicateGame(gameId);
      if (terminal !== null) {
        this.cancel(gameId);
        return;
      }
    } catch {
      this.logger.warn({ gameId }, 'Game deadline adjudication failed');
    }
    await this.scheduleGame(gameId, this.intervalMs);
  }

  private clearTimer(gameId: string): void {
    const timer = this.timers.get(gameId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(gameId);
    }
  }
}
