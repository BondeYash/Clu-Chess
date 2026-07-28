import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { CorrelationContextService } from '../../common/logging/correlation-context.service.js';
import { clientAddress } from '../../common/network/client-address.js';
import {
  ResetSessionAuthGuard,
  SessionAuthGuard,
} from './session-auth.guard.js';
import type { AuthenticatedSessionRequest } from './session-authentication.service.js';
import { SessionExceptionFilter } from './session-exception.filter.js';
import { SessionRateLimitService } from './session-rate-limit.service.js';
import {
  createSessionResponseSchema,
  emptySessionBodySchema,
  getSessionResponseSchema,
  renewSessionResponseSchema,
  resetSessionResponseSchema,
} from './session.schemas.js';
import { SessionError } from './session.errors.js';
import { SessionService } from './session.service.js';
import type { AuthenticatedGuest } from './jwt-token.service.js';

@Controller('session')
@UseFilters(SessionExceptionFilter)
export class SessionController {
  private readonly cookieEnabled: boolean;
  private readonly cookieName: string;
  private readonly secureCookie: boolean;
  private readonly trustedProxyHops: number;

  constructor(
    private readonly sessions: SessionService,
    private readonly rateLimits: SessionRateLimitService,
    private readonly correlation: CorrelationContextService,
    config: AppConfigService,
  ) {
    this.cookieEnabled = config.values.SESSION_COOKIE_ENABLED;
    this.cookieName = config.values.SESSION_COOKIE_NAME;
    this.secureCookie = config.values.NODE_ENV !== 'development';
    this.trustedProxyHops = config.values.TRUST_PROXY_HOPS;
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    this.assertEmptyBody(body);
    await this.rateLimits.consume('create', this.clientAddress(request));
    const result = await this.sessions.create(idempotencyKey ?? '');
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    this.setCookie(response, result.token, result.guest.expiresAt);
    return createSessionResponseSchema.parse({
      correlationId: this.correlationId(),
      guest: {
        avatar: result.guest.avatar,
        expiresAt: result.guest.expiresAt,
        id: result.guest.id,
        name: result.guest.name,
      },
      token: result.token,
    });
  }

  @Post('renew')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  async renew(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    this.assertEmptyBody(body);
    const identity = this.identity(request);
    await this.rateLimits.consume('renew', identity.guestSessionId);
    const result = await this.sessions.renew(identity, idempotencyKey ?? '');
    this.setCookie(response, result.token, result.guest.expiresAt);
    return renewSessionResponseSchema.parse({
      correlationId: this.correlationId(),
      expiresAt: result.guest.expiresAt,
      token: result.token,
    });
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  async getCurrent(
    @Req() request: AuthenticatedSessionRequest,
  ): Promise<unknown> {
    const identity = this.identity(request);
    await this.rateLimits.consume('get', identity.guestSessionId);
    const guest = await this.sessions.getCurrent(identity);
    return getSessionResponseSchema.parse({
      correlationId: this.correlationId(),
      guest,
    });
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResetSessionAuthGuard)
  async reset(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    this.assertEmptyBody(body);
    const identity = this.identity(request);
    await this.rateLimits.consume('reset', identity.guestSessionId);
    await this.sessions.reset(
      identity,
      idempotencyKey ?? '',
      request.tokenWasRevoked ?? false,
    );
    this.clearCookie(response);
    return resetSessionResponseSchema.parse({
      correlationId: this.correlationId(),
      ok: true,
    });
  }

  private assertEmptyBody(body: unknown): void {
    if (!emptySessionBodySchema.safeParse(body).success) {
      throw new SessionError(
        'BAD_REQUEST',
        'Request body must be an empty JSON object',
        false,
      );
    }
  }

  private clearCookie(response: Response): void {
    if (this.cookieEnabled) {
      response.clearCookie(this.cookieName, this.cookieOptions());
    }
  }

  private clientAddress(request: AuthenticatedSessionRequest): string {
    return clientAddress(
      request.headers,
      request.socket.remoteAddress,
      this.trustedProxyHops,
    );
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.secureCookie,
    };
  }

  private correlationId(): string {
    const correlationId = this.correlation.correlationId;
    if (correlationId === undefined) {
      throw new SessionError(
        'INTERNAL_ERROR',
        'Session request could not be completed',
        false,
      );
    }
    return correlationId;
  }

  private identity(request: AuthenticatedSessionRequest): AuthenticatedGuest {
    const identity = request.authenticatedGuest;
    if (identity === undefined) {
      throw new SessionError(
        'UNAUTHORIZED',
        'Guest authentication is required',
        false,
      );
    }
    return identity;
  }

  private setCookie(
    response: Response,
    token: string,
    expiresAt: string,
  ): void {
    if (this.cookieEnabled) {
      response.cookie(this.cookieName, token, {
        ...this.cookieOptions(),
        expires: new Date(expiresAt),
      });
    }
  }
}
