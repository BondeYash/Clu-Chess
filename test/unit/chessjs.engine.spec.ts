import { describe, expect, it } from 'vitest';
import { ChessJsEngine } from '../../src/modules/chess/infrastructure/chessjs.engine.js';
import {
  GameStateCorruptError,
  IllegalMoveError,
  InvalidInitialPositionError,
} from '../../src/modules/chess/domain/chess.errors.js';
import type {
  HistoricalMove,
  PromotionPiece,
} from '../../src/modules/chess/application/ports/chess-engine.js';

const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function history(...uci: string[]): readonly HistoricalMove[] {
  return uci.map((move) => ({ uci: move }));
}

describe('history-aware chess.js engine adapter', () => {
  const engine = new ChessJsEngine();

  it('creates the standard position and applies a normal legal move', () => {
    const initial = engine.newGame();
    const evaluation = engine.evaluateMove({
      expectedCurrentFen: initial.fen,
      history: [],
      initialFen: STANDARD_FEN,
      move: { from: 'e2', to: 'e4' },
    });

    expect(initial).toMatchObject({
      fen: STANDARD_FEN,
      gameOver: { over: false },
      plyCount: 0,
      turn: 'w',
    });
    expect(evaluation.applied).toMatchObject({
      capture: false,
      check: false,
      color: 'w',
      fenBefore: STANDARD_FEN,
      plyNumber: 1,
      san: 'e4',
      uci: 'e2e4',
    });
    expect(evaluation.gameOver).toEqual({ over: false });
    expect(evaluation.pgn).toContain('1. e4 *');
  });

  it.each([
    [{ from: 'e2', to: 'e5' }, 'illegal destination'],
    [{ from: 'z9', to: 'e4' }, 'malformed square'],
    [{ from: 'e2', to: 'e4', promotion: 'q' as const }, 'invalid promotion'],
  ])('normalizes an %s proposal to IllegalMoveError (%s)', (move, _reason) => {
    expect(() =>
      engine.evaluateMove({
        expectedCurrentFen: STANDARD_FEN,
        history: [],
        initialFen: STANDARD_FEN,
        move,
      }),
    ).toThrow(IllegalMoveError);
  });

  it.each(['q', 'r', 'b', 'n'] as const)(
    'supports promotion to %s',
    (promotion: PromotionPiece) => {
      const initialFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
      const evaluation = engine.evaluateMove({
        expectedCurrentFen: initialFen,
        history: [],
        initialFen,
        move: { from: 'a7', promotion, to: 'a8' },
      });

      expect(evaluation.applied.uci).toBe(`a7a8${promotion}`);
      expect(evaluation.applied.san).toMatch(
        new RegExp(`^a8=${promotion.toUpperCase()}`),
      );
    },
  );

  it('supports castling and exposes canonical SAN/UCI', () => {
    const initialFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const evaluation = engine.evaluateMove({
      expectedCurrentFen: initialFen,
      history: [],
      initialFen,
      move: { from: 'e1', to: 'g1' },
    });

    expect(evaluation.applied).toMatchObject({
      capture: false,
      san: 'O-O',
      uci: 'e1g1',
    });
    expect(evaluation.applied.fenAfter).toContain('R4RK1 b kq');
  });

  it('supports en passant as a capture', () => {
    const moves = history('e2e4', 'a7a6', 'e4e5', 'd7d5');
    const replayed = engine.replay(STANDARD_FEN, moves);
    const evaluation = engine.evaluateMove({
      expectedCurrentFen: replayed.fen,
      history: moves,
      initialFen: STANDARD_FEN,
      move: { from: 'e5', to: 'd6' },
    });

    expect(evaluation.applied).toMatchObject({
      capture: true,
      san: 'exd6',
      uci: 'e5d6',
    });
  });

  it('detects check and checkmate, including the board winner and PGN result', () => {
    const checkingFen = '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1';
    const check = engine.evaluateMove({
      expectedCurrentFen: checkingFen,
      history: [],
      initialFen: checkingFen,
      move: { from: 'e2', to: 'e7' },
    });
    expect(check.applied).toMatchObject({ check: true, san: 'Re7+' });

    const beforeMate = history('e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6');
    const replayed = engine.replay(STANDARD_FEN, beforeMate);
    const mate = engine.evaluateMove({
      expectedCurrentFen: replayed.fen,
      history: beforeMate,
      initialFen: STANDARD_FEN,
      move: { from: 'h5', to: 'f7' },
    });

    expect(mate.applied).toMatchObject({
      capture: true,
      check: true,
      plyNumber: 7,
      san: 'Qxf7#',
    });
    expect(mate.gameOver).toEqual({
      over: true,
      reason: 'checkmate',
      winner: 'w',
    });
    expect(mate.pgn).toContain('[Result "1-0"]');
    expect(mate.pgn).toContain('4. Qxf7# 1-0');
  });

  it.each([
    ['7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'stalemate'],
    ['8/8/8/8/8/8/K6k/8 w - - 0 1', 'insufficient_material'],
  ] as const)('detects %s as %s', (fen, reason) => {
    const replayed = engine.replay(fen, []);

    expect(replayed.gameOver).toEqual({
      over: true,
      reason,
      winner: null,
    });
    expect(replayed.pgn).toContain('[Result "1/2-1/2"]');
  });

  it('detects the fifty-move rule after the halfmove counter reaches 100', () => {
    const initialFen = '7k/8/8/8/8/8/R7/K7 w - - 99 50';
    const evaluation = engine.evaluateMove({
      expectedCurrentFen: initialFen,
      history: [],
      initialFen,
      move: { from: 'a2', to: 'b2' },
    });

    expect(evaluation.gameOver).toEqual({
      over: true,
      reason: 'fifty_move',
      winner: null,
    });
  });

  it('uses ordered history for threefold repetition rather than FEN alone', () => {
    const repetition = history(
      'g1f3',
      'g8f6',
      'f3g1',
      'f6g8',
      'g1f3',
      'g8f6',
      'f3g1',
      'f6g8',
    );
    const withHistory = engine.replay(STANDARD_FEN, repetition);
    const fenOnly = engine.replay(withHistory.fen, []);

    expect(withHistory.gameOver).toEqual({
      over: true,
      reason: 'threefold_repetition',
      winner: null,
    });
    expect(fenOnly.gameOver).toEqual({ over: false });
  });

  it('keeps FEN, PGN, ply count, and move replay consistent', () => {
    const moves = history('e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5');
    const replayed = engine.replay(STANDARD_FEN, moves);
    const evaluated = engine.evaluateMove({
      expectedCurrentFen: replayed.fen,
      history: moves,
      initialFen: STANDARD_FEN,
      move: { from: 'a7', to: 'a6' },
    });
    const replayedAgain = engine.replay(STANDARD_FEN, [
      ...moves,
      { uci: evaluated.applied.uci },
    ]);

    expect(replayed).toMatchObject({ plyCount: 5, turn: 'b' });
    expect(replayed.pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 *');
    expect(replayedAgain.fen).toBe(evaluated.applied.fenAfter);
    expect(replayedAgain.pgn).toBe(evaluated.pgn);
    expect(replayedAgain.plyCount).toBe(6);
  });

  it('fails closed for invalid setup, corrupt history, and a FEN mismatch', () => {
    expect(() => engine.replay('not a FEN', [])).toThrow(
      InvalidInitialPositionError,
    );
    expect(() => engine.replay(STANDARD_FEN, history('not-uci'))).toThrow(
      GameStateCorruptError,
    );
    expect(() => engine.replay(STANDARD_FEN, history('e2e5'))).toThrow(
      GameStateCorruptError,
    );
    expect(() =>
      engine.evaluateMove({
        expectedCurrentFen: STANDARD_FEN,
        history: history('e2e4'),
        initialFen: STANDARD_FEN,
        move: { from: 'e7', to: 'e5' },
      }),
    ).toThrow(GameStateCorruptError);
  });
});
