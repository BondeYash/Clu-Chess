import type {
  GameResult,
  GameStatus,
  GameTermination,
  PlayerColor,
} from '../../domain/game.types.js';

export type { GameStatus, PlayerColor } from '../../domain/game.types.js';

export type GamePlayerRecord = Readonly<{
  color: PlayerColor;
  gameId: string;
  guestSessionId: string;
  id: string;
  joinedAt: Date | null;
  slot: 0 | 1;
}>;

export type GameRecord = Readonly<{
  blackClockMs: number;
  currentFen: string;
  endedAt: Date | null;
  id: string;
  incrementMs: number;
  matchId: string;
  result: GameResult | null;
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
  initialFen: string;
  joinDeadlineAt: Date;
  matchId: string;
  timeIncrementMs: number;
  timeInitialMs: number;
  whiteGuestSessionId: string;
}>;

export type GameAllocation = Readonly<{
  game: GameRecord;
  players: readonly [GamePlayerRecord, GamePlayerRecord];
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
  updateAtVersion(input: UpdateGameAtVersion): Promise<GameRecord | null>;
}
