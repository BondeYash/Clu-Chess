import { describe, expect, it } from 'vitest';
import { GameDomainError } from '../../src/modules/game/domain/game.errors.js';
import {
  transitionGame,
  type GameTransition,
} from '../../src/modules/game/domain/game-state-machine.js';
import {
  GAME_STATUSES,
  type GameStatus,
} from '../../src/modules/game/domain/game.types.js';
import {
  deriveTerminalOutcome,
  type TerminalEvent,
  type TerminalOutcome,
} from '../../src/modules/game/domain/terminal-result.js';

type LegalTransitionCase = Readonly<{
  from: GameStatus;
  outcome?: TerminalOutcome;
  to: GameStatus;
  transition: GameTransition;
  versionDelta: 0 | 1;
}>;

const whiteCheckmate = deriveTerminalOutcome({
  kind: 'BOARD',
  reason: 'checkmate',
  winner: 'w',
});
const drawByStalemate = deriveTerminalOutcome({
  kind: 'BOARD',
  reason: 'stalemate',
  winner: null,
});
const whiteResignationWin = deriveTerminalOutcome({
  kind: 'RESIGNATION',
  loser: 'b',
});
const whiteTimeoutWin = deriveTerminalOutcome({
  kind: 'TIMEOUT',
  loser: 'b',
});
const expiredNoShow = deriveTerminalOutcome({
  joined: [],
  kind: 'NO_SHOW',
});
const abandoned = deriveTerminalOutcome({
  absent: ['b'],
  kind: 'ABANDONMENT',
});

const LEGAL_TRANSITIONS: readonly LegalTransitionCase[] = [
  {
    from: 'CREATED',
    to: 'WAITING_FOR_PLAYERS',
    transition: 'ALLOCATE',
    versionDelta: 0,
  },
  {
    from: 'WAITING_FOR_PLAYERS',
    to: 'READY',
    transition: 'MARK_PLAYERS_READY',
    versionDelta: 1,
  },
  {
    from: 'WAITING_FOR_PLAYERS',
    outcome: expiredNoShow,
    to: 'EXPIRED',
    transition: 'EXPIRE_NO_SHOW',
    versionDelta: 1,
  },
  {
    from: 'READY',
    to: 'IN_PROGRESS',
    transition: 'START',
    versionDelta: 1,
  },
  {
    from: 'IN_PROGRESS',
    to: 'IN_PROGRESS',
    transition: 'ACCEPT_MOVE',
    versionDelta: 1,
  },
  {
    from: 'IN_PROGRESS',
    outcome: whiteCheckmate,
    to: 'COMPLETED',
    transition: 'ACCEPT_TERMINAL_MOVE',
    versionDelta: 1,
  },
  {
    from: 'IN_PROGRESS',
    to: 'RECONNECTING',
    transition: 'PLAYER_DISCONNECTED',
    versionDelta: 1,
  },
  {
    from: 'RECONNECTING',
    to: 'RECONNECTING',
    transition: 'PLAYER_DISCONNECTED',
    versionDelta: 1,
  },
  {
    from: 'RECONNECTING',
    to: 'IN_PROGRESS',
    transition: 'PLAYER_RECONNECTED',
    versionDelta: 1,
  },
  {
    from: 'IN_PROGRESS',
    outcome: whiteResignationWin,
    to: 'COMPLETED',
    transition: 'RESIGN',
    versionDelta: 1,
  },
  {
    from: 'RECONNECTING',
    outcome: whiteResignationWin,
    to: 'COMPLETED',
    transition: 'RESIGN',
    versionDelta: 1,
  },
  {
    from: 'IN_PROGRESS',
    outcome: whiteTimeoutWin,
    to: 'COMPLETED',
    transition: 'TIMEOUT',
    versionDelta: 1,
  },
  {
    from: 'RECONNECTING',
    outcome: whiteTimeoutWin,
    to: 'COMPLETED',
    transition: 'TIMEOUT',
    versionDelta: 1,
  },
  {
    from: 'IN_PROGRESS',
    outcome: abandoned,
    to: 'ABANDONED',
    transition: 'ABANDON',
    versionDelta: 1,
  },
  {
    from: 'RECONNECTING',
    outcome: abandoned,
    to: 'ABANDONED',
    transition: 'ABANDON',
    versionDelta: 1,
  },
];

