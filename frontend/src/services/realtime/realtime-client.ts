import {
  CLIENT_EVENT_NAMES,
  PROTOCOL_VERSION,
  type ClientEventName,
} from '@cluchess/protocol-v1/constants';
import {
  clientEnvelopeSchema,
  clientRealtimeAckSchema,
  clientServerEnvelopeSchema,
  type ClientEventEnvelope,
  type ClientReceivedRealtimeAck,
  type ClientReceivedServerEventEnvelope,
} from '@cluchess/protocol-v1/realtime';
import type { Socket } from 'socket.io-client';

import { publicEnvironment } from '@/config/environment';
import { transportStore, type TransportIssue } from '@/stores/transport-store';

import { EventIdLru } from './event-id-lru';
import { RealtimeError } from './realtime-error';

const ACK_TIMEOUT_MS = 8_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SERVER_EVENTS = new Set<string>(
  clientServerEnvelopeSchema.options.map(
    (option) => option.shape.type.value as string,
  ),
);

type CommandOf<Type extends ClientEventName> = Extract<
  ClientEventEnvelope,
  { type: Type }
>;
export type CommandFields<Type extends ClientEventName> = Omit<
  CommandOf<Type>,
  'eventId' | 'protocolVersion' | 'timestamp' | 'type'
>;

type RealtimeEventListener = (event: ClientReceivedServerEventEnvelope) => void;
type TimerHandle = ReturnType<typeof globalThis.setInterval>;

interface HandshakeError extends Error {
  data?: {
    code?: unknown;
    correlationId?: unknown;
    retryAfterMs?: unknown;
    retryable?: unknown;
  };
}

interface RealtimeClientDependencies {
  ackTimeoutMs?: number;
  createId?: () => string;
  heartbeatIntervalMs?: number;
  loadSocket?: (origin: string, token: string) => Promise<Socket>;
  now?: () => number;
  setIntervalImplementation?: (
    handler: () => void,
    timeout: number,
  ) => TimerHandle;
  clearIntervalImplementation?: (timer: TimerHandle) => void;
}

export class RealtimeClient {
  private readonly ackTimeoutMs: number;
  private readonly clearIntervalImplementation: (timer: TimerHandle) => void;
  private connecting: Promise<void> | undefined;
  private readonly createId: () => string;
  private readonly eventIds = new EventIdLru();
  private readonly heartbeatIntervalMs: number;
  private heartbeatInFlight = false;
  private heartbeatTimer: TimerHandle | undefined;
  private identityId: string | undefined;
  private readonly listeners = new Set<RealtimeEventListener>();
  private readonly loadSocket: (
    origin: string,
    token: string,
  ) => Promise<Socket>;
  private readonly now: () => number;
  private readonly setIntervalImplementation: (
    handler: () => void,
    timeout: number,
  ) => TimerHandle;
  private socket: Socket | undefined;

  constructor({
    ackTimeoutMs = ACK_TIMEOUT_MS,
    clearIntervalImplementation = globalThis.clearInterval,
    createId = () => crypto.randomUUID(),
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    loadSocket = loadBrowserSocket,
    now = Date.now,
    setIntervalImplementation = globalThis.setInterval,
  }: RealtimeClientDependencies = {}) {
    this.ackTimeoutMs = ackTimeoutMs;
    this.clearIntervalImplementation = clearIntervalImplementation;
    this.createId = createId;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.loadSocket = loadSocket;
    this.now = now;
    this.setIntervalImplementation = setIntervalImplementation;
  }

