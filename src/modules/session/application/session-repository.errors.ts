export type SessionRepositoryFailureKind =
  'display-name-conflict' | 'session-unavailable';

export class SessionRepositoryError extends Error {
  constructor(readonly kind: SessionRepositoryFailureKind) {
    super(`Session repository operation failed (${kind})`);
    this.name = 'SessionRepositoryError';
  }
}
