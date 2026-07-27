import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppConfigService } from '../../common/config/app-config.service.js';
import {
  JwtTokenService,
  TokenVerificationError,
} from '../session/jwt-token.service.js';
import {
  RevocationUnavailableError,
  SessionRevocationService,
} from '../session/session-revocation.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { ConnectionRegistryService } from './connection-registry.service.js';
import { RealtimeRedisUnavailableError } from './infrastructure/realtime-redis.errors.js';
import { RealtimeError } from './protocol/realtime.errors.js';
import type {
  AuthenticatedSocketIdentity,
  RealtimeSocket,
} from './realtime.types.js';

const handshakeAuthSchema = z
  .object({ token: z.string().min(1).max(8192) })
  .strict();

@Injectable()
export class RealtimeAuthenticationService {
  private readonly instanceId: string;

  constructor(
    private readonly tokens: JwtTokenService,
    private readonly revocations: SessionRevocationService,
    private readonly presence: PresenceService,
    private readonly connections: ConnectionRegistryService,
    config: AppConfigService,
  ) {
    this.instanceId = config.values.INSTANCE_ID;
  }

  async authenticate(
    socket: RealtimeSocket,
    correlationId: string,
  ): Promise<void> {
    const auth = handshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!auth.success) {
      throw this.unauthorized();
    }

    try {
      const token = auth.data.token;
      this.clearHandshakeToken(socket);
      const authenticated = this.tokens.verify(token);
      if (await this.revocations.isRevoked(authenticated)) {
        throw this.unauthorized();
      }
      const identity = Object.freeze<AuthenticatedSocketIdentity>({
        avatar: authenticated.avatarKey,
        expiresAt: authenticated.expiresAt.toISOString(),
        guestSessionId: authenticated.guestSessionId,
        name: authenticated.name,
      });
      const socketMember = `${this.instanceId}:${socket.id}`;
      const addressHash = this.connections.addressHash(
        socket.handshake.address,
      );

      await this.connections.acquire(addressHash, socketMember);
      try {
        await this.presence.markConnected(
          authenticated.guestSessionId,
          socketMember,
        );
      } catch (error) {
        await this.safeReleaseConnection(addressHash, socketMember);
        throw error;
      }

      Object.defineProperty(socket.data, 'identity', {
        configurable: false,
        enumerable: true,
        value: identity,
        writable: false,
      });
      socket.data.addressHash = addressHash;
      socket.data.correlationId = correlationId;
      socket.data.socketMember = socketMember;
    } catch (error) {
      if (error instanceof RealtimeError) {
        throw error;
      }
      if (
        error instanceof TokenVerificationError ||
        error instanceof RevocationUnavailableError
      ) {
        if (error instanceof RevocationUnavailableError) {
          throw new RealtimeRedisUnavailableError();
        }
        throw this.unauthorized();
      }
      throw error;
    }
  }

  private async safeReleaseConnection(
    addressHash: string,
    socketMember: string,
  ): Promise<void> {
    try {
      await this.connections.release(addressHash, socketMember);
    } catch {
      // The short-lived registry member expires without manual repair.
    }
  }

  private clearHandshakeToken(socket: RealtimeSocket): void {
    delete (socket.handshake.auth as Record<string, unknown>).token;
  }

  private unauthorized(): RealtimeError {
    return new RealtimeError(
      'UNAUTHORIZED',
      'Guest authentication is required',
      false,
    );
  }
}
