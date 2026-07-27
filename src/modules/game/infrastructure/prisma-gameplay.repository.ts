import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  CHESS_ENGINE,
  type ChessEngine,
} from '../../chess/application/ports/chess-engine.js';
import { ChessEngineError } from '../../chess/domain/chess.errors.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DatabaseError,
  toDatabaseError,
} from '../../persistence/database-errors.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../persistence/transaction.service.js';
import {
  type AcceptedMove,
  type EndedGame,
  type GameplayClock,
  type GameplayRepository,
  type MoveSubmission,
  type StartedGame,
  type SubmitMove,
} from '../application/ports/gameplay.repository.js';
import { admitMoveOnClock, resumeClock } from '../domain/game-clock.js';
import { GameServiceError } from '../domain/game-service.errors.js';
import { deriveTerminalOutcome } from '../domain/terminal-result.js';
import type {
  GameResult,
  GameTermination,
  PlayerColor,
} from '../domain/game.types.js';
import { oppositeColor } from '../domain/game.types.js';

const gameInclude = {
  moves: { orderBy: { ply: 'asc' } },
  players: { orderBy: { slot: 'asc' } },
} satisfies Prisma.GameInclude;

type PersistedGame = Prisma.GameGetPayload<{ include: typeof gameInclude }>;

type MoveErrorCode =
  | 'CLOCK_EXPIRED'
  | 'GAME_ALREADY_ENDED'
  | 'GAME_NOT_FOUND'
  | 'GAME_STATE_CORRUPT'
  | 'GAME_UNAVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'ILLEGAL_MOVE'
  | 'NOT_A_PLAYER'
  | 'NOT_YOUR_TURN'
  | 'STALE_GAME_VERSION';

type MoveTransactionResult =
  | Readonly<{ kind: 'accepted'; submission: MoveSubmission }>
  | Readonly<{
      authoritativeVersion?: number;
      code: MoveErrorCode;
      kind: 'rejected';
      message: string;
      retryable: boolean;
    }>
  | Readonly<{ kind: 'stale_write'; version: number }>;

const colorSchema = z.enum(['b', 'w']);
const resultSchema = z.enum(['black_win', 'draw', 'void', 'white_win']);
const terminationSchema = z.enum([
  'abandonment',
  'checkmate',
  'double_abandon',
  'fifty_move',
  'insufficient_material',
  'no_show',
  'resignation',
  'stalemate',
  'threefold_repetition',
  'timeout',
]);
const gameplayClockSchema = z
  .object({
    blackMs: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
    running: colorSchema.nullable(),
    whiteMs: z.number().int().nonnegative(),
  })
  .strict();
const acceptedMoveSchema = z
  .object({
    check: z.boolean(),
    clientMoveId: z.uuidv4(),
    clocks: gameplayClockSchema,
    fenAfter: z.string().min(1),
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
    ply: z.number().int().positive(),
    san: z.string().min(1),
    turn: colorSchema,
    uci: z.string().regex(/^[a-h][1-8][a-h][1-8](?:[bnqr])?$/),
  })
  .strict();
const startedGameSchema = z
  .object({
    clocks: gameplayClockSchema,
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
    initialFen: z.string().min(1),
  })
  .strict();
const endedGameSchema = z
  .object({
    clocks: gameplayClockSchema,
    finalFen: z.string().min(1),
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
    pgn: z.string(),
    result: resultSchema,
    termination: terminationSchema,
  })
  .strict();
const persistedSubmissionSchema = z
  .object({
    accepted: acceptedMoveSchema,
    ended: endedGameSchema.nullable(),
    guestSessionIds: z.tuple([z.uuidv4(), z.uuidv4()]),
    started: startedGameSchema.nullable(),
  })
  .strict();

