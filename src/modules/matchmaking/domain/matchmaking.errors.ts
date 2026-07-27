export type MatchmakingErrorCode =
  | 'ALREADY_IN_GAME'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'MATCH_ALLOCATION_CONFLICT'
  | 'NOT_PRESENT'
  | 'RESERVATION_MISMATCH';

export class MatchmakingError extends Error {
  constructor(
    readonly code: MatchmakingErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MatchmakingError';
  }
}
