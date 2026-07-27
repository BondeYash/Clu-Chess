import type { ServerEventEnvelope } from '../../protocol/protocol.schemas.js';

export const REALTIME_DELIVERY_PORT = Symbol('REALTIME_DELIVERY_PORT');

export interface RealtimeDeliveryPort {
  disconnectGuest(guestSessionId: string): Promise<void>;
  toGame(gameId: string, event: ServerEventEnvelope): void;
  toGuest(guestSessionId: string, event: ServerEventEnvelope): void;
}
