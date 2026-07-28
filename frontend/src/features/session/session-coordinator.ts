import type {
  CreateSessionResponse,
  GetSessionResponse,
} from '@cluchess/protocol-v1/http';

import { isApiError, isUnauthorizedError } from '@/lib/api/api-error';

import { sessionApi, type SessionApiClient } from './session-api';
import {
  sessionStorageAdapter,
  type SessionOperation,
  type SessionStoragePort,
} from './session-storage';

const RENEWAL_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 3;

export interface GuestIdentity {
  avatar: string;
  expiresAt: string;
  id: string;
  issuedAt: string;
  name: string;
}

export type SessionBootstrapResult =
  | {
      activeGameId: string | null;
      activeGameStatus: 'available' | 'unavailable';
      guest: GuestIdentity;
      status: 'ready';
    }
  | {
      activeGameId: string | null;
      status: 'identity-lost';
    }
  | {
      status: 'anonymous';
    };

export interface BootstrapOptions {
  allowCreate: boolean;
}

interface CoordinatorDependencies {
  api?: SessionApiClient;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  storage?: SessionStoragePort;
}

export class SessionCoordinator {
  private readonly api: SessionApiClient;
  private bootstrapFlight:
    | {
        allowCreate: boolean;
        promise: Promise<SessionBootstrapResult>;
      }
    | undefined;
  private readonly now: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly storage: SessionStoragePort;

  constructor({
    api = sessionApi,
    now = Date.now,
    sleep = (delayMs) =>
      new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      }),
    storage = sessionStorageAdapter,
  }: CoordinatorDependencies = {}) {
    this.api = api;
    this.now = now;
    this.sleep = sleep;
    this.storage = storage;
  }

  bootstrap(options: BootstrapOptions): Promise<SessionBootstrapResult> {
    if (this.bootstrapFlight) {
      if (options.allowCreate && !this.bootstrapFlight.allowCreate) {
        return this.bootstrapFlight.promise.then((result) =>
          result.status === 'anonymous' ? this.bootstrap(options) : result,
        );
      }

      return this.bootstrapFlight.promise;
    }

    const promise = this.bootstrapInternal(options).finally(() => {
      if (this.bootstrapFlight?.promise === promise) {
        this.bootstrapFlight = undefined;
      }
    });

    this.bootstrapFlight = {
      allowCreate: options.allowCreate,
      promise,
    };

    return promise;
  }

  renewalDelay(result: SessionBootstrapResult): number | null {
    if (result.status !== 'ready') return null;
    return Math.max(
      0,
      Date.parse(result.guest.expiresAt) - this.now() - RENEWAL_WINDOW_MS,
    );
  }

  async renewReadySession(
    current: Extract<SessionBootstrapResult, { status: 'ready' }>,
  ): Promise<SessionBootstrapResult> {
    const token = this.storage.getToken();
    if (!token) {
      return {
        activeGameId: current.activeGameId ?? this.storage.getActiveGameHint(),
        status: 'identity-lost',
      };
    }

    try {
      const renewed = await this.executeIdempotent('renew', (key) =>
        this.api.renew(key, token),
      );
      this.storage.setToken(renewed.token);
      return {
        ...current,
        guest: { ...current.guest, expiresAt: renewed.expiresAt },
      };
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return {
          activeGameId:
            current.activeGameId ?? this.storage.getActiveGameHint(),
          status: 'identity-lost',
        };
      }
      throw error;
    }
  }

  async resetAndCreate(): Promise<SessionBootstrapResult> {
    const token = this.storage.getToken();
    if (!token) {
      return {
        activeGameId: this.storage.getActiveGameHint(),
        status: 'identity-lost',
      };
    }

    await this.executeIdempotent('reset', (key) => this.api.reset(key, token));
    this.storage.clearAll();
    return this.bootstrap({ allowCreate: true });
  }

  private async bootstrapInternal({
    allowCreate,
  }: BootstrapOptions): Promise<SessionBootstrapResult> {
    const storedToken = this.storage.getToken();
    let current: GetSessionResponse | undefined;
    let token = storedToken;

    try {
      current = await this.api.getCurrent(token ?? undefined);
    } catch (error) {
      if (!isUnauthorizedError(error)) throw error;
      if (token) {
        this.storage.clearToken();
        token = null;
        try {
          current = await this.api.getCurrent();
        } catch (cookieError) {
          if (!isUnauthorizedError(cookieError)) throw cookieError;
        }
      }
    }

    if (!current) {
      const activeGameId = this.storage.getActiveGameHint();
      if (activeGameId) return { activeGameId, status: 'identity-lost' };
      if (!allowCreate) return { status: 'anonymous' };
      return this.createIdentity();
    }

    let guest = current.guest;
    if (!token || this.shouldRenew(guest.expiresAt)) {
      try {
        const renewed = await this.executeIdempotent('renew', (key) =>
          this.api.renew(key, token ?? undefined),
        );
        token = renewed.token;
        this.storage.setToken(renewed.token);
        guest = { ...guest, expiresAt: renewed.expiresAt };
      } catch (error) {
        if (isUnauthorizedError(error)) {
          return {
            activeGameId: this.storage.getActiveGameHint(),
            status: 'identity-lost',
          };
        }
        throw error;
      }
    }

    return this.attachActiveGame(guest, token);
  }

  private async createIdentity(): Promise<SessionBootstrapResult> {
    const created = await this.executeIdempotent('create', (key) =>
      this.api.create(key),
    );
    this.storage.setToken(created.token);
    return this.attachActiveGame(
      normalizeCreatedGuest(created, this.now()),
      created.token,
    );
  }

  private async attachActiveGame(
    guest: GuestIdentity,
    token: string,
  ): Promise<SessionBootstrapResult> {
    try {
      const active = await this.api.getActive(token);
      this.storage.setActiveGameHint(active.gameId);
      return {
        activeGameId: active.gameId,
        activeGameStatus: 'available',
        guest,
        status: 'ready',
      };
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return {
          activeGameId: this.storage.getActiveGameHint(),
          status: 'identity-lost',
        };
      }
      return {
        activeGameId: this.storage.getActiveGameHint(),
        activeGameStatus: 'unavailable',
        guest,
        status: 'ready',
      };
    }
  }

  private async executeIdempotent<T>(
    operation: SessionOperation,
    action: (key: string) => Promise<T>,
  ): Promise<T> {
    const key = this.storage.getOrCreateOperationKey(operation);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await action(key);
        this.storage.clearOperation(operation);
        return result;
      } catch (error) {
        const retryable = isApiError(error) && error.retryable;
        if (!retryable) {
          this.storage.clearOperation(operation);
          throw error;
        }
        if (attempt === MAX_ATTEMPTS) throw error;
        const delay = isApiError(error)
          ? Math.min(
              error.retryAfterMs ?? DEFAULT_RETRY_DELAY_MS * attempt,
              MAX_RETRY_DELAY_MS,
            )
          : DEFAULT_RETRY_DELAY_MS * attempt;
        await this.sleep(delay);
      }
    }
    throw new Error('Unreachable idempotent request state');
  }

  private shouldRenew(expiresAt: string): boolean {
    return Date.parse(expiresAt) - this.now() <= RENEWAL_WINDOW_MS;
  }
}

function normalizeCreatedGuest(
  response: CreateSessionResponse,
  now: number,
): GuestIdentity {
  return {
    ...response.guest,
    issuedAt: new Date(now).toISOString(),
  };
}

export const sessionCoordinator = new SessionCoordinator();
