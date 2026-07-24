import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service.js';
import {
  IdentityGenerationError,
  IdentityService,
  type GeneratedIdentity,
} from '../identity/identity.service.js';
import { DatabaseError } from '../persistence/database-errors.js';
import {
  GUEST_SESSION_REPOSITORY,
  type GuestSessionRecord,
  type GuestSessionRepository,
  type IssuedSessionClaims,
  type SessionCommandReplay,
} from './application/ports/guest-session.repository.js';
import {
  GUEST_SOCKET_DISCONNECT_PORT,
  type GuestSocketDisconnectPort,
} from './application/ports/guest-socket-disconnect.port.js';
import { SessionRepositoryError } from './application/session-repository.errors.js';
import {
  JwtTokenService,
  type AuthenticatedGuest,
} from './jwt-token.service.js';
import { SessionError } from './session.errors.js';
import {
  RevocationUnavailableError,
  SessionRevocationService,
} from './session-revocation.service.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_NAME_ATTEMPTS = 8;

export interface PublicGuestSession {
  avatar: string;
  expiresAt: string;
  id: string;
  issuedAt: string;
  name: string;
}

export interface IssuedGuestSession {
  guest: PublicGuestSession;
  replayed: boolean;
  token: string;
}

@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(GUEST_SESSION_REPOSITORY)
    private readonly repository: GuestSessionRepository,
    @Inject(GUEST_SOCKET_DISCONNECT_PORT)
    private readonly socketDisconnect: GuestSocketDisconnectPort,
    private readonly identityService: IdentityService,
    private readonly tokens: JwtTokenService,
    private readonly revocations: SessionRevocationService,
    config: AppConfigService,
  ) {
    this.ttlSeconds = config.values.JWT_TTL_SECONDS;
  }

  async create(idempotencyKey: string): Promise<IssuedGuestSession> {
    const idempotencyHash = this.hashIdempotencyKey(idempotencyKey);
    try {
      const existing = await this.repository.findCommand(idempotencyHash);
      if (existing !== null) {
        this.assertCommand(existing, 'CREATE');
        return this.toIssuedSession(existing, true);
      }

      const guestSessionId = randomUUID();
      for (let attempt = 0; attempt < DATABASE_NAME_ATTEMPTS; attempt += 1) {
        const identity = await this.identityService.generate(guestSessionId);
        const issuedClaims = this.createIssuedClaims();
        try {
          const result = await this.repository.create({
            avatarKey: identity.avatarKey,
            displayName: identity.displayName,
            guestSessionId,
            idempotencyHash,
            issuedClaims,
          });
          this.assertCommand(result.value, 'CREATE');
          if (result.value.guestSession.id !== guestSessionId) {
            await this.safeRelease(identity, guestSessionId);
          }
          return this.toIssuedSession(result.value, result.replayed);
        } catch (error) {
          await this.safeRelease(identity, guestSessionId);
          if (
            error instanceof SessionRepositoryError &&
            error.kind === 'display-name-conflict'
          ) {
            continue;
          }
          throw error;
        }
      }
      throw new IdentityGenerationError();
    } catch (error) {
      this.rethrowStable(error);
    }
  }

  async renew(
    authenticatedGuest: AuthenticatedGuest,
    idempotencyKey: string,
  ): Promise<IssuedGuestSession> {
    const idempotencyHash = this.hashIdempotencyKey(idempotencyKey);
    try {
      const existing = await this.repository.findCommand(idempotencyHash);
      if (existing !== null) {
        this.assertCommand(
          existing,
          'RENEW',
          authenticatedGuest.guestSessionId,
        );
        return this.toIssuedSession(existing, true);
      }

      const result = await this.repository.renew({
        guestSessionId: authenticatedGuest.guestSessionId,
        idempotencyHash,
        issuedClaims: this.createIssuedClaims(),
      });
      this.assertCommand(
        result.value,
        'RENEW',
        authenticatedGuest.guestSessionId,
      );
      return this.toIssuedSession(result.value, result.replayed);
    } catch (error) {
      this.rethrowStable(error);
    }
  }

  async getCurrent(
    authenticatedGuest: AuthenticatedGuest,
    now = new Date(),
  ): Promise<PublicGuestSession> {
    try {
      const guestSession = await this.repository.findById(
        authenticatedGuest.guestSessionId,
      );
      if (guestSession?.revokedAt !== null || guestSession.expiresAt <= now) {
        throw new SessionError(
          'UNAUTHORIZED',
          'Guest session is invalid or expired',
          false,
        );
      }
      return this.toPublicGuest(guestSession);
    } catch (error) {
      this.rethrowStable(error);
    }
  }

  async reset(
    authenticatedGuest: AuthenticatedGuest,
    idempotencyKey: string,
    tokenWasRevoked: boolean,
  ): Promise<void> {
    const idempotencyHash = this.hashIdempotencyKey(idempotencyKey);
    try {
      const existing = await this.repository.findCommand(idempotencyHash);
      if (existing !== null) {
        this.assertCommand(
          existing,
          'RESET',
          authenticatedGuest.guestSessionId,
        );
        await this.finishReset(existing.guestSession, authenticatedGuest);
        return;
      }
      if (tokenWasRevoked) {
        throw new SessionError(
          'UNAUTHORIZED',
          'Guest session is invalid or revoked',
          false,
        );
      }

      const result = await this.repository.reset({
        guestSessionId: authenticatedGuest.guestSessionId,
        idempotencyHash,
        revokedAt: new Date(),
      });
      this.assertCommand(
        result.value,
        'RESET',
        authenticatedGuest.guestSessionId,
      );
      await this.finishReset(result.value.guestSession, authenticatedGuest);
    } catch (error) {
      this.rethrowStable(error);
    }
  }

  private async finishReset(
    guestSession: GuestSessionRecord,
    authenticatedGuest: AuthenticatedGuest,
  ): Promise<void> {
    await this.revocations.revoke(guestSession, authenticatedGuest);
    await this.socketDisconnect.disconnectGuest(guestSession.id);
  }

  private assertCommand(
    command: SessionCommandReplay,
    expectedType: SessionCommandReplay['commandType'],
    expectedGuestSessionId?: string,
  ): void {
    if (
      command.commandType !== expectedType ||
      (expectedGuestSessionId !== undefined &&
        command.guestSession.id !== expectedGuestSessionId)
    ) {
      throw new SessionError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used for another operation',
        false,
      );
    }
    if (
      (expectedType === 'CREATE' || expectedType === 'RENEW') &&
      command.issuedClaims === null
    ) {
      throw new SessionError(
        'INTERNAL_ERROR',
        'Stored session command is invalid',
        false,
      );
    }
  }

  private createIssuedClaims(now = new Date()): IssuedSessionClaims {
    const issuedAtMs = Math.floor(now.getTime() / 1000) * 1000;
    return {
      expiresAt: new Date(issuedAtMs + this.ttlSeconds * 1000),
      issuedAt: new Date(issuedAtMs),
      jti: randomUUID(),
    };
  }

  private hashIdempotencyKey(idempotencyKey: string): string {
    const normalized = idempotencyKey.trim().toLowerCase();
    if (!UUID_V4.test(normalized)) {
      throw new SessionError(
        'BAD_REQUEST',
        'Idempotency-Key must be a UUIDv4',
        false,
      );
    }
    return createHash('sha256').update(normalized).digest('hex');
  }

  private toIssuedSession(
    command: SessionCommandReplay,
    replayed: boolean,
  ): IssuedGuestSession {
    if (command.issuedClaims === null) {
      throw new SessionError(
        'INTERNAL_ERROR',
        'Stored token issuance is invalid',
        false,
      );
    }
    return {
      guest: this.toPublicGuest(command.guestSession),
      replayed,
      token: this.tokens.issue(command.guestSession, command.issuedClaims),
    };
  }

  private toPublicGuest(guestSession: GuestSessionRecord): PublicGuestSession {
    return {
      avatar: guestSession.avatarKey,
      expiresAt: guestSession.expiresAt.toISOString(),
      id: guestSession.id,
      issuedAt: guestSession.issuedAt.toISOString(),
      name: guestSession.displayName,
    };
  }

  private async safeRelease(
    identity: GeneratedIdentity,
    guestSessionId: string,
  ): Promise<void> {
    try {
      await this.identityService.release(identity, guestSessionId);
    } catch {
      // The reservation is ephemeral and expires automatically.
    }
  }

  private rethrowStable(error: unknown): never {
    if (error instanceof SessionError) {
      throw error;
    }
    if (
      error instanceof IdentityGenerationError ||
      error instanceof RevocationUnavailableError
    ) {
      throw new SessionError(
        'SERVICE_UNAVAILABLE',
        'Session service is temporarily unavailable',
        true,
      );
    }
    if (error instanceof SessionRepositoryError) {
      if (error.kind === 'session-unavailable') {
        throw new SessionError(
          'UNAUTHORIZED',
          'Guest session is invalid or expired',
          false,
        );
      }
      throw new SessionError(
        'SERVICE_UNAVAILABLE',
        'Session service is temporarily unavailable',
        true,
      );
    }
    if (error instanceof DatabaseError) {
      throw new SessionError(
        error.kind === 'unknown' ? 'INTERNAL_ERROR' : 'SERVICE_UNAVAILABLE',
        error.kind === 'unknown'
          ? 'Session request could not be completed'
          : 'Session service is temporarily unavailable',
        error.retryable,
      );
    }
    throw new SessionError(
      'INTERNAL_ERROR',
      'Session request could not be completed',
      false,
    );
  }
}
