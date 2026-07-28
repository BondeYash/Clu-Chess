import { describe, expect, it } from 'vitest';

import type { GameSnapshot } from './game-recovery-types';
import {
  formatClock,
  gameStatusLabel,
  groupMoves,
  isTerminalSnapshot,
  parseFenPosition,
} from './snapshot-model';

describe('snapshot model', () => {
  it('converts a verified FEN layout without running a second chess engine', () => {
    const position = parseFenPosition(
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    );

    expect(position.a8).toBe('br');
    expect(position.e4).toBe('wp');
    expect(position.f3).toBe('wn');
    expect(position.e5).toBe('bp');
  });

  it.each([
    '',
    '8/8/8',
    '9/8/8/8/8/8/8/8 w - - 0 1',
    '7x/8/8/8/8/8/8/8 w - - 0 1',
  ])('rejects an uncertain board layout: %s', (fen) => {
    expect(() => parseFenPosition(fen)).toThrow();
  });

  it('groups paired moves and formats server clock values', () => {
    const snapshot = fixture();
    expect(groupMoves(snapshot)).toEqual([
      { black: 'e5', number: 1, white: 'e4' },
      { number: 2, white: 'Nf3' },
    ]);
    expect(formatClock(301_001)).toBe('05:02');
    expect(formatClock(-1)).toBe('00:00');
  });

  it('presents each status and identifies terminal records', () => {
    expect(gameStatusLabel('RECONNECTING')).toBe('Player reconnecting');
    expect(gameStatusLabel('IN_PROGRESS')).toBe('Game in progress');
    expect(isTerminalSnapshot(fixture())).toBe(false);
    expect(isTerminalSnapshot({ ...fixture(), status: 'COMPLETED' })).toBe(
      true,
    );
  });
});

function fixture(): GameSnapshot {
  return {
    clocks: {
      blackMs: 300_000,
      running: 'white',
      serverTime: 1_785_000_000_000,
      whiteMs: 301_001,
    },
    currentFen: '8/8/8/8/8/8/8/8 w - - 0 1',
    gameId: '11111111-1111-4111-8111-111111111111',
    gameVersion: 3,
    initialFen: '8/8/8/8/8/8/8/8 w - - 0 1',
    moves: [
      { color: 'white', ply: 1, san: 'e4', uci: 'e2e4' },
      { color: 'black', ply: 2, san: 'e5', uci: 'e7e5' },
      { color: 'white', ply: 3, san: 'Nf3', uci: 'g1f3' },
    ],
    opponent: {
      avatar: 'knight_black_01',
      color: 'black',
      connected: true,
      name: 'NobleRook91',
    },
    result: null,
    status: 'IN_PROGRESS',
    termination: null,
    turn: 'black',
    you: {
      avatar: 'knight_amber_01',
      color: 'white',
      connected: true,
      name: 'SilentKnight482',
    },
  };
}
