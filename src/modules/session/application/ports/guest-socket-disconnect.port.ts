export const GUEST_SOCKET_DISCONNECT_PORT = Symbol(
  'GUEST_SOCKET_DISCONNECT_PORT',
);

export interface GuestSocketDisconnectPort {
  disconnectGuest(guestSessionId: string): Promise<void>;
}