  async connect({
    identityId,
    token,
  }: {
    identityId: string;
    token: string;
  }): Promise<void> {
    if (this.socket && this.identityId === identityId) {
      this.socket.auth = { token };
      if (!this.socket.connected) {
        transportStore.status('connecting');
        this.socket.connect();
      }
      return;
    }
    if (this.connecting && this.identityId === identityId) {
      await this.connecting;
      if (this.socket) this.socket.auth = { token };
      return;
    }

    this.disconnect();
    this.identityId = identityId;
    transportStore.status('connecting');
    const connecting = this.loadSocket(
      publicEnvironment.NEXT_PUBLIC_SOCKET_ORIGIN,
      token,
    ).then((socket) => {
      if (this.identityId !== identityId) {
        socket.disconnect();
        return;
      }
      this.socket = socket;
      this.registerListeners(socket);
      socket.connect();
    });
    const tracked = connecting.finally(() => {
      if (this.connecting === tracked) this.connecting = undefined;
    });
    this.connecting = tracked;
    await this.connecting;
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.off();
      this.socket.offAny();
      this.socket.io.off();
      this.socket.disconnect();
    }
    this.socket = undefined;
    this.connecting = undefined;
    this.identityId = undefined;
    this.eventIds.clear();
    transportStore.reset();
  }

  async emitCommand<Type extends ClientEventName>(
    type: Type,
    fields: CommandFields<Type>,
    eventId = this.createId(),
  ): Promise<ClientReceivedRealtimeAck> {
    const socket = this.socket;
    if (!socket?.connected) {
      throw new RealtimeError({
        code: 'TRANSPORT_OFFLINE',
        message: 'The realtime connection is not ready.',
        retryable: true,
      });
    }
    const envelope = createCommand(type, fields, eventId, this.now());

    return new Promise((resolve, reject) => {
      socket
        .timeout(this.ackTimeoutMs)
        .emit(type, envelope, (error: Error | null, rawAck: unknown) => {
          if (error) {
            transportStore.incrementTelemetry('commandTimeouts');
            reject(
              new RealtimeError({
                cause: error,
                code: 'ACK_TIMEOUT',
                message: 'The server did not confirm the realtime command.',
                retryable: true,
              }),
            );
            return;
          }
          const parsed = clientRealtimeAckSchema.safeParse(rawAck);
          if (
            !parsed.success ||
            parsed.data.requestEventId !== envelope.eventId
          ) {
            transportStore.incrementTelemetry('invalidAcks');
            reject(
              new RealtimeError({
                cause: parsed.success ? undefined : parsed.error,
                code: 'INVALID_ACK',
                message:
                  'The service returned an invalid realtime acknowledgement.',
                retryable: false,
              }),
            );
            return;
          }
          resolve(parsed.data);
        });
    });
  }

  subscribe(listener: RealtimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleServerEvent(eventName: string, rawEvent: unknown): void {
    if (!SERVER_EVENTS.has(eventName)) return;
    const parsed = clientServerEnvelopeSchema.safeParse(rawEvent);
    if (!parsed.success || parsed.data.type !== eventName) {
      transportStore.incrementTelemetry('invalidEvents');
      transportStore.issue({
        code: 'INVALID_SERVER_EVENT',
        message:
          'A realtime update could not be verified. Safe state is being recovered.',
        retryable: true,
      });
      return;
    }
    transportStore.incrementTelemetry('receivedEvents');
    if (!this.eventIds.add(parsed.data.eventId)) {
      transportStore.incrementTelemetry('duplicateEvents');
      return;
    }
    if (parsed.data.type === 'server.error') {
      transportStore.issue({
        code: parsed.data.payload.code,
        correlationId: parsed.data.correlationId,
        message: parsed.data.payload.message,
        retryable: parsed.data.payload.retryable,
      });
    }
    for (const listener of this.listeners) listener(parsed.data);
  }

  private registerListeners(socket: Socket): void {
    socket.on('connect', () => {
      transportStore.connected();
      this.startHeartbeat();
    });
    socket.on('connect_error', (error: HandshakeError) => {
      const issue = parseHandshakeIssue(error);
      transportStore.issue(issue);
      transportStore.status(socket.active ? 'reconnecting' : 'unavailable');
    });
    socket.on('disconnect', (reason) => {
      this.stopHeartbeat();
      if (reason !== 'io client disconnect') {
        transportStore.status(socket.active ? 'reconnecting' : 'unavailable');
      }
    });
    socket.io.on('reconnect_attempt', (attempt) => {
      transportStore.reconnecting(attempt);
    });
    socket.io.on('reconnect_failed', () => {
      transportStore.status('unavailable');
    });
    socket.onAny((eventName: string, rawEvent: unknown) => {
      this.handleServerEvent(eventName, rawEvent);
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    void this.sendHeartbeat();
    this.heartbeatTimer = this.setIntervalImplementation(() => {
      void this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      this.clearIntervalImplementation(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.heartbeatInFlight = false;
  }

  private async sendHeartbeat(): Promise<void> {
    if (this.heartbeatInFlight || !this.socket?.connected) return;
    this.heartbeatInFlight = true;
    const startedAt = this.now();
    try {
      const ack = await this.emitCommand('heartbeat.ping', { payload: {} });
      if (ack.ok && ack.type === 'heartbeat.pong') {
        transportStore.heartbeat(this.now(), this.now() - startedAt);
        transportStore.clearIssue();
      }
    } catch (error) {
      transportStore.issue(toTransportIssue(error));
    } finally {
      this.heartbeatInFlight = false;
    }
  }
}

export function createCommand<Type extends ClientEventName>(
  type: Type,
  fields: CommandFields<Type>,
  eventId = crypto.randomUUID(),
  timestamp = Date.now(),
): CommandOf<Type> {
  if (!CLIENT_EVENT_NAMES.includes(type)) {
    throw new Error(`Unsupported client event: ${type}`);
  }
  return clientEnvelopeSchema.parse({
    ...fields,
    eventId,
    protocolVersion: PROTOCOL_VERSION,
    timestamp,
    type,
  }) as CommandOf<Type>;
}

async function loadBrowserSocket(
  origin: string,
  token: string,
): Promise<Socket> {
  const { io } = await import('socket.io-client');
  const options = {
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    timeout: 10_000,
    withCredentials: true,
  };
  return origin ? io(origin, options) : io(options);
}

function parseHandshakeIssue(error: HandshakeError): TransportIssue {
  const data = error.data;
  return {
    code: typeof data?.code === 'string' ? data.code : 'CONNECTION_FAILED',
    correlationId:
      typeof data?.correlationId === 'string' ? data.correlationId : undefined,
    message:
      error.message || 'The realtime service could not be connected safely.',
    retryable: typeof data?.retryable === 'boolean' ? data.retryable : true,
  };
}

function toTransportIssue(error: unknown): TransportIssue {
  if (error instanceof RealtimeError) {
    return {
      code: error.code,
      correlationId: error.correlationId,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: 'REALTIME_INTERRUPTED',
    message: 'The realtime service was interrupted.',
    retryable: true,
  };
}

export const realtimeClient = new RealtimeClient();
