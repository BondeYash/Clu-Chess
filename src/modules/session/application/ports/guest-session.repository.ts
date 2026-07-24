export type GuestSessionRecord = Readonly<{
  avatarKey: string;
  createdAt: Date;
  currentJti: string | null;
  displayName: string;
  expiresAt: Date;
  id: string;
  issuedAt: Date;
  revokedAt: Date | null;
}>;

export type IssuedSessionClaims = Readonly<{
  expiresAt: Date;
  issuedAt: Date;
  jti: string;
}>;

export type CreateGuestSession = Readonly<{
  avatarKey: string;
  displayName: string;
  guestSessionId: string;
  idempotencyHash: string;
  issuedClaims: IssuedSessionClaims;
}>;

export type RenewGuestSession = Readonly<{
  guestSessionId: string;
  idempotencyHash: string;
  issuedClaims: IssuedSessionClaims;
}>;

export type ResetGuestSession = Readonly<{
  guestSessionId: string;
  idempotencyHash: string;
  revokedAt: Date;
}>;

export type SessionCommandReplay = Readonly<{
  commandType: 'CREATE' | 'RENEW' | 'RESET';
  guestSession: GuestSessionRecord;
  issuedClaims: IssuedSessionClaims | null;
}>;

export type SessionMutationResult = Readonly<{
  replayed: boolean;
  value: SessionCommandReplay;
}>;

export type RevokedSessionCursor = Readonly<{
  id: string;
  revokedAt: Date;
}>;

export const GUEST_SESSION_REPOSITORY = Symbol('GUEST_SESSION_REPOSITORY');

export interface GuestSessionRepository {
  cleanupExpired(cutoff: Date, limit: number): Promise<number>;
  create(input: CreateGuestSession): Promise<SessionMutationResult>;
  findByDisplayName(displayName: string): Promise<GuestSessionRecord | null>;
  findById(id: string): Promise<GuestSessionRecord | null>;
  findCommand(idempotencyHash: string): Promise<SessionCommandReplay | null>;
  findLiveRevoked(
    now: Date,
    limit: number,
    cursor?: RevokedSessionCursor,
  ): Promise<readonly GuestSessionRecord[]>;
  renew(input: RenewGuestSession): Promise<SessionMutationResult>;
  reset(input: ResetGuestSession): Promise<SessionMutationResult>;
}
