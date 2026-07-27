export type RecoveryErrorCode = 'BAD_REQUEST' | 'RATE_LIMITED';

export class RecoveryError extends Error {
  constructor(
    readonly code: RecoveryErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RecoveryError';
  }
}
