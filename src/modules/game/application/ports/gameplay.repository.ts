import type { MoveInput } from '../../../chess/application/ports/chess-engine.js';
import type {
  GameResult,
  GameTermination,
  PlayerColor,
} from '../../domain/game.types.js';

export const GAMEPLAY_REPOSITORY = Symbol('GAMEPLAY_REPOSITORY');

export type GameplayClock = Readonly<{
  blackMs: number;
  observedAt: number;
  running: PlayerColor | null;
  whiteMs: number;
}>;

export type AcceptedMove = Readonly<{
  check: boolean;
  clientMoveId: string;
  clocks: GameplayClock;
  fenAfter: string;
  gameId: string;
  gameVersion: number;
  ply: number;
  san: string;
  turn: PlayerColor;
  uci: string;
}>;

export type StartedGame = Readonly<{
  clocks: GameplayClock;
  gameId: string;
  gameVersion: number;
  initialFen: string;
}>;

export type EndedGame = Readonly<{
  clocks: GameplayClock;
  finalFen: string;
  gameId: string;
  gameVersion: number;
  pgn: string;
  result: GameResult;
  termination: GameTermination;
}>;

export type MoveSubmission = Readonly<{
  accepted: AcceptedMove;
  duplicate: boolean;
  ended: EndedGame | null;
  guestSessionIds: readonly [string, string];
  started: StartedGame | null;
}>;

export type SubmitMove = Readonly<{
  clientMoveId: string;
  expectedVersion: number;
  gameId: string;
  guestSessionId: string;
  move: MoveInput;
}>;

export interface GameplayRepository {
  submitMove(input: SubmitMove): Promise<MoveSubmission>;
}
