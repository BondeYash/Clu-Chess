import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { CorrelationContextService } from '../../common/logging/correlation-context.service.js';
import { GameServiceError } from '../game/domain/game-service.errors.js';
import { DatabaseError } from '../persistence/database-errors.js';
import { SessionError } from '../session/session.errors.js';
import { RecoveryError } from './recovery.errors.js';

interface HttpRecoveryError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly status: HttpStatus;
}

@Catch()
export class RecoveryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RecoveryExceptionFilter.name);

  constructor(private readonly correlation: CorrelationContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = this.map(exception);
    if (error.status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('Unhandled recovery request failure');
    }
    const correlationId = this.correlation.correlationId ?? randomUUID();
    response.setHeader('X-Correlation-Id', correlationId);
    if (error.retryAfterMs !== undefined) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
      );
    }
    response.status(error.status).json({
      correlationId,
      error: {
        code: error.code,
        message: error.message,
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
        retryable: error.retryable,
      },
    });
  }

  private map(exception: unknown): HttpRecoveryError {
    if (exception instanceof RecoveryError) {
      return {
        code: exception.code,
        message: exception.message,
        retryable: exception.retryable,
        ...(exception.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: exception.retryAfterMs }),
        status:
          exception.code === 'BAD_REQUEST'
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.TOO_MANY_REQUESTS,
      };
    }
    if (exception instanceof SessionError) {
      return {
        code: exception.code,
        message: exception.message,
        retryable: exception.retryable,
        ...(exception.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: exception.retryAfterMs }),
        status:
          exception.code === 'SERVICE_UNAVAILABLE'
            ? HttpStatus.SERVICE_UNAVAILABLE
            : exception.code === 'UNAUTHORIZED'
              ? HttpStatus.UNAUTHORIZED
              : HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
    if (exception instanceof GameServiceError) {
      if (exception.code === 'GAME_NOT_FOUND') {
        return {
          code: exception.code,
          message: exception.message,
          retryable: exception.retryable,
          status: HttpStatus.NOT_FOUND,
        };
      }
      if (exception.code === 'NOT_A_PLAYER') {
        return {
          code: exception.code,
          message: exception.message,
          retryable: exception.retryable,
          status: HttpStatus.FORBIDDEN,
        };
      }
      if (exception.code === 'DEPENDENCY_UNAVAILABLE') {
        return {
          code: 'SERVICE_UNAVAILABLE',
          message: exception.message,
          retryable: exception.retryable,
          status: HttpStatus.SERVICE_UNAVAILABLE,
        };
      }
    }
    if (exception instanceof DatabaseError) {
      return {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The authoritative game store is temporarily unavailable.',
        retryable: true,
        status: HttpStatus.SERVICE_UNAVAILABLE,
      };
    }
    return {
      code: 'INTERNAL_ERROR',
      message: 'Recovery request could not be completed',
      retryable: true,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
