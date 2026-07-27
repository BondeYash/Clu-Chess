import type { Server, Socket } from 'socket.io';
import type { ServerEventEnvelope } from './protocol/protocol.schemas.js';

type ClientToServerEvents = Record<string, (...arguments_: unknown[]) => void>;

type ServerToClientEvents = Record<
  string,
  (event: ServerEventEnvelope) => void
>;

type InterServerEvents = Record<string, (...arguments_: unknown[]) => void>;

export interface AuthenticatedSocketIdentity {
  avatar: string;
  expiresAt: string;
  guestSessionId: string;
  name: string;
}

export interface RealtimeSocketData {
  addressHash?: string;
  correlationId?: string;
  identity?: Readonly<AuthenticatedSocketIdentity>;
  socketMember?: string;
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>;

export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>;

export type RealtimeAckCallback = (ack: unknown) => void;
