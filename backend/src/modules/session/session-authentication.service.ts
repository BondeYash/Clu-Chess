import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../common/config/app-config.service.js';
import {
  JwtTokenService,
  TokenVerificationError,
  type AuthenticatedGuest,
} from './jwt-token.service.js';
import {
  RevocationUnavailableError,
  SessionRevocationService,
} from './session-revocation.service.js';
import { SessionError } from './session.errors.js';

export interface AuthenticatedSessionRequest extends Request {
  authenticatedGuest?: AuthenticatedGuest;
  tokenWasRevoked?: boolean;
}

@Injectable()
export class SessionAuthenticationService {
  private readonly cookieName: string;

  constructor(
    private readonly tokens: JwtTokenService,
    private readonly revocations: SessionRevocationService,
    config: AppConfigService,
  ) {
    this.cookieName = config.values.SESSION_COOKIE_NAME;
  }

  async authenticate(
    request: AuthenticatedSessionRequest,
    allowRevoked: boolean,
  ): Promise<void> {
    try {
      const identity = this.tokens.verify(this.extractToken(request));
      const revoked = await this.revocations.isRevoked(identity);
      if (revoked && !allowRevoked) {
        throw this.unauthorized();
      }
      request.authenticatedGuest = identity;
      request.tokenWasRevoked = revoked;
    } catch (error) {
      if (error instanceof SessionError) {
        throw error;
      }
      if (error instanceof RevocationUnavailableError) {
        throw new SessionError(
          'SERVICE_UNAVAILABLE',
          'Session service is temporarily unavailable',
          true,
        );
      }
      if (error instanceof TokenVerificationError) {
        throw this.unauthorized();
      }
      throw this.unauthorized();
    }
  }

  private extractToken(request: Request): string {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (match?.[1] === undefined) {
        throw this.unauthorized();
      }
      return match[1];
    }

    const cookieHeader = request.headers.cookie;
    if (cookieHeader !== undefined) {
      for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) {
          continue;
        }
        const name = part.slice(0, separator).trim();
        if (name === this.cookieName) {
          const value = part.slice(separator + 1).trim();
          if (value.length > 0) {
            return value;
          }
        }
      }
    }
    throw this.unauthorized();
  }

  private unauthorized(): SessionError {
    return new SessionError(
      'UNAUTHORIZED',
      'Guest authentication is required',
      false,
    );
  }
}