describe('game lifecycle state machine', () => {
  it.each(LEGAL_TRANSITIONS)(
    'applies $transition from $from to $to with version +$versionDelta',
    ({ from, outcome, to, transition, versionDelta }) => {
      const result = transitionGame({
        ...(outcome === undefined ? {} : { outcome }),
        status: from,
        transition,
        version: 9,
      });

      expect(result).toEqual({
        outcome: outcome ?? null,
        previousStatus: from,
        previousVersion: 9,
        status: to,
        version: 9 + versionDelta,
      });
    },
  );

  it('increments a terminal move once for both the move and terminal state', () => {
    const result = transitionGame({
      outcome: drawByStalemate,
      status: 'IN_PROGRESS',
      transition: 'ACCEPT_TERMINAL_MOVE',
      version: 41,
    });

    expect(result).toMatchObject({ status: 'COMPLETED', version: 42 });
  });

  it('rejects every state edge not explicitly present in the transition table', () => {
    const allowed = new Set(
      LEGAL_TRANSITIONS.map(({ from, transition }) => `${transition}:${from}`),
    );
    const transitions = [
      ...new Set(LEGAL_TRANSITIONS.map(({ transition }) => transition)),
    ];

    for (const transition of transitions) {
      for (const status of GAME_STATUSES) {
        if (allowed.has(`${transition}:${status}`)) {
          continue;
        }

        const outcome = terminalOutcomeFor(transition);
        expect(() =>
          transitionGame({
            ...(outcome === undefined ? {} : { outcome }),
            status,
            transition,
            version: 1,
          }),
        ).toThrow(
          expect.objectContaining({
            code: 'ILLEGAL_GAME_TRANSITION',
          }),
        );
      }
    }
  });

  it('rejects missing, unexpected, or incompatible terminal outcomes', () => {
    expect(() =>
      transitionGame({
        status: 'IN_PROGRESS',
        transition: 'TIMEOUT',
        version: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_GAME_STATE' }));
    expect(() =>
      transitionGame({
        outcome: whiteTimeoutWin,
        status: 'IN_PROGRESS',
        transition: 'ACCEPT_MOVE',
        version: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_GAME_STATE' }));
    expect(() =>
      transitionGame({
        outcome: whiteCheckmate,
        status: 'IN_PROGRESS',
        transition: 'RESIGN',
        version: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_GAME_STATE' }));
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an invalid or overflowing version %s',
    (version) => {
      expect(() =>
        transitionGame({
          status: version === Number.MAX_SAFE_INTEGER ? 'READY' : 'CREATED',
          transition:
            version === Number.MAX_SAFE_INTEGER ? 'START' : 'ALLOCATE',
          version,
        }),
      ).toThrow(GameDomainError);
    },
  );
});

describe('terminal result derivation', () => {
  it.each([
    [
      { kind: 'BOARD', reason: 'checkmate', winner: 'b' },
      ['COMPLETED', 'black_win', 'checkmate', 'b'],
    ],
    [
      { kind: 'BOARD', reason: 'stalemate', winner: null },
      ['COMPLETED', 'draw', 'stalemate', null],
    ],
    [
      { kind: 'BOARD', reason: 'insufficient_material', winner: null },
      ['COMPLETED', 'draw', 'insufficient_material', null],
    ],
    [
      { kind: 'BOARD', reason: 'threefold_repetition', winner: null },
      ['COMPLETED', 'draw', 'threefold_repetition', null],
    ],
    [
      { kind: 'BOARD', reason: 'fifty_move', winner: null },
      ['COMPLETED', 'draw', 'fifty_move', null],
    ],
    [
      { kind: 'RESIGNATION', loser: 'w' },
      ['COMPLETED', 'black_win', 'resignation', 'b'],
    ],
    [
      { kind: 'TIMEOUT', loser: 'b' },
      ['COMPLETED', 'white_win', 'timeout', 'w'],
    ],
    [
      { absent: ['w'], kind: 'ABANDONMENT' },
      ['ABANDONED', 'black_win', 'abandonment', 'b'],
    ],
    [
      { absent: ['w', 'b'], kind: 'ABANDONMENT' },
      ['ABANDONED', 'void', 'double_abandon', null],
    ],
    [
      { joined: ['w'], kind: 'NO_SHOW' },
      ['EXPIRED', 'white_win', 'no_show', 'w'],
    ],
    [{ joined: [], kind: 'NO_SHOW' }, ['EXPIRED', 'void', 'no_show', null]],
  ] as const)(
    'maps %o to its frozen outcome',
    (event, [status, result, termination, winner]) => {
      expect(deriveTerminalOutcome(event)).toEqual({
        result,
        status,
        termination,
        winner,
      });
    },
  );

  it.each([
    { kind: 'BOARD', reason: 'checkmate', winner: null },
    { kind: 'BOARD', reason: 'stalemate', winner: 'w' },
    { absent: [], kind: 'ABANDONMENT' },
    { joined: ['w', 'b'], kind: 'NO_SHOW' },
  ] as const)('rejects contradictory terminal event %o', (event) => {
    expect(() => deriveTerminalOutcome(event as TerminalEvent)).toThrow(
      expect.objectContaining({ code: 'INVALID_TERMINAL_EVENT' }),
    );
  });
});

function terminalOutcomeFor(
  transition: GameTransition,
): TerminalOutcome | undefined {
  switch (transition) {
    case 'ACCEPT_TERMINAL_MOVE':
      return whiteCheckmate;
    case 'RESIGN':
      return whiteResignationWin;
    case 'TIMEOUT':
      return whiteTimeoutWin;
    case 'EXPIRE_NO_SHOW':
      return expiredNoShow;
    case 'ABANDON':
      return abandoned;
    default:
      return undefined;
  }
}
