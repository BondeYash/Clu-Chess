import type { ProtocolErrorPayload } from '@cluchess/protocol-v1/realtime';

export class RealtimeError extends Error {
  readonly authoritativeVersion?: number | undefined;
  readonly code: string;
  readonly correlationId?: string | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly retryable: boolean;

  constructor({
    authoritativeVersion,
    cause,
    code,
    correlationId,
    message,
    retryAfterMs,
    retryable,
  }: {
    authoritativeVersion?: number | undefined;
    cause?: unknown;
    code: string;
    correlationId?: string | undefined;
    message: string;
    retryAfterMs?: number | undefined;
    retryable: boolean;
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RealtimeError';
    this.authoritativeVersion = authoritativeVersion;
    this.code = code;
    this.correlationId = correlationId;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
  }
}

export function fromProtocolError(
  error: ProtocolErrorPayload,
  correlationId?: string,
): RealtimeError {
  return new RealtimeError({
    authoritativeVersion: error.authoritativeVersion,
    code: error.code,
    correlationId,
    message: error.message,
    retryAfterMs: error.retryAfterMs,
    retryable: error.retryable,
  });
}

export function isRealtimeError(error: unknown): error is RealtimeError {
  return error instanceof RealtimeError;
}
