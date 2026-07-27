export type GameServiceErrorCode =
  | 'ALLOCATION_MISMATCH'
  | 'GAME_NOT_FOUND'
  | 'GAME_UNAVAILABLE'
  | 'GUEST_ALREADY_IN_GAME'
  | 'GUEST_NOT_ELIGIBLE'
  | 'NOT_A_PLAYER'
  | 'STALE_GAME_VERSION';

export class GameServiceError extends Error {
  constructor(
    readonly code: GameServiceErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly authoritativeVersion?: number,
  ) {
    super(message);
    this.name = 'GameServiceError';
  }
}
