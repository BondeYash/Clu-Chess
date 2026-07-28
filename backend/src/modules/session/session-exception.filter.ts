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
import { SessionError, type SessionErrorCode } from './session.errors.js';

const STATUS_BY_CODE: Readonly<Record<SessionErrorCode, HttpStatus>> =
  Object.freeze({
    BAD_REQUEST: HttpStatus.BAD_REQUEST,
    IDEMPOTENCY_KEY_REUSED: HttpStatus.CONFLICT,
    INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
    RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
    SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
    UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  });

@Catch()
export class SessionExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SessionExceptionFilter.name);

  constructor(private readonly context: CorrelationContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error =
      exception instanceof SessionError
        ? exception
        : new SessionError(
            'INTERNAL_ERROR',
            'Session request could not be completed',
            false,
          );
    if (!(exception instanceof SessionError)) {
      this.logger.error('Unhandled session request failure');
    }

    const correlationId = this.context.correlationId ?? randomUUID();
    response.setHeader('X-Correlation-Id', correlationId);
    if (error.retryAfterMs !== undefined) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
      );
    }
    const errorBody: {
      code: SessionErrorCode;
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
    } = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
    if (error.retryAfterMs !== undefined) {
      errorBody.retryAfterMs = error.retryAfterMs;
    }
    response.status(STATUS_BY_CODE[error.code]).json({
      correlationId,
      error: errorBody,
    });
  }
}
