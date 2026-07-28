import {
  Controller,
  Get,
  Param,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { CorrelationContextService } from '../../common/logging/correlation-context.service.js';
import { GameRecoveryService } from '../game/game-recovery.service.js';
import { SessionAuthGuard } from '../session/session-auth.guard.js';
import type { AuthenticatedSessionRequest } from '../session/session-authentication.service.js';
import type { AuthenticatedGuest } from '../session/jwt-token.service.js';
import { RecoveryError } from './recovery.errors.js';
import { RecoveryExceptionFilter } from './recovery-exception.filter.js';
import { RecoveryRateLimitService } from './recovery-rate-limit.service.js';
import {
  activeGameResponseSchema,
  gameIdParameterSchema,
  recoveredSnapshotResponseSchema,
} from './recovery.schemas.js';

@Controller('games')
@UseFilters(RecoveryExceptionFilter)
@UseGuards(SessionAuthGuard)
export class RecoveryController {
  constructor(
    private readonly correlation: CorrelationContextService,
    private readonly games: GameRecoveryService,
    private readonly rateLimits: RecoveryRateLimitService,
  ) {}

  @Get('active')
  async active(@Req() request: AuthenticatedSessionRequest): Promise<unknown> {
    const identity = this.identity(request);
    await this.rateLimits.consume('active', identity.guestSessionId);
    const gameId = await this.games.activeGameId(identity.guestSessionId);
    return activeGameResponseSchema.parse({
      correlationId: this.correlationId(),
      gameId,
    });
  }

  @Get(':id/snapshot')
  async snapshot(
    @Param('id') rawGameId: string,
    @Req() request: AuthenticatedSessionRequest,
  ): Promise<unknown> {
    const gameId = gameIdParameterSchema.safeParse(rawGameId);
    if (!gameId.success) {
      throw new RecoveryError(
        'BAD_REQUEST',
        'Game identifier must be a UUID v4',
        false,
      );
    }
    const identity = this.identity(request);
    await this.rateLimits.consume('snapshot', identity.guestSessionId);
    const recovered = await this.games.snapshot(
      gameId.data,
      identity.guestSessionId,
    );
    return recoveredSnapshotResponseSchema.parse({
      ...recovered.payload,
      correlationId: this.correlationId(),
      gameId: recovered.gameId,
      gameVersion: recovered.gameVersion,
    });
  }

  private correlationId(): string {
    const correlationId = this.correlation.correlationId;
    if (correlationId === undefined) {
      throw new Error('Recovery correlation context is unavailable.');
    }
    return correlationId;
  }

  private identity(request: AuthenticatedSessionRequest): AuthenticatedGuest {
    const identity = request.authenticatedGuest;
    if (identity === undefined) {
      throw new RecoveryError(
        'BAD_REQUEST',
        'Authenticated guest context is unavailable',
        false,
      );
    }
    return identity;
  }
}
