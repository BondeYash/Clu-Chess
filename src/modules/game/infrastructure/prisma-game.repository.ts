import { Injectable } from '@nestjs/common';
import type {
  GameResult,
  GameStatus,
  GameTermination,
  PlayerColor,
} from '../domain/game.types.js';
import {
  type AllocateGame,
  type GameAllocation,
  type GamePlayerRecord,
  type GameRecord,
  type GameRepository,
  type GuestMatchEligibility,
  type MarkGameReady,
  type UpdateGameAtVersion,
} from '../application/ports/game.repository.js';
import { GameServiceError } from '../domain/game-service.errors.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../persistence/transaction.service.js';

const allocationInclude = {
  players: {
    include: { guestSession: true },
    orderBy: { slot: 'asc' },
  },
} satisfies Prisma.GameInclude;

type PersistedAllocation = Prisma.GameGetPayload<{
  include: typeof allocationInclude;
}>;

type AllocationTransactionResult =
  | Readonly<{ allocation: PersistedAllocation; kind: 'allocated' }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'ineligible' }>
  | Readonly<{ kind: 'mismatch' }>;

type ReadyTransactionResult =
  | Readonly<{ allocation: PersistedAllocation; kind: 'ready' }>
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'not_player' }>
  | Readonly<{ kind: 'stale'; version: number }>
  | Readonly<{ kind: 'unavailable' }>;

@Injectable()
export class PrismaGameRepository implements GameRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async allocate(input: AllocateGame): Promise<GameAllocation> {
    if (input.whiteGuestSessionId === input.blackGuestSessionId) {
      throw new GameServiceError(
        'ALLOCATION_MISMATCH',
        'A game requires two distinct guests.',
        false,
      );
    }

    const result = await this.transactions.run((transaction) =>
      this.allocateInTransaction(transaction, input),
    );

