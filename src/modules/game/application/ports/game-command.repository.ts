export type GameCommandRecord = Readonly<{
  commandType: string;
  createdAt: Date;
  eventId: string;
  gameId: string;
  guestSessionId: string;
  response: Readonly<Record<string, unknown>>;
  resultVersion: number;
}>;

export type SaveGameCommand = Omit<GameCommandRecord, 'createdAt'>;

export interface GameCommandRepository {
  find(gameId: string, eventId: string): Promise<GameCommandRecord | null>;
  save(command: SaveGameCommand): Promise<GameCommandRecord>;
}
