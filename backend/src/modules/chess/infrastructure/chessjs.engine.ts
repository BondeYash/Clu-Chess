import { Injectable } from '@nestjs/common';
import { Chess, DEFAULT_POSITION, validateFen, type Square } from 'chess.js';
import type {
  AppliedMove,
  ChessColor,
  ChessEngine,
  EvaluateMoveInput,
  GameOver,
  HistoricalMove,
  MoveEvaluation,
  MoveInput,
  ReplayedPosition,
} from '../application/ports/chess-engine.js';
import {
  GameStateCorruptError,
  IllegalMoveError,
  InvalidInitialPositionError,
} from '../domain/chess.errors.js';

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8](?:[bnqr])?$/;
const SQUARE_PATTERN = /^[a-h][1-8]$/;

@Injectable()
export class ChessJsEngine implements ChessEngine {
  newGame(): ReplayedPosition {
    return this.replay(DEFAULT_POSITION, []);
  }

  replay(
    initialFen: string,
    history: readonly HistoricalMove[],
  ): ReplayedPosition {
    const chess = this.replayHistory(initialFen, history);
    const gameOver = this.getGameOver(chess);

    return {
      fen: chess.fen(),
      gameOver,
      pgn: this.getPgn(chess, gameOver),
      plyCount: history.length,
      turn: chess.turn(),
    };
  }

  evaluateMove(input: EvaluateMoveInput): MoveEvaluation {
    const chess = this.replayHistory(input.initialFen, input.history);
    const replayedFen = chess.fen();

    if (replayedFen !== input.expectedCurrentFen) {
      throw new GameStateCorruptError(
        'The replayed chess position does not match the persisted current position.',
      );
    }

    const fenBefore = replayedFen;
    const applied = this.applyProposal(
      chess,
      input.move,
      input.history.length + 1,
    );
    const gameOver = this.getGameOver(chess);

    return {
      applied: {
        ...applied,
        fenBefore,
      },
      gameOver,
      pgn: this.getPgn(chess, gameOver),
    };
  }

  private applyProposal(
    chess: Chess,
    proposal: MoveInput,
    plyNumber: number,
  ): Omit<AppliedMove, 'fenBefore'> {
    if (
      !SQUARE_PATTERN.test(proposal.from) ||
      !SQUARE_PATTERN.test(proposal.to)
    ) {
      throw new IllegalMoveError('The move must contain valid board squares.');
    }

    if (
      proposal.promotion !== undefined &&
      (chess.get(proposal.from as Square)?.type !== 'p' ||
        !['1', '8'].includes(proposal.to[1] ?? ''))
    ) {
      throw new IllegalMoveError(
        'A promotion piece is only valid for a pawn reaching the back rank.',
      );
    }

    try {
      const move = chess.move({
        from: proposal.from,
        ...(proposal.promotion === undefined
          ? {}
          : { promotion: proposal.promotion }),
        to: proposal.to,
      });

      return {
        capture: move.isCapture() || move.isEnPassant(),
        check: chess.isCheck(),
        color: move.color,
        fenAfter: chess.fen(),
        plyNumber,
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      };
    } catch (error) {
      throw new IllegalMoveError(
        `The move ${this.describeMove(proposal)} is not legal in the current position.`,
        { cause: error },
      );
    }
  }

  private createPosition(initialFen: string): Chess {
    const validation = validateFen(initialFen);

    if (!validation.ok) {
      throw new InvalidInitialPositionError(
        `The configured initial chess position is invalid: ${validation.error ?? 'unknown FEN error'}.`,
      );
    }

    try {
      return new Chess(initialFen);
    } catch (error) {
      throw new InvalidInitialPositionError(undefined, { cause: error });
    }
  }

  private describeMove(move: MoveInput): string {
    return `${move.from}${move.to}${move.promotion ?? ''}`;
  }

  private getGameOver(chess: Chess): GameOver {
    if (chess.isCheckmate()) {
      return {
        over: true,
        reason: 'checkmate',
        winner: this.opposite(chess.turn()),
      };
    }

    if (chess.isStalemate()) {
      return { over: true, reason: 'stalemate', winner: null };
    }

    if (chess.isInsufficientMaterial()) {
      return {
        over: true,
        reason: 'insufficient_material',
        winner: null,
      };
    }

    if (chess.isThreefoldRepetition()) {
      return {
        over: true,
        reason: 'threefold_repetition',
        winner: null,
      };
    }

    if (chess.isDrawByFiftyMoves()) {
      return { over: true, reason: 'fifty_move', winner: null };
    }

    return { over: false };
  }

  private getPgn(chess: Chess, gameOver: GameOver): string {
    const result =
      !gameOver.over || gameOver.winner === null
        ? gameOver.over
          ? '1/2-1/2'
          : '*'
        : gameOver.winner === 'w'
          ? '1-0'
          : '0-1';

    chess.setHeader('Result', result);
    return chess.pgn();
  }

  private opposite(color: ChessColor): ChessColor {
    return color === 'w' ? 'b' : 'w';
  }

  private replayHistory(
    initialFen: string,
    history: readonly HistoricalMove[],
  ): Chess {
    const chess = this.createPosition(initialFen);

    for (const [index, historicalMove] of history.entries()) {
      if (!UCI_PATTERN.test(historicalMove.uci)) {
        throw new GameStateCorruptError(
          `Persisted move ${String(index + 1)} is not valid UCI.`,
        );
      }

      try {
        chess.move({
          from: historicalMove.uci.slice(0, 2),
          ...(historicalMove.uci.length === 5
            ? { promotion: historicalMove.uci.slice(4) }
            : {}),
          to: historicalMove.uci.slice(2, 4),
        });
      } catch (error) {
        throw new GameStateCorruptError(
          `Persisted move ${String(index + 1)} is illegal for its replayed position.`,
          { cause: error },
        );
      }
    }

    return chess;
  }
}
