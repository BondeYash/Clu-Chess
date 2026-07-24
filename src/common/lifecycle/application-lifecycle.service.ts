import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

export type ApplicationState = 'starting' | 'ready' | 'draining';
export type DrainHook = () => Promise<void>;

@Injectable()
export class ApplicationLifecycleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApplicationLifecycleService.name);
  private readonly drainHooks = new Set<DrainHook>();
  private state: ApplicationState = 'starting';
  private drainPromise?: Promise<void>;

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
}
