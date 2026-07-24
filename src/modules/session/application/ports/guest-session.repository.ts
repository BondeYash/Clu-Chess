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
  idempotencyHash: string;
  issuedClaims: IssuedSessionClaims;
}>;

export type RenewGuestSession = Readonly<{
  guestSessionId: string;
  idempotencyHash: string;
  issuedClaims: IssuedSessionClaims;
}>;

export type SessionCommandReplay = Readonly<{
  commandType: 'CREATE' | 'RENEW' | 'RESET';
  guestSession: GuestSessionRecord;
  issuedClaims: IssuedSessionClaims | null;
}>;

export interface GuestSessionRepository {
  create(input: CreateGuestSession): Promise<SessionCommandReplay>;
  findByDisplayName(displayName: string): Promise<GuestSessionRecord | null>;
  findById(id: string): Promise<GuestSessionRecord | null>;
  findCommand(idempotencyHash: string): Promise<SessionCommandReplay | null>;
  renew(input: RenewGuestSession): Promise<SessionCommandReplay>;
  revoke(guestSessionId: string, revokedAt: Date): Promise<boolean>;
}
