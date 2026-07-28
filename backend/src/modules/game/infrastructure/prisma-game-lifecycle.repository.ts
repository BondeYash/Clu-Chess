import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DatabaseError,
  toDatabaseError,
} from '../../persistence/database-errors.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  TransactionService,
  type LockedGameClock,
  type TransactionClient,
} from '../../persistence/transaction.service.js';
import {
  type DeadlineState,
  type GameLifecycleRepository,
  type GraceState,
  type PlayerDisconnected,
  type PlayerReconnected,
  type ResignGame,
  type TerminalSubmission,
} from '../application/ports/game-lifecycle.repository.js';
import type { GameplayClock } from '../application/ports/gameplay.repository.js';
import { GameServiceError } from '../domain/game-service.errors.js';
import { deriveTerminalOutcome } from '../domain/terminal-result.js';
import type {
  GameResult,
  GameTermination,
  PlayerColor,
} from '../domain/game.types.js';

const lifecycleInclude = {
  players: { orderBy: { slot: 'asc' } },
} satisfies Prisma.GameInclude;

type PersistedGame = Prisma.GameGetPayload<{
  include: typeof lifecycleInclude;
}>;

type ResignTransactionResult =
  | Readonly<{ kind: 'accepted'; submission: TerminalSubmission }>
  | Readonly<{
      authoritativeVersion?: number;
      code:
        | 'GAME_ALREADY_ENDED'
        | 'GAME_NOT_FOUND'
        | 'IDEMPOTENCY_KEY_REUSED'
        | 'NOT_A_PLAYER'
        | 'STALE_GAME_VERSION';
      kind: 'rejected';
      message: string;
      retryable: boolean;
    }>;

const colorSchema = z.enum(['b', 'w']);
const clockSchema = z
  .object({
    blackMs: z.number().int().nonnegative(),
    observedAt: z.number().int().nonnegative(),
    running: z.null(),
    whiteMs: z.number().int().nonnegative(),
  })
  .strict();
const endedSchema = z
  .object({
    clocks: clockSchema,
    finalFen: z.string().min(1),
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
    pgn: z.string(),
    result: z.enum(['black_win', 'draw', 'void', 'white_win']),
    termination: z.enum([
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
    ]),
  })
  .strict();
const storedTerminalSchema = z
  .object({
    ended: endedSchema,
    guestSessionIds: z.tuple([z.uuidv4(), z.uuidv4()]),
  })
  .strict();

@Injectable()
export class PrismaGameLifecycleRepository implements GameLifecycleRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async resign(input: ResignGame): Promise<TerminalSubmission> {
    let result: ResignTransactionResult;
    try {
      result = await this.transactions.run((transaction) =>
        this.resignInTransaction(transaction, input),
      );
    } catch (error) {
      if (error instanceof DatabaseError && error.kind === 'unique') {
        const replay = await this.findResignReplay(input);
        if (replay !== null) {
          return replay;
        }
      }
      throw error;
    }

