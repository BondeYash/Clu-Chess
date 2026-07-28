import type { PlayerColor } from './game.repository.js';

export type MoveRecord = Readonly<{
  clientMoveId: string;
  color: PlayerColor;
  createdAt: Date;
  fenAfter: string;
  fenBefore: string;
  gameId: string;
  guestSessionId: string;
  id: string;
  ply: number;
  san: string;
  serverReceivedAt: Date;
  uci: string;
}>;

export type AppendMove = Omit<MoveRecord, 'createdAt' | 'id'>;

export interface MoveRepository {
  append(input: AppendMove): Promise<MoveRecord>;
  findByClientMoveId(
    gameId: string,
    clientMoveId: string,
  ): Promise<MoveRecord | null>;
  listForGame(gameId: string): Promise<readonly MoveRecord[]>;
}
