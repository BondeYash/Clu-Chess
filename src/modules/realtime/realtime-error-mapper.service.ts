import { Injectable } from '@nestjs/common';
import { DatabaseError } from '../persistence/database-errors.js';
import { RealtimeRedisUnavailableError } from './infrastructure/realtime-redis.errors.js';
import { RealtimeError } from './protocol/realtime.errors.js';
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
    if (error instanceof DatabaseError) {
      return {
        error: {
          code:
            error.kind === 'unknown' ? 'INTERNAL_ERROR' : 'SERVICE_UNAVAILABLE',
          message:
            error.kind === 'unknown'
              ? 'Realtime request could not be completed'
              : 'Realtime service is temporarily unavailable',
          retryable: error.retryable,
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