@Injectable()
export class PrismaGameplayRepository implements GameplayRepository {
  constructor(
    @Inject(CHESS_ENGINE)
    private readonly chess: ChessEngine,
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async submitMove(input: SubmitMove): Promise<MoveSubmission> {
    let result: MoveTransactionResult;
    try {
      result = await this.transactions.run((transaction) =>
        this.submitInTransaction(transaction, input),
      );
    } catch (error) {
      if (error instanceof DatabaseError && error.kind === 'unique') {
        const replay = await this.findReplay(input);
        if (replay !== null) {
          return replay;
        }
      }
      throw error;
    }

    switch (result.kind) {
      case 'accepted':
        return result.submission;
      case 'stale_write':
        throw this.moveError(
          'STALE_GAME_VERSION',
          'The game changed before the move could be committed.',
          true,
          result.version,
        );
      case 'rejected':
        throw this.moveError(
          result.code,
          result.message,
          result.retryable,
          result.authoritativeVersion,
        );
    }
  }

  private async submitInTransaction(
    transaction: TransactionClient,
    input: SubmitMove,
  ): Promise<MoveTransactionResult> {
    const locked = await this.transactions.lockGameClock(
      transaction,
      input.gameId,
    );
    if (locked === null) {
      return this.rejected(
        'GAME_NOT_FOUND',
        'The requested game does not exist.',
        false,
      );
    }

    const game = await transaction.game.findUnique({
      include: gameInclude,
      where: { id: input.gameId },
    });
    if (game === null) {
      return this.rejected(
        'GAME_NOT_FOUND',
        'The requested game does not exist.',
        false,
      );
    }

    const player = game.players.find(
      (candidate) =>
        candidate.guestSessionId === input.guestSessionId &&
        this.isColor(candidate.color),
    );
    if (player === undefined) {
      return this.rejected(
        'NOT_A_PLAYER',
        'The authenticated guest is not a member of this game.',
        false,
        game.version,
      );
    }

    const replay = await transaction.gameCommand.findUnique({
      where: {
        gameId_eventId: {
          eventId: input.clientMoveId,
          gameId: input.gameId,
        },
      },
    });
    if (replay !== null) {
      return this.replayResult(replay, input);
    }

    if (this.isTerminalStatus(game.status)) {
      return this.rejected(
        'GAME_ALREADY_ENDED',
        'The game has already ended.',
        false,
        game.version,
      );
    }
    if (game.status !== 'IN_PROGRESS' && game.status !== 'READY') {
      return this.rejected(
        'GAME_UNAVAILABLE',
        'The game is not accepting moves.',
        false,
        game.version,
      );
    }
    if (!this.isColor(game.turnColor) || game.turnColor !== player.color) {
      return this.rejected(
        'NOT_YOUR_TURN',
        'It is not this player’s turn.',
        false,
        game.version,
      );
    }
    if (input.expectedVersion !== game.version) {
      return this.rejected(
        'STALE_GAME_VERSION',
        'The game version is stale.',
        true,
        game.version,
      );
    }
    if (!this.hasContiguousHistory(game)) {
      return this.rejected(
        'GAME_STATE_CORRUPT',
        'The persisted move history is not contiguous.',
        false,
        game.version,
      );
    }

    const baseClock = {
      blackMs: game.blackClockMs,
      incrementMs: game.incrementMs,
      running: game.status === 'READY' ? null : player.color,
      turnStartedAt: game.status === 'READY' ? null : game.turnStartedAt,
      whiteMs: game.whiteClockMs,
    } as const;

    let admission;
    try {
      const runningClock =
        game.status === 'READY'
          ? resumeClock(baseClock, 'w', locked.observedAt)
          : baseClock;
      admission = admitMoveOnClock(
        runningClock,
        player.color,
        locked.observedAt,
      );
    } catch {
      return this.rejected(
        'GAME_STATE_CORRUPT',
        'The persisted game clock is inconsistent.',
        false,
        game.version,
      );
    }
    if (admission.kind === 'flag_fall') {
      return this.rejected(
        'CLOCK_EXPIRED',
        'The move arrived after the player’s clock expired.',
        false,
        game.version,
      );
    }

    let evaluation;
    try {
      evaluation = this.chess.evaluateMove({
        expectedCurrentFen: game.currentFen,
        history: game.moves.map((move) => ({ uci: move.uci })),
        initialFen: game.initialFen,
        move: input.move,
      });
    } catch (error) {
      if (error instanceof ChessEngineError && error.code === 'ILLEGAL_MOVE') {
        return this.rejected(
          'ILLEGAL_MOVE',
          error.message,
          false,
          game.version,
        );
      }
      return this.rejected(
        'GAME_STATE_CORRUPT',
        'The persisted chess state could not be replayed.',
        false,
        game.version,
      );
    }
    if (evaluation.applied.color !== player.color) {
      return this.rejected(
        'GAME_STATE_CORRUPT',
        'The chess engine turn does not match the persisted game turn.',
        false,
        game.version,
      );
    }

    const terminal = evaluation.gameOver.over
      ? deriveTerminalOutcome({
          kind: 'BOARD',
          reason: evaluation.gameOver.reason,
          winner: evaluation.gameOver.winner,
        })
      : null;
    const startedVersion =
      game.status === 'READY' ? game.version + 1 : game.version;
    const resultVersion = startedVersion + 1;
    const nextTurn = oppositeColor(player.color);
    const clocks: GameplayClock = {
      blackMs: admission.clock.blackMs,
      observedAt: locked.observedAt.getTime(),
      running: terminal === null ? nextTurn : null,
      whiteMs: admission.clock.whiteMs,
    };
    const accepted: AcceptedMove = {
      check: evaluation.applied.check,
      clientMoveId: input.clientMoveId,
      clocks,
      fenAfter: evaluation.applied.fenAfter,
      gameId: game.id,
      gameVersion: resultVersion,
      ply: evaluation.applied.plyNumber,
      san: evaluation.applied.san,
      turn: nextTurn,
      uci: evaluation.applied.uci,
    };
    const started: StartedGame | null =
      game.status === 'READY'
        ? {
            clocks: {
              blackMs: game.blackClockMs,
              observedAt: locked.observedAt.getTime(),
              running: 'w',
              whiteMs: game.whiteClockMs,
            },
            gameId: game.id,
            gameVersion: startedVersion,
            initialFen: game.initialFen,
          }
        : null;
    const ended: EndedGame | null =
      terminal === null
        ? null
        : {
            clocks,
            finalFen: evaluation.applied.fenAfter,
            gameId: game.id,
            gameVersion: resultVersion,
            pgn: evaluation.pgn,
            result: terminal.result,
            termination: terminal.termination,
          };
    const guests = game.players.map((candidate) => candidate.guestSessionId);
    const firstGuest = guests[0];
    const secondGuest = guests[1];
    if (
      firstGuest === undefined ||
      secondGuest === undefined ||
      guests.length !== 2
    ) {
      return this.rejected(
        'GAME_STATE_CORRUPT',
        'The game does not contain exactly two players.',
        false,
        game.version,
      );
    }
    const submission: MoveSubmission = {
      accepted,
      duplicate: false,
      ended,
      guestSessionIds: [firstGuest, secondGuest],
      started,
    };

    const updated = await transaction.game.updateMany({
      data: {
        blackClockMs: admission.clock.blackMs,
        currentFen: evaluation.applied.fenAfter,
        ...(terminal === null
          ? {}
          : {
              endedAt: locked.observedAt,
              result: this.persistedResult(terminal.result),
              termination: this.persistedTermination(terminal.termination),
            }),
        pgn: evaluation.pgn,
        ...(game.status === 'READY' ? { startedAt: locked.observedAt } : {}),
        status:
          terminal?.status ??
          (game.status === 'READY' ? 'IN_PROGRESS' : game.status),
        turnColor: nextTurn,
        turnStartedAt: terminal === null ? locked.observedAt : null,
        version: { increment: game.status === 'READY' ? 2 : 1 },
        whiteClockMs: admission.clock.whiteMs,
      },
      where: { id: game.id, version: game.version },
    });
    if (updated.count !== 1) {
      return { kind: 'stale_write', version: game.version };
    }

    await transaction.move.create({
      data: {
        clientMoveId: input.clientMoveId,
        color: player.color,
        fenAfter: evaluation.applied.fenAfter,
        fenBefore: evaluation.applied.fenBefore,
        gameId: game.id,
        guestSessionId: input.guestSessionId,
        ply: evaluation.applied.plyNumber,
        san: evaluation.applied.san,
        serverReceivedAt: locked.observedAt,
        uci: evaluation.applied.uci,
      },
    });
    if (terminal !== null) {
      await transaction.activeGameAssignment.deleteMany({
        where: { gameId: game.id },
      });
    }
    await transaction.gameCommand.create({
      data: {
        commandType: 'MOVE',
        eventId: input.clientMoveId,
        gameId: game.id,
        guestSessionId: input.guestSessionId,
        response: this.persistedSubmission(submission),
        resultVersion,
      },
    });

    return { kind: 'accepted', submission };
  }

  private async findReplay(input: SubmitMove): Promise<MoveSubmission | null> {
    try {
      const command = await this.prisma.gameCommand.findUnique({
        where: {
          gameId_eventId: {
            eventId: input.clientMoveId,
            gameId: input.gameId,
          },
        },
      });
      if (command === null) {
        return null;
      }
      const result = this.replayResult(command, input);
      if (result.kind === 'accepted') {
        return result.submission;
      }
      throw this.moveError(
        result.code,
        result.message,
        result.retryable,
        result.authoritativeVersion,
      );
    } catch (error) {
      if (error instanceof GameServiceError) {
        throw error;
      }
      throw toDatabaseError(error);
    }
  }

  private replayResult(
    command: Readonly<{
      commandType: string;
      guestSessionId: string;
      response: Prisma.JsonValue;
    }>,
    input: SubmitMove,
  ): Extract<MoveTransactionResult, { kind: 'accepted' | 'rejected' }> {
    if (
      command.commandType !== 'MOVE' ||
      command.guestSessionId !== input.guestSessionId
    ) {
      return this.rejected(
        'IDEMPOTENCY_KEY_REUSED',
        'The move identifier was already used for a different command.',
        false,
      );
    }
    const parsed = persistedSubmissionSchema.safeParse(command.response);
    if (!parsed.success) {
      return this.rejected(
        'GAME_STATE_CORRUPT',
        'The stored move acknowledgement is invalid.',
        false,
      );
    }
    return {
      kind: 'accepted',
      submission: { ...parsed.data, duplicate: true },
    };
  }

  private persistedSubmission(
    submission: MoveSubmission,
  ): Prisma.InputJsonValue {
    return {
      accepted: submission.accepted,
      ended: submission.ended,
      guestSessionIds: [...submission.guestSessionIds],
      started: submission.started,
    };
  }

  private hasContiguousHistory(game: PersistedGame): boolean {
    return game.moves.every((move, index) => move.ply === index + 1);
  }

  private isColor(value: string): value is PlayerColor {
    return value === 'b' || value === 'w';
  }

  private isTerminalStatus(status: string): boolean {
    return ['ABANDONED', 'COMPLETED', 'EXPIRED'].includes(status);
  }

  private moveError(
    code: MoveErrorCode,
    message: string,
    retryable: boolean,
    authoritativeVersion?: number,
  ): GameServiceError {
    return new GameServiceError(
      code,
      message,
      retryable,
      authoritativeVersion,
      'move.rejected',
    );
  }

  private persistedResult(result: GameResult): string {
    switch (result) {
      case 'white_win':
        return '1-0';
      case 'black_win':
        return '0-1';
      case 'draw':
        return '1/2-1/2';
      case 'void':
        return '*';
    }
  }

  private persistedTermination(termination: GameTermination): string {
    return termination.toUpperCase();
  }

  private rejected(
    code: MoveErrorCode,
    message: string,
    retryable: boolean,
    authoritativeVersion?: number,
  ): Extract<MoveTransactionResult, { kind: 'rejected' }> {
    return {
      ...(authoritativeVersion === undefined ? {} : { authoritativeVersion }),
      code,
      kind: 'rejected',
      message,
      retryable,
    };
  }
}
