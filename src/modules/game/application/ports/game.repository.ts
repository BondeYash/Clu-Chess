import type {
  GameResult,
  GameStatus,
  GameTermination,
  GameMove,
  PlayerColor,
} from '../../domain/game.types.js';

export type { GameStatus, PlayerColor } from '../../domain/game.types.js';

export const GAME_REPOSITORY = Symbol('GAME_REPOSITORY');

export type GamePlayerRecord = Readonly<{
  avatarKey: string;
  color: PlayerColor;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  displayName: string;
  gameId: string;
  guestSessionId: string;
  id: string;
  joinedAt: Date | null;
  reconnectGraceEndsAt: Date | null;
  slot: 0 | 1;
}>;

export type GameRecord = Readonly<{
  blackClockMs: number;
  currentFen: string;
  endedAt: Date | null;
  id: string;
  initialFen: string;
  incrementMs: number;
  joinDeadlineAt: Date | null;
  matchId: string;
  mode: 'BLITZ';
  pgn: string;
  result: GameResult | null;
  startedAt: Date | null;
  status: GameStatus;
  termination: GameTermination | null;
  timeInitialMs: number;
  turnColor: PlayerColor;
  turnStartedAt: Date | null;
  version: number;
  whiteClockMs: number;
}>;

export type AllocateGame = Readonly<{
  blackGuestSessionId: string;
  gameId: string;
  initialFen: string;
  joinDeadlineAt: Date;
  matchId: string;
  mode: 'BLITZ';
  observedAt: Date;
  pgn: string;
  timeIncrementMs: number;
  timeInitialMs: number;
  whiteGuestSessionId: string;
}>;

export type GameAllocation = Readonly<{
  game: GameRecord;
  players: readonly [GamePlayerRecord, GamePlayerRecord];
}>;

export type GameSnapshotRecord = GameAllocation &
  Readonly<{
    moves: readonly GameMove[];
    observedAt: Date;
  }>;

export type GuestMatchEligibility = Readonly<{
  activeGameId: string | null;
  eligible: boolean;
}>;

export type MarkGameReady = Readonly<{
  expectedVersion: number;
  gameId: string;
  guestSessionId: string;
  observedAt: Date;
}>;

export type StartGameResult = Readonly<{
  allocation: GameAllocation;
  started: boolean;
}>;

export type UpdateGameAtVersion = Readonly<{
  blackClockMs?: number;
  currentFen?: string;
  endedAt?: Date | null;
  expectedVersion: number;
  gameId: string;
  pgn?: string;
  result?: GameResult | null;
  status?: GameStatus;
  termination?: GameTermination | null;
  turnColor?: PlayerColor;
  turnStartedAt?: Date | null;
  whiteClockMs?: number;
}>;

export interface GameRepository {
  allocate(input: AllocateGame): Promise<GameAllocation>;
  findById(gameId: string): Promise<GameAllocation | null>;
  findByMatchId(matchId: string): Promise<GameAllocation | null>;
  findSnapshot(gameId: string): Promise<GameSnapshotRecord | null>;
  findActiveAllocations(limit: number): Promise<readonly GameAllocation[]>;
  getGuestMatchEligibility(
    guestSessionId: string,
    observedAt: Date,
  ): Promise<GuestMatchEligibility>;
  markReady(input: MarkGameReady): Promise<GameAllocation>;
  startIfReady(gameId: string): Promise<StartGameResult>;
  updateAtVersion(input: UpdateGameAtVersion): Promise<GameRecord | null>;
}
