import { Injectable } from '@nestjs/common';
import { GameServiceError } from '../game/domain/game-service.errors.js';
import { MatchmakingError } from '../matchmaking/domain/matchmaking.errors.js';
import { DatabaseError } from '../persistence/database-errors.js';
import { RealtimeRedisUnavailableError } from './infrastructure/realtime-redis.errors.js';
import { RealtimeError } from './protocol/realtime.errors.js';
import type { ProtocolErrorCode } from './protocol/protocol.constants.js';
import type { ProtocolErrorPayload } from './protocol/protocol.schemas.js';

export interface MappedRealtimeError {
  error: ProtocolErrorPayload;
  gameVersion?: number;
  responseType: 'move.rejected' | 'server.error';
}

@Injectable()
export class RealtimeErrorMapperService {
  map(error: unknown): MappedRealtimeError {
    if (error instanceof RealtimeError) {
      return {
        error: this.payload(error),
        ...(error.options.gameVersion === undefined
          ? {}
          : { gameVersion: error.options.gameVersion }),
        responseType: error.options.responseType ?? 'server.error',
      };
    }
    if (error instanceof RealtimeRedisUnavailableError) {
      return {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Realtime service is temporarily unavailable',
          retryable: true,
        },
        responseType: 'server.error',
      };
    }
    if (error instanceof MatchmakingError) {
      return {
        error: {
          code:
            error.code === 'ALREADY_IN_GAME'
              ? 'ALREADY_IN_GAME'
              : 'SERVICE_UNAVAILABLE',
          message: error.message,
          retryable: error.retryable,
        },
        responseType: 'server.error',
      };
    }
    if (error instanceof GameServiceError) {
      return {
        error: {
          ...(error.authoritativeVersion === undefined
            ? {}
            : { authoritativeVersion: error.authoritativeVersion }),
          code: this.gameErrorCode(error),
          message: error.message,
          retryable: error.retryable,
        },
        ...(error.authoritativeVersion === undefined
          ? {}
          : { gameVersion: error.authoritativeVersion }),
        responseType: error.responseType,
      };
    }
    if (error instanceof DatabaseError) {
      return {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Realtime service is temporarily unavailable',
          retryable: true,
        },
        responseType: 'server.error',
      };
    }
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Realtime request could not be completed',
        retryable: true,
      },
      responseType: 'server.error',
    };
  }

  private gameErrorCode(error: GameServiceError): ProtocolErrorCode {
    switch (error.code) {
      case 'CLOCK_EXPIRED':
        return 'CLOCK_EXPIRED';
      case 'GAME_ALREADY_ENDED':
        return 'GAME_ALREADY_ENDED';
      case 'GAME_NOT_FOUND':
        return 'GAME_NOT_FOUND';
      case 'IDEMPOTENCY_KEY_REUSED':
        return 'IDEMPOTENCY_KEY_REUSED';
      case 'ILLEGAL_MOVE':
        return 'ILLEGAL_MOVE';
      case 'NOT_A_PLAYER':
        return 'NOT_A_PLAYER';
      case 'NOT_YOUR_TURN':
        return 'NOT_YOUR_TURN';
      case 'STALE_GAME_VERSION':
        return 'STALE_GAME_VERSION';
      case 'GUEST_ALREADY_IN_GAME':
        return 'ALREADY_IN_GAME';
      default:
        return 'SERVICE_UNAVAILABLE';
    }
  }

  private payload(error: RealtimeError): ProtocolErrorPayload {
    return {
      ...(error.options.authoritativeVersion === undefined
        ? {}
        : {
            authoritativeVersion: error.options.authoritativeVersion,
          }),
      code: error.code,
      message: error.message,
      ...(error.options.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: error.options.retryAfterMs }),
      retryable: error.retryable,
    };
  }
}
