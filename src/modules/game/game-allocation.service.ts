import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import {
  CHESS_ENGINE,
  type ChessEngine,
} from '../chess/application/ports/chess-engine.js';
import type { MatchReservation } from '../matchmaking/domain/matchmaking.types.js';
import {
  GAME_REPOSITORY,
  type GameAllocation,
  type GameRepository,
  type GuestMatchEligibility,
} from './application/ports/game.repository.js';

@Injectable()
export class GameAllocationService {
  private readonly incrementMs: number;
  private readonly initialMs: number;
  private readonly joinDeadlineMs: number;

  constructor(
    @Inject(GAME_REPOSITORY)
    private readonly games: GameRepository,
    @Inject(CHESS_ENGINE)
    private readonly chess: ChessEngine,
    config: AppConfigService,
  ) {
    this.incrementMs = config.values.TIME_INCREMENT_MS;
    this.initialMs = config.values.TIME_INITIAL_MS;
    this.joinDeadlineMs = config.values.JOIN_DEADLINE_MS;
  }

  allocate(
    reservation: MatchReservation,
    observedAt = new Date(),
  ): Promise<GameAllocation> {
    const firstGuestIsWhite = randomInt(2) === 0;
    const initial = this.chess.newGame();
    return this.games.allocate({
      blackGuestSessionId: firstGuestIsWhite ? reservation.b : reservation.a,
      gameId: reservation.gameId,
      initialFen: initial.fen,
      joinDeadlineAt: new Date(observedAt.getTime() + this.joinDeadlineMs),
      matchId: reservation.matchId,
      mode: 'BLITZ',
      observedAt,
      pgn: initial.pgn,
      timeIncrementMs: this.incrementMs,
      timeInitialMs: this.initialMs,
      whiteGuestSessionId: firstGuestIsWhite ? reservation.a : reservation.b,
    });
  }

  findByMatchId(matchId: string): Promise<GameAllocation | null> {
    return this.games.findByMatchId(matchId);
  }

  listActive(limit: number): Promise<readonly GameAllocation[]> {
    return this.games.findActiveAllocations(limit);
  }

  eligibility(
    guestSessionId: string,
    observedAt = new Date(),
  ): Promise<GuestMatchEligibility> {
    return this.games.getGuestMatchEligibility(guestSessionId, observedAt);
  }
}
