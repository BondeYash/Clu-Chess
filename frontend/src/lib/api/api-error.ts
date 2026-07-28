export type ApiErrorCode =
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | (string & {});

export interface ApiErrorOptions {
  cause?: unknown;
  code: ApiErrorCode;
  correlationId?: string | undefined;
  message: string;
  retryable: boolean;
  retryAfterMs?: number | undefined;
  status: number;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly correlationId: string | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly status: number;

  constructor({
    cause,
    code,
    correlationId,
    message,
    retryable,
    retryAfterMs,
    status,
  }: ApiErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.code = code;
    this.correlationId = correlationId;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorizedError(error: unknown): error is ApiError {
  return (
    isApiError(error) && (error.status === 401 || error.code === 'UNAUTHORIZED')
  );
}
