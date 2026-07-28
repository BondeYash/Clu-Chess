import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CorrelationContextService } from '../../src/common/logging/correlation-context.service.js';
import {
  CorrelationIdMiddleware,
  validCorrelationId,
} from '../../src/common/logging/correlation-id.middleware.js';

describe('correlation context', () => {
  it('accepts only UUID v4 correlation IDs', () => {
    expect(validCorrelationId('9ed9f4bf-f822-4f75-9e3d-b5b541261d22')).toBe(
      true,
    );
    expect(validCorrelationId('9ed9f4bf-f822-1f75-9e3d-b5b541261d22')).toBe(
      false,
    );
    expect(validCorrelationId(['not-a-string'])).toBe(false);
  });

  it('makes the ID available only inside its async context', () => {
    const context = new CorrelationContextService();
    let observed: string | undefined;

    context.run('correlation-id', () => {
      observed = context.correlationId;
    });

    expect(observed).toBe('correlation-id');
    expect(context.correlationId).toBeUndefined();
  });

  it('propagates a valid request ID into the response and context', () => {
    const context = new CorrelationContextService();
    const middleware = new CorrelationIdMiddleware(context);
    const requestId = '9ed9f4bf-f822-4f75-9e3d-b5b541261d22';
    const setHeader = vi.fn();
    let observed: string | undefined;

    middleware.use(
      { id: requestId } as Request,
      { setHeader } as unknown as Response,
      (() => {
        observed = context.correlationId;
      }) as NextFunction,
    );

    expect(setHeader).toHaveBeenCalledWith('X-Correlation-Id', requestId);
    expect(observed).toBe(requestId);
  });

  it('replaces an untrusted request ID', () => {
    const context = new CorrelationContextService();
    const middleware = new CorrelationIdMiddleware(context);
    const setHeader = vi.fn();
    let observed: string | undefined;

    middleware.use(
      { id: 'untrusted' } as Request,
      { setHeader } as unknown as Response,
      (() => {
        observed = context.correlationId;
      }) as NextFunction,
    );

    expect(observed).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
