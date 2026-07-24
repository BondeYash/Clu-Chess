import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import type { GuestSessionRecord } from './application/ports/guest-session.repository.js';
import type { AuthenticatedGuest } from './jwt-token.service.js';

export class RevocationUnavailableError extends Error {
  constructor() {
    super('Session revocation state is unavailable');
    this.name = 'RevocationUnavailableError';
  }
}

@Injectable()
export class SessionRevocationService {
  private readonly clockSkewSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: AppConfigService,
  ) {
    this.clockSkewSeconds = config.values.JWT_CLOCK_SKEW_SECONDS;
  }

  async isRevoked(identity: AuthenticatedGuest): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      const [sessionRevoked, tokenRevoked] = await this.redis.connection.mget(
        this.sessionKey(identity.guestSessionId),
        this.tokenKey(identity.jti),
      );
      return sessionRevoked !== null || tokenRevoked !== null;
    } catch {
      throw new RevocationUnavailableError();
    }
  }

  async revoke(
    guestSession: GuestSessionRecord,
    identity: AuthenticatedGuest,
    now = new Date(),
  ): Promise<void> {
    const latestExpiryMs = Math.max(
      guestSession.expiresAt.getTime(),
      identity.expiresAt.getTime(),
    );
    const sessionTtl = this.ttlSeconds(latestExpiryMs, now);
    const tokenTtl = this.ttlSeconds(identity.expiresAt.getTime(), now);
    try {
      await this.redis.ensureConnected();
      const results = await this.redis.connection
        .pipeline()
        .set(
          this.sessionKey(guestSession.id),
          String(latestExpiryMs),
          'EX',
          sessionTtl,
        )
        .set(this.tokenKey(identity.jti), '1', 'EX', tokenTtl)
        .exec();
      if (
        results === null ||
        results.some(([error]: [Error | null, unknown]) => error !== null)
      ) {
        throw new Error('Redis revocation pipeline failed');
      }
    } catch {
      throw new RevocationUnavailableError();
    }
  }

  async restoreSessionRevocation(
    guestSession: GuestSessionRecord,
    now = new Date(),
  ): Promise<void> {
    try {
      await this.redis.ensureConnected();
      await this.redis.connection.set(
        this.sessionKey(guestSession.id),
        String(guestSession.expiresAt.getTime()),
        'EX',
        this.ttlSeconds(guestSession.expiresAt.getTime(), now),
      );
    } catch {
      throw new RevocationUnavailableError();
    }
  }

  private sessionKey(guestSessionId: string): string {
    return `jwt:revoked-session:${guestSessionId}`;
  }

  private tokenKey(jti: string): string {
    return `jwt:denylist:${jti}`;
  }

  private ttlSeconds(expiryMs: number, now: Date): number {
    return Math.max(
      1,
      Math.ceil((expiryMs - now.getTime()) / 1000) + this.clockSkewSeconds,
    );
  }
}
