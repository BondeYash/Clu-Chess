export type ActiveGameAssignmentRecord = Readonly<{
  createdAt: Date;
  gameId: string;
  guestSessionId: string;
}>;

export interface ActiveGameAssignmentRepository {
  findByGuestSessionId(
    guestSessionId: string,
  ): Promise<ActiveGameAssignmentRecord | null>;
  removeForTerminalGame(gameId: string): Promise<number>;
}
