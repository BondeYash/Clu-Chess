import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import {
  GUEST_SESSION_REPOSITORY,
  type GuestSessionRepository,
  type RevokedSessionCursor,
} from './application/ports/guest-session.repository.js';
import { SessionRevocationService } from './session-revocation.service.js';

@Injectable()
export class SessionMaintenanceService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly batchSize: number;
  private readonly cleanupIntervalMs: number;
  private readonly logger = new Logger(SessionMaintenanceService.name);
  private readonly reconciliationIntervalMs: number;
  private readonly retentionMs: number;
  private cleanupRunning = false;
  private cleanupTimer?: NodeJS.Timeout;
  private reconciliationRunning = false;
  private reconciliationTimer?: NodeJS.Timeout;
  private revocationCursor: RevokedSessionCursor | undefined;

  constructor(
    @Inject(GUEST_SESSION_REPOSITORY)
    private readonly repository: GuestSessionRepository,
    private readonly revocations: SessionRevocationService,
    private readonly metrics: MetricsService,
    config: AppConfigService,
  ) {
    this.batchSize = config.values.JOB_BATCH_SIZE;
    this.cleanupIntervalMs = config.values.JOB_SESSION_CLEANUP_MS;
    this.reconciliationIntervalMs = config.values.JOB_REVOCATION_REBUILD_MS;
    this.retentionMs =
      config.values.SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  }

  onModuleInit(): void {
    void this.reconcileSafely();
    void this.cleanupSafely();
    this.reconciliationTimer = setInterval(() => {
      void this.reconcileSafely();
    }, this.reconciliationIntervalMs);
    this.reconciliationTimer.unref();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupSafely();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.reconciliationTimer !== undefined) {
      clearInterval(this.reconciliationTimer);
    }
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
    }
  }

  async runOnce(now = new Date()): Promise<number> {
    await this.reconcileRevocations(now);
    return this.cleanupExpired(now);
  }

  private async cleanupExpired(now: Date): Promise<number> {
    return this.repository.cleanupExpired(
      new Date(now.getTime() - this.retentionMs),
      this.batchSize,
    );
  }

  private async cleanupSafely(): Promise<void> {
    if (this.cleanupRunning) {
      return;
    }
    this.cleanupRunning = true;
    try {
      const deletedCount = await this.cleanupExpired(new Date());
      if (deletedCount > 0) {
        this.metrics.increment(
          'cluchess_reconciliation_repairs_total',
          'Reconciliation repairs by job and kind.',
          { job: 'session_cleanup', kind: 'expired_session' },
          deletedCount,
        );
        this.logger.log(
          `Cleaned up ${String(deletedCount)} expired guest sessions`,
        );
      }
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: 'session_cleanup', outcome: 'success' },
      );
    } catch {
      this.metrics.increment(
        'cluchess_cleanup_failures_total',
        'Background cleanup and reconciliation failures by job.',
        { job: 'session_cleanup' },
      );
      this.logger.warn('Expired session cleanup could not be completed');
    } finally {
      this.cleanupRunning = false;
    }
  }

  private async reconcileRevocations(now: Date): Promise<void> {
    const revokedSessions = await this.repository.findLiveRevoked(
      now,
      this.batchSize,
      this.revocationCursor,
    );
    for (const session of revokedSessions) {
      await this.revocations.restoreSessionRevocation(session, now);
    }
    const lastSession = revokedSessions.at(-1);
    this.revocationCursor =
      revokedSessions.length === this.batchSize &&
      lastSession?.revokedAt !== null &&
      lastSession?.revokedAt !== undefined
        ? { id: lastSession.id, revokedAt: lastSession.revokedAt }
        : undefined;
  }

  private async reconcileSafely(): Promise<void> {
    if (this.reconciliationRunning) {
      return;
    }
    this.reconciliationRunning = true;
    try {
      await this.reconcileRevocations(new Date());
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: 'session_revocation', outcome: 'success' },
      );
    } catch {
      this.metrics.increment(
        'cluchess_cleanup_failures_total',
        'Background cleanup and reconciliation failures by job.',
        { job: 'session_revocation' },
      );
      this.logger.warn(
        'Session revocation reconciliation could not be completed',
      );
    } finally {
      this.reconciliationRunning = false;
    }
  }
}
