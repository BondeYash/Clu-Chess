import { GameDomainError } from './game.errors.js';
import type {
  BoardTermination,
  GameResult,
  GameTermination,
  PlayerColor,
} from './game.types.js';
import { oppositeColor } from './game.types.js';

const DRAW_TERMINATIONS = new Set<BoardTermination>([
  'fifty_move',
  'insufficient_material',
  'stalemate',
  'threefold_repetition',
]);

export type TerminalOutcome = Readonly<{
  result: GameResult;
  status: 'ABANDONED' | 'COMPLETED' | 'EXPIRED';
  termination: GameTermination;
  winner: PlayerColor | null;
}>;

export type TerminalEvent =
  | Readonly<{
      kind: 'BOARD';
      reason: BoardTermination;
      winner: PlayerColor | null;
    }>
  | Readonly<{ kind: 'RESIGNATION'; loser: PlayerColor }>
  | Readonly<{ kind: 'TIMEOUT'; loser: PlayerColor }>
  | Readonly<{
      absent: readonly PlayerColor[];
      kind: 'ABANDONMENT';
    }>
  | Readonly<{
      joined: readonly PlayerColor[];
      kind: 'NO_SHOW';
    }>;

export function deriveTerminalOutcome(event: TerminalEvent): TerminalOutcome {
  switch (event.kind) {
    case 'BOARD':
      return deriveBoardOutcome(event.reason, event.winner);
    case 'RESIGNATION':
      return winnerOutcome(
        oppositeColor(event.loser),
        'COMPLETED',
        'resignation',
      );
    case 'TIMEOUT':
      return winnerOutcome(oppositeColor(event.loser), 'COMPLETED', 'timeout');
    case 'ABANDONMENT':
      return deriveAbandonment(event.absent);
    case 'NO_SHOW':
      return deriveNoShow(event.joined);
  }
}

function deriveAbandonment(
  absentInput: readonly PlayerColor[],
): TerminalOutcome {
  const absent = uniqueColors(absentInput);

  if (absent.length === 2) {
    return {
      result: 'void',
      status: 'ABANDONED',
      termination: 'double_abandon',
      winner: null,
    };
  }

  const loser = absent[0];
  if (loser === undefined) {
    throw invalidTerminalEvent(
      'Abandonment requires at least one absent player.',
    );
  }

  return winnerOutcome(oppositeColor(loser), 'ABANDONED', 'abandonment');
}

function deriveBoardOutcome(
  reason: BoardTermination,
  winner: PlayerColor | null,
): TerminalOutcome {
  if (reason === 'checkmate') {
    if (winner === null) {
      throw invalidTerminalEvent('Checkmate must identify the winning color.');
    }

    return winnerOutcome(winner, 'COMPLETED', reason);
  }

  if (!DRAW_TERMINATIONS.has(reason) || winner !== null) {
    throw invalidTerminalEvent(
      'An automatic chess draw cannot identify a winner.',
    );
  }

  return {
    result: 'draw',
    status: 'COMPLETED',
    termination: reason,
    winner: null,
  };
}

function deriveNoShow(joinedInput: readonly PlayerColor[]): TerminalOutcome {
  const joined = uniqueColors(joinedInput);

  if (joined.length === 0) {
    return {
      result: 'void',
      status: 'EXPIRED',
      termination: 'no_show',
      winner: null,
    };
  }

  const winner = joined.length === 1 ? joined[0] : undefined;
  if (winner === undefined) {
    throw invalidTerminalEvent(
      'A no-show cannot be adjudicated after both players joined.',
    );
  }

  return winnerOutcome(winner, 'EXPIRED', 'no_show');
}

function invalidTerminalEvent(message: string): GameDomainError {
  return new GameDomainError('INVALID_TERMINAL_EVENT', message);
}

function uniqueColors(colors: readonly PlayerColor[]): readonly PlayerColor[] {
  return [...new Set(colors)];
}

function winnerOutcome(
  winner: PlayerColor,
  status: TerminalOutcome['status'],
  termination: GameTermination,
): TerminalOutcome {
  return {
    result: winner === 'w' ? 'white_win' : 'black_win',
    status,
    termination,
    winner,
  };
}
