import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CorrelationContextService } from './correlation-context.service.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly context: CorrelationContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = request.id;
    const correlationId =
      typeof requestId === 'string' && validCorrelationId(requestId)
        ? requestId
        : randomUUID();

    response.setHeader('X-Correlation-Id', correlationId);
    this.context.run(correlationId, next);
  }
}
