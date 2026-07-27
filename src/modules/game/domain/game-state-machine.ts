import { GameDomainError } from './game.errors.js';
import type { GameStatus } from './game.types.js';
import type { TerminalOutcome } from './terminal-result.js';

export type GameTransition =
  | 'ABANDON'
  | 'ACCEPT_MOVE'
  | 'ACCEPT_TERMINAL_MOVE'
  | 'ALLOCATE'
  | 'EXPIRE_NO_SHOW'
  | 'MARK_PLAYERS_READY'
  | 'PLAYER_DISCONNECTED'
  | 'PLAYER_RECONNECTED'
  | 'RESIGN'
  | 'START'
  | 'TIMEOUT';

export type GameTransitionInput = Readonly<{
  outcome?: TerminalOutcome;
  status: GameStatus;
  transition: GameTransition;
  version: number;
}>;

export type GameTransitionResult = Readonly<{
  outcome: TerminalOutcome | null;
  previousStatus: GameStatus;
  previousVersion: number;
  status: GameStatus;
  version: number;
}>;

type TransitionRule = Readonly<{
  from: readonly GameStatus[];
  outcomeStatus?: TerminalOutcome['status'];
  to: GameStatus;
  versionDelta: 0 | 1;
}>;

const TRANSITION_RULES: Readonly<Record<GameTransition, TransitionRule>> = {
  ABANDON: {
    from: ['IN_PROGRESS', 'RECONNECTING'],
    outcomeStatus: 'ABANDONED',
    to: 'ABANDONED',
    versionDelta: 1,
  },
  ACCEPT_MOVE: {
    from: ['IN_PROGRESS'],
    to: 'IN_PROGRESS',
    versionDelta: 1,
  },
  ACCEPT_TERMINAL_MOVE: {
    from: ['IN_PROGRESS'],
    outcomeStatus: 'COMPLETED',
    to: 'COMPLETED',
    versionDelta: 1,
  },
  ALLOCATE: {
    from: ['CREATED'],
    to: 'WAITING_FOR_PLAYERS',
    versionDelta: 0,
  },
  EXPIRE_NO_SHOW: {
    from: ['WAITING_FOR_PLAYERS'],
    outcomeStatus: 'EXPIRED',
    to: 'EXPIRED',
    versionDelta: 1,
  },
  MARK_PLAYERS_READY: {
    from: ['WAITING_FOR_PLAYERS'],
    to: 'READY',
    versionDelta: 1,
  },
  PLAYER_DISCONNECTED: {
    from: ['IN_PROGRESS'],
    to: 'RECONNECTING',
    versionDelta: 1,
  },
  PLAYER_RECONNECTED: {
    from: ['RECONNECTING'],
    to: 'IN_PROGRESS',
    versionDelta: 1,
  },
  RESIGN: {
    from: ['IN_PROGRESS', 'RECONNECTING'],
    outcomeStatus: 'COMPLETED',
    to: 'COMPLETED',
    versionDelta: 1,
  },
  START: {
    from: ['READY'],
    to: 'IN_PROGRESS',
    versionDelta: 1,
  },
  TIMEOUT: {
    from: ['IN_PROGRESS', 'RECONNECTING'],
    outcomeStatus: 'COMPLETED',
    to: 'COMPLETED',
    versionDelta: 1,
  },
};

export function transitionGame(
  input: GameTransitionInput,
): GameTransitionResult {
  if (!Number.isSafeInteger(input.version) || input.version < 0) {
    throw new GameDomainError(
      'INVALID_GAME_STATE',
      'A game version must be a non-negative safe integer.',
    );
  }

  const rule = TRANSITION_RULES[input.transition];
  if (!rule.from.includes(input.status)) {
    throw new GameDomainError(
      'ILLEGAL_GAME_TRANSITION',
      `${input.transition} is not allowed from ${input.status}.`,
    );
  }

  validateOutcome(input.outcome, rule, input.transition);
  const version = input.version + rule.versionDelta;
  if (!Number.isSafeInteger(version)) {
    throw new GameDomainError(
      'INVALID_GAME_STATE',
      'The resulting game version is outside the safe integer range.',
    );
  }

  return {
    outcome: input.outcome ?? null,
    previousStatus: input.status,
    previousVersion: input.version,
    status: rule.to,
    version,
  };
}

function validateOutcome(
  outcome: TerminalOutcome | undefined,
  rule: TransitionRule,
  transition: GameTransition,
): void {
  if (rule.outcomeStatus === undefined) {
    if (outcome !== undefined) {
      throw new GameDomainError(
        'INVALID_GAME_STATE',
        `${transition} cannot carry a terminal outcome.`,
      );
    }
    return;
  }

  if (outcome?.status !== rule.outcomeStatus) {
    throw new GameDomainError(
      'INVALID_GAME_STATE',
      `${transition} requires a ${rule.outcomeStatus} terminal outcome.`,
    );
  }

  const validTermination =
    (transition === 'ACCEPT_TERMINAL_MOVE' &&
      [
        'checkmate',
        'fifty_move',
        'insufficient_material',
        'stalemate',
        'threefold_repetition',
      ].includes(outcome.termination)) ||
    (transition === 'RESIGN' && outcome.termination === 'resignation') ||
    (transition === 'TIMEOUT' && outcome.termination === 'timeout') ||
    (transition === 'EXPIRE_NO_SHOW' && outcome.termination === 'no_show') ||
    (transition === 'ABANDON' &&
      ['abandonment', 'double_abandon'].includes(outcome.termination));

  if (!validTermination) {
    throw new GameDomainError(
      'INVALID_GAME_STATE',
      `${transition} received an incompatible terminal outcome.`,
    );
  }
}
