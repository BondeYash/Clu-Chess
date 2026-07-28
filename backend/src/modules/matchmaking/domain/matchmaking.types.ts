export type MatchMode = 'blitz';
export type QueueExitReason =
  'disconnected' | 'matched' | 'requested' | 'stale' | 'timeout';

export type MatchReservation = Readonly<{
  a: string;
  aScore: number;
  b: string;
  bScore: number;
  createdAt: number;
  gameId: string;
  matchId: string;
  mode: MatchMode;
}>;

export type RemovedQueueGuest = Readonly<{
  guestSessionId: string;
  reason: Exclude<QueueExitReason, 'matched' | 'requested'>;
}>;

export type QueueJoin = Readonly<{
  duplicate: boolean;
  position: number;
  since: number;
}>;

export type QueueLeave = Readonly<{
  left: boolean;
}>;

export type MatchAttempt = Readonly<{
  discarded: readonly RemovedQueueGuest[];
  reservation: MatchReservation | null;
}>;

export type RollbackResult = Readonly<{
  requeued: readonly Readonly<{
    guestSessionId: string;
    since: number;
  }>[];
}>;
