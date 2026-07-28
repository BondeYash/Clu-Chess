export type ChessEngineErrorCode =
  'GAME_STATE_CORRUPT' | 'ILLEGAL_MOVE' | 'INVALID_INITIAL_POSITION';

export abstract class ChessEngineError extends Error {
  abstract readonly code: ChessEngineErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ChessEngineError';
  }
}

export class IllegalMoveError extends ChessEngineError {
  readonly code = 'ILLEGAL_MOVE';

  constructor(
    message = 'The proposed chess move is illegal.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'IllegalMoveError';
  }
}

export class InvalidInitialPositionError extends ChessEngineError {
  readonly code = 'INVALID_INITIAL_POSITION';

  constructor(
    message = 'The configured initial chess position is invalid.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'InvalidInitialPositionError';
  }
}

export class GameStateCorruptError extends ChessEngineError {
  readonly code = 'GAME_STATE_CORRUPT';

  constructor(
    message = 'The persisted chess position or move history is inconsistent.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GameStateCorruptError';
  }
}