    switch (result.kind) {
      case 'allocated':
        return this.mapAllocation(result.allocation);
      case 'conflict':
        throw new GameServiceError(
          'GUEST_ALREADY_IN_GAME',
          'A reserved guest already has a durable active game.',
          false,
        );
      case 'ineligible':
        throw new GameServiceError(
          'GUEST_NOT_ELIGIBLE',
          'A reserved guest session is no longer eligible.',
          false,
        );
      case 'mismatch':
        throw new GameServiceError(
          'ALLOCATION_MISMATCH',
          'The durable match allocation does not match its reservation.',
          false,
        );
    }
  }

  async findById(gameId: string): Promise<GameAllocation | null> {
    const game = await this.prisma.game.findUnique({
      include: allocationInclude,
      where: { id: gameId },
    });
    return game === null ? null : this.mapAllocation(game);
  }

  async findByMatchId(matchId: string): Promise<GameAllocation | null> {
    const game = await this.prisma.game.findUnique({
      include: allocationInclude,
      where: { matchId },
    });
    return game === null ? null : this.mapAllocation(game);
  }

  async findActiveAllocations(
    limit: number,
  ): Promise<readonly GameAllocation[]> {
    const games = await this.prisma.game.findMany({
      include: allocationInclude,
      orderBy: { updatedAt: 'asc' },
      take: limit,
      where: {
        status: {
          in: [
            'CREATED',
            'WAITING_FOR_PLAYERS',
            'READY',
            'IN_PROGRESS',
            'RECONNECTING',
          ],
        },
      },
    });
    return games.map((game) => this.mapAllocation(game));
  }

  async getGuestMatchEligibility(
    guestSessionId: string,
    observedAt: Date,
  ): Promise<GuestMatchEligibility> {
    const guest = await this.prisma.guestSession.findUnique({
      include: { activeAssignment: true },
      where: { id: guestSessionId },
    });

    return {
      activeGameId: guest?.activeAssignment?.gameId ?? null,
      eligible:
        guest !== null &&
        guest.revokedAt === null &&
        guest.expiresAt.getTime() > observedAt.getTime(),
    };
  }

  async markReady(input: MarkGameReady): Promise<GameAllocation> {
    const result = await this.transactions.run((transaction) =>
      this.markReadyInTransaction(transaction, input),
    );

    switch (result.kind) {
      case 'ready':
        return this.mapAllocation(result.allocation);
      case 'missing':
        throw new GameServiceError(
          'GAME_NOT_FOUND',
          'The requested game does not exist.',
          false,
        );
      case 'not_player':
        throw new GameServiceError(
          'NOT_A_PLAYER',
          'The authenticated guest is not a member of this game.',
          false,
        );
      case 'stale':
        throw new GameServiceError(
          'STALE_GAME_VERSION',
          'The game version is stale.',
          true,
          result.version,
        );
      case 'unavailable':
        throw new GameServiceError(
          'GAME_UNAVAILABLE',
          'The game is not waiting for player readiness.',
          false,
        );
    }
  }

  async updateAtVersion(
    input: UpdateGameAtVersion,
  ): Promise<GameRecord | null> {
    const updated = await this.prisma.game.updateMany({
      data: {
        ...(input.blackClockMs === undefined
          ? {}
          : { blackClockMs: input.blackClockMs }),
        ...(input.currentFen === undefined
          ? {}
          : { currentFen: input.currentFen }),
        ...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
        ...(input.pgn === undefined ? {} : { pgn: input.pgn }),
        ...(input.result === undefined
          ? {}
          : { result: this.persistedResult(input.result) }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.termination === undefined
          ? {}
          : { termination: this.persistedTermination(input.termination) }),
        ...(input.turnColor === undefined
          ? {}
          : { turnColor: input.turnColor }),
        ...(input.turnStartedAt === undefined
          ? {}
          : { turnStartedAt: input.turnStartedAt }),
        version: { increment: 1 },
        ...(input.whiteClockMs === undefined
          ? {}
          : { whiteClockMs: input.whiteClockMs }),
      },
      where: { id: input.gameId, version: input.expectedVersion },
    });
    if (updated.count !== 1) {
      return null;
    }
    const game = await this.prisma.game.findUnique({
      where: { id: input.gameId },
    });
    return game === null ? null : this.mapGame(game);
  }

  private async allocateInTransaction(
    transaction: TransactionClient,
    input: AllocateGame,
  ): Promise<AllocationTransactionResult> {
    const guestIds = [
      input.whiteGuestSessionId,
      input.blackGuestSessionId,
    ] as const;
    await this.transactions.lockGuestSessions(transaction, guestIds);

    const existing = await transaction.game.findUnique({
      include: allocationInclude,
      where: { matchId: input.matchId },
    });
    if (existing !== null) {
      return this.matchesReservation(existing, input)
        ? { allocation: existing, kind: 'allocated' }
        : { kind: 'mismatch' };
    }

    const eligibleGuests = await transaction.guestSession.count({
      where: {
        expiresAt: { gt: input.observedAt },
        id: { in: [...guestIds] },
        revokedAt: null,
      },
    });
    if (eligibleGuests !== 2) {
      return { kind: 'ineligible' };
    }

    const assignment = await transaction.activeGameAssignment.findFirst({
      where: { guestSessionId: { in: [...guestIds] } },
    });
    if (assignment !== null) {
      return { kind: 'conflict' };
    }

    const sortedGuestIds = [...guestIds].sort();
    const allocation = await transaction.game.create({
      data: {
        assignments: {
          create: sortedGuestIds.map((guestSessionId) => ({
            guestSession: { connect: { id: guestSessionId } },
          })),
        },
        blackClockMs: input.timeInitialMs,
        currentFen: input.initialFen,
        id: input.gameId,
        incrementMs: input.timeIncrementMs,
        initialFen: input.initialFen,
        joinDeadlineAt: input.joinDeadlineAt,
        matchId: input.matchId,
        mode: input.mode,
        pgn: input.pgn,
        players: {
          create: [
            {
              color: 'w',
              guestSession: {
                connect: { id: input.whiteGuestSessionId },
              },
              slot: 0,
            },
            {
              color: 'b',
              guestSession: {
                connect: { id: input.blackGuestSessionId },
              },
              slot: 1,
            },
          ],
        },
        status: 'WAITING_FOR_PLAYERS',
        timeInitialMs: input.timeInitialMs,
        turnColor: 'w',
        version: 0,
        whiteClockMs: input.timeInitialMs,
      },
      include: allocationInclude,
    });
    return { allocation, kind: 'allocated' };
  }

  private async markReadyInTransaction(
    transaction: TransactionClient,
    input: MarkGameReady,
  ): Promise<ReadyTransactionResult> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "games"
        WHERE "id" = ${input.gameId}::UUID FOR UPDATE`,
    );
    let game = await transaction.game.findUnique({
      include: allocationInclude,
      where: { id: input.gameId },
    });
    if (game === null) {
      return { kind: 'missing' };
    }

    const player = game.players.find(
      (candidate) => candidate.guestSessionId === input.guestSessionId,
    );
    if (player === undefined) {
      return { kind: 'not_player' };
    }

    const idempotent =
      player.joinedAt !== null &&
      ['READY', 'IN_PROGRESS', 'RECONNECTING'].includes(game.status);
    if (input.expectedVersion !== game.version && !idempotent) {
      return { kind: 'stale', version: game.version };
    }
    if (
      !['WAITING_FOR_PLAYERS', 'READY', 'IN_PROGRESS', 'RECONNECTING'].includes(
        game.status,
      )
    ) {
      return { kind: 'unavailable' };
    }

    await transaction.gamePlayer.update({
      data: {
        connectedAt: input.observedAt,
        joinedAt: player.joinedAt ?? input.observedAt,
      },
      where: { id: player.id },
    });

    const joinedPlayers = await transaction.gamePlayer.count({
      where: { gameId: input.gameId, joinedAt: { not: null } },
    });
    if (game.status === 'WAITING_FOR_PLAYERS' && joinedPlayers === 2) {
      const version = await this.transactions.updateGameAtVersion(
        transaction,
        game.id,
        game.version,
        { status: 'READY' },
      );
      if (version === null) {
        return { kind: 'stale', version: game.version };
      }
    }

    game = await transaction.game.findUnique({
      include: allocationInclude,
      where: { id: input.gameId },
    });
    return game === null
      ? { kind: 'missing' }
      : { allocation: game, kind: 'ready' };
  }

  private mapAllocation(game: PersistedAllocation): GameAllocation {
    const players = game.players.map((player) => this.mapPlayer(player));
    const white = players[0];
    const black = players[1];
    if (white === undefined || black === undefined || players.length !== 2) {
      throw new GameServiceError(
        'ALLOCATION_MISMATCH',
        'A durable game does not contain exactly two players.',
        false,
      );
    }
    return { game: this.mapGame(game), players: [white, black] };
  }

  private mapGame(game: Prisma.GameGetPayload<object>): GameRecord {
    if (game.mode !== 'BLITZ' || !this.isStatus(game.status)) {
      throw new GameServiceError(
        'ALLOCATION_MISMATCH',
        'A durable game contains an unsupported mode or status.',
        false,
      );
    }
    return {
      blackClockMs: game.blackClockMs,
      currentFen: game.currentFen,
      endedAt: game.endedAt,
      id: game.id,
      incrementMs: game.incrementMs,
      initialFen: game.initialFen,
      joinDeadlineAt: game.joinDeadlineAt,
      matchId: game.matchId,
      mode: game.mode,
      pgn: game.pgn,
      result: this.domainResult(game.result),
      startedAt: game.startedAt,
      status: game.status,
      termination: this.domainTermination(game.termination),
      timeInitialMs: game.timeInitialMs,
      turnColor: this.color(game.turnColor),
      turnStartedAt: game.turnStartedAt,
      version: game.version,
      whiteClockMs: game.whiteClockMs,
    };
  }

  private mapPlayer(
    player: PersistedAllocation['players'][number],
  ): GamePlayerRecord {
    if (
      (player.slot !== 0 && player.slot !== 1) ||
      (player.color !== 'w' && player.color !== 'b')
    ) {
      throw new GameServiceError(
        'ALLOCATION_MISMATCH',
        'A durable player slot is malformed.',
        false,
      );
    }
    return {
      avatarKey: player.guestSession.avatarKey,
      color: player.color,
      connectedAt: player.connectedAt,
      displayName: player.guestSession.displayName,
      gameId: player.gameId,
      guestSessionId: player.guestSessionId,
      id: player.id,
      joinedAt: player.joinedAt,
      slot: player.slot,
    };
  }

  private matchesReservation(
    game: PersistedAllocation,
    input: AllocateGame,
  ): boolean {
    const expectedPlayers = [
      input.whiteGuestSessionId,
      input.blackGuestSessionId,
    ].sort();
    const actualPlayers = game.players
      .map((player) => player.guestSessionId)
      .sort();
    return (
      game.id === input.gameId &&
      game.mode === input.mode &&
      actualPlayers.length === 2 &&
      actualPlayers.every(
        (guestSessionId, index) => guestSessionId === expectedPlayers[index],
      )
    );
  }

  private color(value: string): PlayerColor {
    if (value !== 'w' && value !== 'b') {
      throw new GameServiceError(
        'ALLOCATION_MISMATCH',
        'A durable game contains an invalid turn color.',
        false,
      );
    }
    return value;
  }

  private domainResult(value: string | null): GameResult | null {
    const results: Readonly<Record<string, GameResult>> = {
      '*': 'void',
      '0-1': 'black_win',
      '1-0': 'white_win',
      '1/2-1/2': 'draw',
    };
    return value === null ? null : (results[value] ?? null);
  }

  private domainTermination(value: string | null): GameTermination | null {
    const terminations: Readonly<Record<string, GameTermination>> = {
      ABANDONMENT: 'abandonment',
      CHECKMATE: 'checkmate',
      FIFTY_MOVE_RULE: 'fifty_move',
      INSUFFICIENT_MATERIAL: 'insufficient_material',
      JOIN_TIMEOUT: 'no_show',
      RESIGNATION: 'resignation',
      STALEMATE: 'stalemate',
      SYSTEM: 'double_abandon',
      THREEFOLD_REPETITION: 'threefold_repetition',
      TIMEOUT: 'timeout',
    };
    return value === null ? null : (terminations[value] ?? null);
  }

  private isStatus(value: string): value is GameStatus {
    return [
      'ABANDONED',
      'COMPLETED',
      'CREATED',
      'EXPIRED',
      'IN_PROGRESS',
      'READY',
      'RECONNECTING',
      'WAITING_FOR_PLAYERS',
    ].includes(value);
  }

  private persistedResult(value: GameResult | null): string | null {
    const results: Readonly<Record<GameResult, string>> = {
      black_win: '0-1',
      draw: '1/2-1/2',
      void: '*',
      white_win: '1-0',
    };
    return value === null ? null : results[value];
  }

  private persistedTermination(value: GameTermination | null): string | null {
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
    return value === null ? null : terminations[value];
  }
}