    if (result.kind === 'accepted') {
      return result.submission;
    }
    throw new GameServiceError(
      result.code,
      result.message,
      result.retryable,
      result.authoritativeVersion,
    );
  }

  terminateForReset(
    guestSessionId: string,
  ): Promise<TerminalSubmission | null> {
    return this.transactions.run(async (transaction) => {
      const assignment = await transaction.activeGameAssignment.findUnique({
        where: { guestSessionId },
      });
      if (assignment === null) {
        return null;
      }
      const locked = await this.transactions.lockGameClock(
        transaction,
        assignment.gameId,
      );
      if (locked === null) {
        return null;
      }
      const game = await this.findGame(transaction, assignment.gameId);
      if (
        game === null ||
        ![
          'IN_PROGRESS',
          'READY',
          'RECONNECTING',
          'WAITING_FOR_PLAYERS',
        ].includes(game.status)
      ) {
        return null;
      }
      const player = this.playerFor(game, guestSessionId);
      if (player === null) {
        return null;
      }
      const outcome = deriveTerminalOutcome({
        absent: [player.color],
        kind: 'ABANDONMENT',
      });
      return this.finalizeTerminal(transaction, game, locked, outcome);
    });
  }

  markDisconnected(
    guestSessionId: string,
    graceMs: number,
  ): Promise<PlayerDisconnected | null> {
    return this.transactions.run(async (transaction) => {
      const assignment = await transaction.activeGameAssignment.findUnique({
        where: { guestSessionId },
      });
      if (assignment === null) {
        return null;
      }
      const locked = await this.transactions.lockGameClock(
        transaction,
        assignment.gameId,
      );
      if (locked === null) {
        return null;
      }
      const game = await this.findGame(transaction, assignment.gameId);
      if (game === null) {
        return null;
      }
      const player = this.playerFor(game, guestSessionId);
      if (player === null) {
        return null;
      }
      if (game.status !== 'IN_PROGRESS' && game.status !== 'RECONNECTING') {
        if (game.status === 'WAITING_FOR_PLAYERS') {
          await transaction.gamePlayer.update({
            data: { connectedAt: null },
            where: { id: player.id },
          });
        }
        return null;
      }
      if (player.disconnectedAt !== null) {
        return null;
      }

      const graceDeadline = new Date(locked.observedAt.getTime() + graceMs);
      const otherDeadlines = game.players
        .filter((candidate) => candidate.id !== player.id)
        .map((candidate) => candidate.reconnectGraceEndsAt)
        .filter((deadline): deadline is Date => deadline !== null);
      const reconnectDeadlineAt = this.earliest([
        graceDeadline,
        ...otherDeadlines,
      ]);
      await transaction.gamePlayer.update({
        data: {
          connectedAt: null,
          disconnectedAt: locked.observedAt,
          reconnectGraceEndsAt: graceDeadline,
        },
        where: { id: player.id },
      });
      const updated = await transaction.game.updateMany({
        data: {
          reconnectDeadlineAt,
          status: 'RECONNECTING',
          version: { increment: 1 },
        },
        where: { id: game.id, version: game.version },
      });
      if (updated.count !== 1) {
        return null;
      }
      return {
        color: player.color,
        gameId: game.id,
        gameVersion: game.version + 1,
        graceDeadline: graceDeadline.getTime(),
      };
    });
  }

  markReconnected(guestSessionId: string): Promise<PlayerReconnected | null> {
    return this.transactions.run(async (transaction) => {
      const assignment = await transaction.activeGameAssignment.findUnique({
        where: { guestSessionId },
      });
      if (assignment === null) {
        return null;
      }
      const locked = await this.transactions.lockGameClock(
        transaction,
        assignment.gameId,
      );
      if (locked === null) {
        return null;
      }
      const game = await this.findGame(transaction, assignment.gameId);
      if (game?.status !== 'RECONNECTING') {
        return null;
      }
      const player = this.playerFor(game, guestSessionId);
      if (player === null) {
        return null;
      }
      if (player.disconnectedAt === null) {
        return null;
      }
      await transaction.gamePlayer.update({
        data: {
          connectedAt: locked.observedAt,
          disconnectedAt: null,
          reconnectGraceEndsAt: null,
        },
        where: { id: player.id },
      });
      const remainingDeadlines = game.players
        .filter((candidate) => candidate.id !== player.id)
        .map((candidate) => candidate.reconnectGraceEndsAt)
        .filter((deadline): deadline is Date => deadline !== null);
      const status =
        remainingDeadlines.length === 0 ? 'IN_PROGRESS' : 'RECONNECTING';
      const updated = await transaction.game.updateMany({
        data: {
          reconnectDeadlineAt:
            remainingDeadlines.length === 0
              ? null
              : this.earliest(remainingDeadlines),
          status,
          version: { increment: 1 },
        },
        where: { id: game.id, version: game.version },
      });
      if (updated.count !== 1) {
        return null;
      }
      return {
        color: player.color,
        gameId: game.id,
        gameVersion: game.version + 1,
      };
    });
  }

  adjudicateTimeout(gameId: string): Promise<TerminalSubmission | null> {
    return this.transactions.run(async (transaction) => {
      const locked = await this.transactions.lockGameClock(transaction, gameId);
      if (
        locked === null ||
        (locked.status !== 'IN_PROGRESS' && locked.status !== 'RECONNECTING')
      ) {
        return null;
      }
      if (!this.isColor(locked.turnColor)) {
        return null;
      }
      const remaining =
        locked.turnColor === 'w' ? locked.whiteClockMs : locked.blackClockMs;
      if (remaining > 0) {
        return null;
      }
      const game = await this.findGame(transaction, gameId);
      if (game === null) {
        return null;
      }
      const outcome = deriveTerminalOutcome({
        kind: 'TIMEOUT',
        loser: locked.turnColor,
      });
      return this.finalizeTerminal(transaction, game, locked, outcome);
    });
  }

  adjudicateNoShow(gameId: string): Promise<TerminalSubmission | null> {
    return this.transactions.run(async (transaction) => {
      const locked = await this.transactions.lockGameClock(transaction, gameId);
      if (locked?.status !== 'WAITING_FOR_PLAYERS') {
        return null;
      }
      const game = await this.findGame(transaction, gameId);
      if (game === null) {
        return null;
      }
      if (
        game.joinDeadlineAt === null ||
        game.joinDeadlineAt.getTime() > locked.observedAt.getTime()
      ) {
        return null;
      }
      const joined = game.players
        .filter((player) => player.joinedAt !== null)
        .map((player) => player.color)
        .filter((color): color is PlayerColor => this.isColor(color));
      const outcome = deriveTerminalOutcome({ joined, kind: 'NO_SHOW' });
      return this.finalizeTerminal(transaction, game, locked, outcome);
    });
  }

  async findGraceState(gameId: string): Promise<GraceState | null> {
    const result = await this.transactions.run(async (transaction) => {
      const game = await this.findGame(transaction, gameId);
      if (game?.status !== 'RECONNECTING') {
        return null;
      }
      const observedAt = await this.observedAt(transaction);
      return { game, observedAt };
    }, 'RepeatableRead');
    if (result === null) {
      return null;
    }
    const guestSessionIds = this.guestTuple(result.game);
    const dueGuestSessionIds = result.game.players
      .filter(
        (player) =>
          player.reconnectGraceEndsAt !== null &&
          player.reconnectGraceEndsAt.getTime() <= result.observedAt.getTime(),
      )
      .map((player) => player.guestSessionId);
    return dueGuestSessionIds.length === 0
      ? null
      : { dueGuestSessionIds, guestSessionIds };
  }

  adjudicateAbandonment(
    gameId: string,
    absentGuestSessionIds: readonly string[],
  ): Promise<TerminalSubmission | null> {
    return this.transactions.run(async (transaction) => {
      const locked = await this.transactions.lockGameClock(transaction, gameId);
      if (locked?.status !== 'RECONNECTING') {
        return null;
      }
      const game = await this.findGame(transaction, gameId);
      if (game === null) {
        return null;
      }
      const absentPlayers = game.players.filter((player) =>
        absentGuestSessionIds.includes(player.guestSessionId),
      );
      if (
        absentPlayers.length === 0 ||
        absentPlayers.some(
          (player) =>
            player.disconnectedAt === null ||
            player.reconnectGraceEndsAt === null,
        ) ||
        !absentPlayers.some(
          (player) =>
            player.reconnectGraceEndsAt !== null &&
            player.reconnectGraceEndsAt.getTime() <=
              locked.observedAt.getTime(),
        )
      ) {
        return null;
      }
      const absentColors = absentPlayers
        .map((player) => player.color)
        .filter((color): color is PlayerColor => this.isColor(color));
      const outcome = deriveTerminalOutcome({
        absent: absentColors,
        kind: 'ABANDONMENT',
      });
      return this.finalizeTerminal(transaction, game, locked, outcome);
    });
  }

  async findDeadline(gameId: string): Promise<DeadlineState | null> {
    try {
      const game = await this.prisma.game.findUnique({
        include: lifecycleInclude,
        where: { id: gameId },
      });
      if (game === null) {
        return null;
      }
      const candidates: Date[] = [];
      if (
        game.status === 'WAITING_FOR_PLAYERS' &&
        game.joinDeadlineAt !== null
      ) {
        candidates.push(game.joinDeadlineAt);
      }
      if (
        (game.status === 'IN_PROGRESS' || game.status === 'RECONNECTING') &&
        game.turnStartedAt !== null &&
        this.isColor(game.turnColor)
      ) {
        const remaining =
          game.turnColor === 'w' ? game.whiteClockMs : game.blackClockMs;
        candidates.push(new Date(game.turnStartedAt.getTime() + remaining));
      }
      if (game.status === 'RECONNECTING') {
        for (const player of game.players) {
          if (player.reconnectGraceEndsAt !== null) {
            candidates.push(player.reconnectGraceEndsAt);
          }
        }
      }
      const deadline = this.earliest(candidates);
      return deadline === null ? null : { deadline, gameId };
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findDueGameIds(limit: number): Promise<readonly string[]> {
    try {
      const rows = await this.prisma.$queryRaw<
        readonly Readonly<{ id: string }>[]
      >(Prisma.sql`
        SELECT DISTINCT game."id"
        FROM "games" AS game
        LEFT JOIN "game_players" AS player
          ON player."game_id" = game."id"
        WHERE
          (
            game."status" = 'WAITING_FOR_PLAYERS'
            AND game."join_deadline_at" <= clock_timestamp()
          )
          OR (
            game."status" IN ('IN_PROGRESS', 'RECONNECTING')
            AND game."turn_started_at" IS NOT NULL
            AND game."turn_started_at" + (
              CASE
                WHEN game."turn_color" = 'w'
                  THEN game."white_clock_ms"
                ELSE game."black_clock_ms"
              END * INTERVAL '1 millisecond'
            ) <= clock_timestamp()
          )
          OR (
            game."status" = 'RECONNECTING'
            AND player."reconnect_grace_ends_at" <= clock_timestamp()
          )
        ORDER BY game."id"
        LIMIT ${limit}
      `);
      return rows.map((row) => row.id);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findSchedulableGameIds(limit: number): Promise<readonly string[]> {
    try {
      const games = await this.prisma.game.findMany({
        orderBy: { updatedAt: 'asc' },
        select: { id: true },
        take: limit,
        where: {
          status: {
            in: ['WAITING_FOR_PLAYERS', 'IN_PROGRESS', 'RECONNECTING'],
          },
        },
      });
      return games.map((game) => game.id);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  private async resignInTransaction(
    transaction: TransactionClient,
    input: ResignGame,
  ): Promise<ResignTransactionResult> {
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
    const game = await this.findGame(transaction, input.gameId);
    if (game === null) {
      return this.rejected(
        'GAME_NOT_FOUND',
        'The requested game does not exist.',
        false,
      );
    }
    const player = this.playerFor(game, input.guestSessionId);
    if (player === null) {
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
          eventId: input.eventId,
          gameId: input.gameId,
        },
      },
    });
    if (replay !== null) {
      return this.replayResult(replay, input);
    }
    if (game.status !== 'IN_PROGRESS' && game.status !== 'RECONNECTING') {
      return this.rejected(
        'GAME_ALREADY_ENDED',
        'The game is no longer accepting resignation.',
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
    const outcome = deriveTerminalOutcome({
      kind: 'RESIGNATION',
      loser: player.color,
    });
    const submission = await this.finalizeTerminal(
      transaction,
      game,
      locked,
      outcome,
    );
    if (submission === null) {
      return this.rejected(
        'STALE_GAME_VERSION',
        'The game changed while the resignation was being applied.',
        true,
        game.version + 1,
      );
    }
    await transaction.gameCommand.create({
      data: {
        commandType: 'RESIGN',
        eventId: input.eventId,
        gameId: input.gameId,
        guestSessionId: input.guestSessionId,
        response: {
          ended: submission.ended,
          guestSessionIds: [...submission.guestSessionIds],
        },
        resultVersion: submission.ended.gameVersion,
      },
    });
    return { kind: 'accepted', submission };
  }

  private async finalizeTerminal(
    transaction: TransactionClient,
    game: PersistedGame,
    locked: LockedGameClock,
    outcome: Readonly<{
      result: GameResult;
      status: 'ABANDONED' | 'COMPLETED' | 'EXPIRED';
      termination: GameTermination;
    }>,
  ): Promise<TerminalSubmission | null> {
    const guestSessionIds = this.guestTuple(game);
    const version = game.version + 1;
    const updated = await transaction.game.updateMany({
      data: {
        blackClockMs: locked.blackClockMs,
        endedAt: locked.observedAt,
        reconnectDeadlineAt: null,
        result: this.persistedResult(outcome.result),
        status: outcome.status,
        termination: this.persistedTermination(outcome.termination),
        turnStartedAt: null,
        version: { increment: 1 },
        whiteClockMs: locked.whiteClockMs,
      },
      where: { id: game.id, version: game.version },
    });
    if (updated.count !== 1) {
      return null;
    }
    await Promise.all([
      transaction.gamePlayer.updateMany({
        data: {
          disconnectedAt: null,
          reconnectGraceEndsAt: null,
        },
        where: { gameId: game.id },
      }),
      transaction.activeGameAssignment.deleteMany({
        where: { gameId: game.id },
      }),
    ]);
    return {
      duplicate: false,
      ended: {
        clocks: this.terminalClock(locked),
        finalFen: game.currentFen,
        gameId: game.id,
        gameVersion: version,
        pgn: game.pgn,
        result: outcome.result,
        termination: outcome.termination,
      },
      guestSessionIds,
    };
  }

  private async findResignReplay(
    input: ResignGame,
  ): Promise<TerminalSubmission | null> {
    try {
      const command = await this.prisma.gameCommand.findUnique({
        where: {
          gameId_eventId: {
            eventId: input.eventId,
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
      throw new GameServiceError(
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
    input: ResignGame,
  ): Extract<ResignTransactionResult, { kind: 'accepted' | 'rejected' }> {
    if (
      command.commandType !== 'RESIGN' ||
      command.guestSessionId !== input.guestSessionId
    ) {
      return this.rejected(
        'IDEMPOTENCY_KEY_REUSED',
        'The event identifier was already used for a different command.',
        false,
      );
    }
    const parsed = storedTerminalSchema.safeParse(command.response);
    if (!parsed.success) {
      return this.rejected(
        'IDEMPOTENCY_KEY_REUSED',
        'The stored resignation acknowledgement is invalid.',
        false,
      );
    }
    return {
      kind: 'accepted',
      submission: {
        duplicate: true,
        ended: parsed.data.ended,
        guestSessionIds: parsed.data.guestSessionIds,
      },
    };
  }

  private async findGame(
    transaction: TransactionClient,
    gameId: string,
  ): Promise<PersistedGame | null> {
    return transaction.game.findUnique({
      include: lifecycleInclude,
      where: { id: gameId },
    });
  }

  private guestTuple(game: PersistedGame): readonly [string, string] {
    const first = game.players[0]?.guestSessionId;
    const second = game.players[1]?.guestSessionId;
    if (
      first === undefined ||
      second === undefined ||
      game.players.length !== 2
    ) {
      throw new Error('A lifecycle game must contain exactly two players.');
    }
    return [first, second];
  }

  private playerFor(
    game: PersistedGame,
    guestSessionId: string,
  ): (PersistedGame['players'][number] & { color: PlayerColor }) | null {
    const player = game.players.find(
      (candidate) => candidate.guestSessionId === guestSessionId,
    );
    return player !== undefined && this.isColor(player.color)
      ? { ...player, color: player.color }
      : null;
  }

  private terminalClock(locked: LockedGameClock): GameplayClock {
    return {
      blackMs: locked.blackClockMs,
      observedAt: locked.observedAt.getTime(),
      running: null,
      whiteMs: locked.whiteClockMs,
    };
  }

  private persistedResult(result: GameResult): string {
    const results: Readonly<Record<GameResult, string>> = {
      black_win: '0-1',
      draw: '1/2-1/2',
      void: '*',
      white_win: '1-0',
    };
    return results[result];
  }

  private persistedTermination(termination: GameTermination): string {
    const terminations: Readonly<Record<GameTermination, string>> = {
      abandonment: 'ABANDONMENT',
      checkmate: 'CHECKMATE',
      double_abandon: 'SYSTEM',
      fifty_move: 'FIFTY_MOVE_RULE',
      insufficient_material: 'INSUFFICIENT_MATERIAL',
      no_show: 'JOIN_TIMEOUT',
      resignation: 'RESIGNATION',
      stalemate: 'STALEMATE',
      threefold_repetition: 'THREEFOLD_REPETITION',
      timeout: 'TIMEOUT',
    };
    return terminations[termination];
  }

  private isColor(value: string): value is PlayerColor {
    return colorSchema.safeParse(value).success;
  }

  private earliest(values: readonly Date[]): Date | null {
    return values.reduce<Date | null>(
      (earliest, value) =>
        earliest === null || value.getTime() < earliest.getTime()
          ? value
          : earliest,
      null,
    );
  }

  private observedAt(transaction: TransactionClient): Promise<Date> {
    return transaction
      .$queryRaw<readonly Readonly<{ observedAt: Date }>[]>(
        Prisma.sql`SELECT clock_timestamp() AS "observedAt"`,
      )
      .then((rows) => {
        const observedAt = rows[0]?.observedAt;
        if (observedAt === undefined) {
          throw new Error('PostgreSQL did not return a lifecycle timestamp.');
        }
        return observedAt;
      });
  }

  private rejected(
    code: Extract<ResignTransactionResult, { kind: 'rejected' }>['code'],
    message: string,
    retryable: boolean,
    authoritativeVersion?: number,
  ): Extract<ResignTransactionResult, { kind: 'rejected' }> {
    return {
      ...(authoritativeVersion === undefined ? {} : { authoritativeVersion }),
      code,
      kind: 'rejected',
      message,
      retryable,
    };
  }
}
