import type { EndedGame } from './gameplay.repository.js';
import type { PlayerColor } from '../../domain/game.types.js';

export const GAME_LIFECYCLE_REPOSITORY = Symbol('GAME_LIFECYCLE_REPOSITORY');

export type TerminalSubmission = Readonly<{
  duplicate: boolean;
  ended: EndedGame;
  guestSessionIds: readonly [string, string];
}>;

export type PlayerDisconnected = Readonly<{
  color: PlayerColor;
  gameId: string;
  gameVersion: number;
  graceDeadline: number;
}>;

export type PlayerReconnected = Readonly<{
  color: PlayerColor;
  gameId: string;
  gameVersion: number;
}>;

export type ResignGame = Readonly<{
  eventId: string;
  expectedVersion: number;
  gameId: string;
  guestSessionId: string;
}>;

export type DeadlineState = Readonly<{
  deadline: Date;
  gameId: string;
}>;

export type GraceState = Readonly<{
  dueGuestSessionIds: readonly string[];
  guestSessionIds: readonly [string, string];
}>;

export interface GameLifecycleRepository {
  resign(input: ResignGame): Promise<TerminalSubmission>;
  terminateForReset(guestSessionId: string): Promise<TerminalSubmission | null>;
  markDisconnected(
    guestSessionId: string,
    graceMs: number,
  ): Promise<PlayerDisconnected | null>;
  markReconnected(guestSessionId: string): Promise<PlayerReconnected | null>;
  adjudicateTimeout(gameId: string): Promise<TerminalSubmission | null>;
  adjudicateNoShow(gameId: string): Promise<TerminalSubmission | null>;
  findGraceState(gameId: string): Promise<GraceState | null>;
  adjudicateAbandonment(
    gameId: string,
    absentGuestSessionIds: readonly string[],
  ): Promise<TerminalSubmission | null>;
  findDeadline(gameId: string): Promise<DeadlineState | null>;
  findDueGameIds(limit: number): Promise<readonly string[]>;
  findSchedulableGameIds(limit: number): Promise<readonly string[]>;
}
