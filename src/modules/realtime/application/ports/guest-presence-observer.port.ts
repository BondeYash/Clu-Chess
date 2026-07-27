export const GUEST_PRESENCE_OBSERVER = Symbol('GUEST_PRESENCE_OBSERVER');

export interface GuestPresenceObserver {
  finallyDisconnected(guestSessionId: string): Promise<void>;
}
