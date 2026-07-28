import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { MetricsService } from '../metrics/metrics.service.js';

export type ApplicationState = 'starting' | 'ready' | 'draining';
export type DrainHook = () => Promise<void>;
export type InFlightWorkKind = 'http' | 'realtime';

@Injectable()
export class ApplicationLifecycleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApplicationLifecycleService.name);
  private readonly drainHooks = new Set<DrainHook>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly inFlightByKind = new Map<InFlightWorkKind, number>([
    ['http', 0],
    ['realtime', 0],
  ]);
  private readonly instanceId: string;
  private state: ApplicationState = 'starting';
  private drainPromise?: Promise<void>;

  constructor(
    config: AppConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.instanceId = config.values.INSTANCE_ID;
    this.publishInFlightMetric('http', 0);
    this.publishInFlightMetric('realtime', 0);
  }

  onApplicationBootstrap(): void {
    if (this.state === 'starting') {
      this.state = 'ready';
    }
  }

  get currentState(): ApplicationState {
    return this.state;
  }

  get isReady(): boolean {
    return this.state === 'ready';
  }

  get inFlightWork(): number {
    return [...this.inFlightByKind.values()].reduce(
      (total, count) => total + count,
      0,
    );
  }

  trackWork(kind: InFlightWorkKind): () => void {
    const count = (this.inFlightByKind.get(kind) ?? 0) + 1;
    this.inFlightByKind.set(kind, count);
    this.publishInFlightMetric(kind, count);
    let finished = false;

    return () => {
      if (finished) {
        return;
      }
      finished = true;
      const remaining = Math.max(0, (this.inFlightByKind.get(kind) ?? 1) - 1);
      this.inFlightByKind.set(kind, remaining);
      this.publishInFlightMetric(kind, remaining);
      if (this.inFlightWork === 0) {
        for (const resolve of this.idleWaiters) {
          resolve();
        }
        this.idleWaiters.clear();
      }
    };
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.inFlightWork === 0) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (idle: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.idleWaiters.delete(onIdle);
        resolve(idle);
      };
      const onIdle = (): void => {
        finish(true);
      };
      const timeout = setTimeout(() => {
        finish(false);
      }, timeoutMs);
      timeout.unref();
      this.idleWaiters.add(onIdle);
    });
  }

  registerDrainHook(hook: DrainHook): () => void {
    this.drainHooks.add(hook);
    return () => this.drainHooks.delete(hook);
  }

  beginDrain(signal: NodeJS.Signals | 'test'): Promise<void> {
    if (this.drainPromise) {
      return this.drainPromise;
    }

    this.state = 'draining';
    this.logger.warn({ signal }, 'Application draining started');
    this.drainPromise = Promise.allSettled(
      [...this.drainHooks].map((hook) => hook()),
    ).then((results) => {
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        this.logger.error(
          { failureCount: failures.length },
          'One or more drain hooks failed',
        );
      }
    });

    return this.drainPromise;
  }

  private publishInFlightMetric(kind: InFlightWorkKind, value: number): void {
    this.metrics.setGauge(
      'cluchess_in_flight_work',
      'In-flight application work by instance and boundary.',
      value,
      { instance: this.instanceId, kind },
    );
  }
}
