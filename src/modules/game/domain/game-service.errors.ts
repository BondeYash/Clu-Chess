export type GameServiceErrorCode =
  | 'ALLOCATION_MISMATCH'
  | 'CLOCK_EXPIRED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'GAME_ALREADY_ENDED'
  | 'GAME_NOT_FOUND'
  | 'GAME_STATE_CORRUPT'
  | 'GAME_UNAVAILABLE'
  | 'GUEST_ALREADY_IN_GAME'
  | 'GUEST_NOT_ELIGIBLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ILLEGAL_MOVE'
  | 'NOT_A_PLAYER'
  | 'NOT_YOUR_TURN'
  | 'STALE_GAME_VERSION';

export class GameServiceError extends Error {
  constructor(
    readonly code: GameServiceErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly authoritativeVersion?: number,
    readonly responseType: 'move.rejected' | 'server.error' = 'server.error',
  ) {
    super(message);
    this.name = 'GameServiceError';
  }
}
