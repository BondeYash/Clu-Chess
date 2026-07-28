export type GameDomainErrorCode =
  | 'ILLEGAL_GAME_TRANSITION'
  | 'INVALID_CLOCK_STATE'
  | 'INVALID_GAME_STATE'
  | 'INVALID_TERMINAL_EVENT';

export class GameDomainError extends Error {
  constructor(
    readonly code: GameDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GameDomainError';
  }
}
