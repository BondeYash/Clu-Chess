import type { ClientEventName } from '@cluchess/protocol-v1/constants';
import type { Socket } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transportStore, useTransportStore } from '@/stores/transport-store';

import { RealtimeClient, createCommand } from './realtime-client';

const eventId = '11111111-1111-4111-8111-111111111111';
const correlationId = '22222222-2222-4222-8222-222222222222';
const guestId = '33333333-3333-4333-8333-333333333333';
const activeGameId = '44444444-4444-4444-8444-444444444444';

describe('RealtimeClient', () => {
  beforeEach(() => {
    transportStore.reset();
  });

  it('creates one socket and one heartbeat timer per identity', async () => {
    const socket = new FakeSocket();
    const loadSocket = vi.fn().mockResolvedValue(socket as unknown as Socket);
    const setIntervalImplementation = vi.fn().mockReturnValue(17);
    const clearIntervalImplementation = vi.fn();
    const client = new RealtimeClient({
      clearIntervalImplementation,
      createId: () => eventId,
      loadSocket,
      now: () => 1_000,
      setIntervalImplementation,
    });

    await client.connect({ identityId: guestId, token: 'first-token' });
    await client.connect({ identityId: guestId, token: 'renewed-token' });

    expect(loadSocket).toHaveBeenCalledOnce();
    expect(socket.connectCalls).toBe(1);
    expect(socket.auth).toEqual({ token: 'renewed-token' });
    expect(setIntervalImplementation).toHaveBeenCalledOnce();
    expect(useTransportStore.getState().status).toBe('connected');

    client.disconnect();
    expect(clearIntervalImplementation).toHaveBeenCalledWith(17);
    expect(socket.disconnectCalls).toBe(1);
    expect(useTransportStore.getState().status).toBe('idle');
  });

  it('validates, deduplicates, and publishes supported server events', async () => {
    const socket = new FakeSocket();
    const listener = vi.fn();
    const client = createClient(socket);
    client.subscribe(listener);
    await client.connect({ identityId: guestId, token: 'private-token' });
    const event = sessionReadyEvent();

    socket.serverEvent('session.ready', event);
    socket.serverEvent('session.ready', event);
    socket.serverEvent('session.ready', { ...event, type: 'queue.left' });
    socket.serverEvent('future.event', event);

    expect(listener).toHaveBeenCalledOnce();
    expect(useTransportStore.getState().telemetry).toMatchObject({
      duplicateEvents: 1,
      invalidEvents: 1,
      receivedEvents: 2,
    });
    expect(useTransportStore.getState().issue?.code).toBe(
      'INVALID_SERVER_EVENT',
    );
  });

  it('rejects ack timeouts and mismatched acknowledgements', async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    await client.connect({ identityId: guestId, token: 'private-token' });

    socket.ackMode = 'mismatch';
    await expect(
      client.emitCommand('game.sync', { payload: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_ACK' });

    socket.ackMode = 'timeout';
    await expect(
      client.emitCommand('game.sync', { payload: {} }),
    ).rejects.toMatchObject({ code: 'ACK_TIMEOUT' });
    expect(useTransportStore.getState().telemetry).toMatchObject({
      commandTimeouts: 1,
      invalidAcks: 1,
    });

    client.disconnect();
    await expect(
      client.emitCommand('game.sync', { payload: {} }),
    ).rejects.toMatchObject({ code: 'TRANSPORT_OFFLINE' });
  });

  it('rejects malformed acknowledgements independently from mismatched IDs', async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    await client.connect({ identityId: guestId, token: 'private-token' });

    socket.ackMode = 'invalid';
    await expect(
      client.emitCommand('game.sync', { payload: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_ACK', retryable: false });
    expect(useTransportStore.getState().telemetry.invalidAcks).toBe(1);
  });

  it('classifies handshake and reconnection state without logging secrets', async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    await client.connect({ identityId: guestId, token: 'private-token' });
    socket.trigger('connect_error', {
      data: {
        code: 'SERVICE_UNAVAILABLE',
        correlationId,
        retryable: true,
      },
      message: 'Server restarting',
    });
    socket.manager.trigger('reconnect_attempt', 1);

    expect(useTransportStore.getState()).toMatchObject({
      issue: {
        code: 'SERVICE_UNAVAILABLE',
        correlationId,
        retryable: true,
      },
      reconnectAttempt: 1,
      status: 'reconnecting',
    });
    socket.manager.trigger('reconnect_failed');
    expect(useTransportStore.getState().status).toBe('unavailable');
  });

  it('marks terminal middleware denial unavailable with safe fallback metadata', async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    await client.connect({ identityId: guestId, token: 'private-token' });
    socket.active = false;
    const error = new Error('') as Error & { data?: unknown };

    socket.trigger('connect_error', error);

    expect(useTransportStore.getState()).toMatchObject({
      issue: {
        code: 'CONNECTION_FAILED',
        message: 'The realtime service could not be connected safely.',
        retryable: true,
      },
      status: 'unavailable',
    });
  });

  it('serializes concurrent connection setup and reconnects an existing identity', async () => {
    const socket = new FakeSocket();
    let resolveSocket: ((socket: Socket) => void) | undefined;
    const loadSocket = vi.fn(
      () =>
        new Promise<Socket>((resolve) => {
          resolveSocket = resolve;
        }),
    );
    const client = new RealtimeClient({
      clearIntervalImplementation: vi.fn(),
      createId: () => eventId,
      loadSocket,
      now: () => 1_000,
      setIntervalImplementation: vi.fn().mockReturnValue(17),
    });

    const first = client.connect({
      identityId: guestId,
      token: 'first-token',
    });
    const second = client.connect({
      identityId: guestId,
      token: 'renewed-token',
    });
    resolveSocket?.(socket as unknown as Socket);
    await Promise.all([first, second]);

    expect(loadSocket).toHaveBeenCalledOnce();
    expect(socket.auth).toEqual({ token: 'renewed-token' });
    socket.connected = false;
    await client.connect({ identityId: guestId, token: 'latest-token' });
    expect(socket.connectCalls).toBe(2);
    expect(socket.auth).toEqual({ token: 'latest-token' });
  });

  it('disconnects an old identity before replacing its socket', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const loadSocket = vi
      .fn()
      .mockResolvedValueOnce(firstSocket as unknown as Socket)
      .mockResolvedValueOnce(secondSocket as unknown as Socket);
    const client = new RealtimeClient({
      clearIntervalImplementation: vi.fn(),
      createId: () => eventId,
      loadSocket,
      now: () => 1_000,
      setIntervalImplementation: vi.fn().mockReturnValue(17),
    });

    await client.connect({ identityId: guestId, token: 'first-token' });
    await client.connect({
      identityId: '66666666-6666-4666-8666-666666666666',
      token: 'second-token',
    });

    expect(firstSocket.disconnectCalls).toBe(1);
    expect(secondSocket.connectCalls).toBe(1);
    expect(loadSocket).toHaveBeenCalledTimes(2);
  });

  it('publishes server errors and ignores them after unsubscribe', async () => {
    const socket = new FakeSocket();
    const listener = vi.fn();
    const client = createClient(socket);
    const unsubscribe = client.subscribe(listener);
    await client.connect({ identityId: guestId, token: 'private-token' });

    socket.serverEvent('server.error', serverErrorEvent());
    expect(listener).toHaveBeenCalledOnce();
    expect(useTransportStore.getState().issue).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      correlationId,
      retryable: true,
    });

    unsubscribe();
    socket.serverEvent('server.error', {
      ...serverErrorEvent(),
      eventId: '77777777-7777-4777-8777-777777777777',
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('reports heartbeat timeout and transport interruption without leaking the command', async () => {
    const timeoutSocket = new FakeSocket();
    timeoutSocket.ackMode = 'timeout';
    const timeoutClient = createClient(timeoutSocket);
    await timeoutClient.connect({
      identityId: guestId,
      token: 'private-token',
    });
    await vi.waitFor(() =>
      expect(useTransportStore.getState().issue?.code).toBe('ACK_TIMEOUT'),
    );

    timeoutClient.disconnect();
    const throwingSocket = new FakeSocket();
    throwingSocket.ackMode = 'throw';
    const throwingClient = createClient(throwingSocket);
    await throwingClient.connect({
      identityId: guestId,
      token: 'private-token',
    });
    await vi.waitFor(() =>
      expect(useTransportStore.getState().issue?.code).toBe(
        'REALTIME_INTERRUPTED',
      ),
    );
  });
});

describe('createCommand', () => {
  it('adds and validates the v1 transport envelope', () => {
    expect(
      createCommand(
        'game.sync',
        { gameId: activeGameId, payload: {} },
        eventId,
        12,
      ),
    ).toEqual({
      eventId,
      gameId: activeGameId,
      payload: {},
      protocolVersion: 1,
      timestamp: 12,
      type: 'game.sync',
    });
    expect(() =>
      createCommand(
        'future.event' as ClientEventName,
        { payload: {} },
        eventId,
        12,
      ),
    ).toThrow('Unsupported client event');
  });
});

function createClient(socket: FakeSocket): RealtimeClient {
  return new RealtimeClient({
    clearIntervalImplementation: vi.fn(),
    createId: () => eventId,
    loadSocket: vi.fn().mockResolvedValue(socket as unknown as Socket),
    now: () => 1_000,
    setIntervalImplementation: vi.fn().mockReturnValue(17),
  });
}

function sessionReadyEvent() {
  return {
    eventId,
    payload: {
      activeGameId,
      guest: {
        avatar: 'knight_amber_01',
        expiresAt: '2099-07-28T20:00:00.000Z',
        id: guestId,
        name: 'SilentKnight482',
      },
    },
    protocolVersion: 1,
    timestamp: 1_000,
    type: 'session.ready',
  } as const;
}

function serverErrorEvent() {
  return {
    correlationId,
    eventId,
    payload: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Live service is restarting.',
      retryable: true,
    },
    protocolVersion: 1,
    timestamp: 1_000,
    type: 'server.error',
  } as const;
}

type Handler = (...arguments_: unknown[]) => void;

class FakeManager {
  private readonly handlers = new Map<string, Set<Handler>>();

  off(): void {
    this.handlers.clear();
  }

  on(name: string, handler: Handler): void {
    const handlers = this.handlers.get(name) ?? new Set();
    handlers.add(handler);
    this.handlers.set(name, handlers);
  }

  trigger(name: string, ...arguments_: unknown[]): void {
    for (const handler of this.handlers.get(name) ?? []) handler(...arguments_);
  }
}

class FakeSocket {
  ackMode: 'invalid' | 'mismatch' | 'success' | 'throw' | 'timeout' = 'success';
  active = true;
  auth: Record<string, unknown> = {};
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly manager = new FakeManager();
  readonly io = this.manager;
  private anyHandler: ((name: string, event: unknown) => void) | undefined;
  private readonly handlers = new Map<string, Set<Handler>>();

  connect(): void {
    this.connectCalls += 1;
    this.connected = true;
    this.trigger('connect');
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
    this.trigger('disconnect', 'io client disconnect');
  }

  emit(
    name: string,
    envelope: { eventId: string },
    callback: (error: Error | null, ack?: unknown) => void,
  ): void {
    if (this.ackMode === 'throw') {
      throw new Error('transport interrupted');
    }
    if (this.ackMode === 'timeout') {
      callback(new Error('timeout'));
      return;
    }
    if (this.ackMode === 'invalid') {
      callback(null, {});
      return;
    }
    const requestEventId =
      this.ackMode === 'mismatch'
        ? '55555555-5555-4555-8555-555555555555'
        : envelope.eventId;
    callback(
      null,
      name === 'heartbeat.ping'
        ? {
            correlationId,
            ok: true,
            payload: { presenceExpiresInMs: 45_000, serverTime: 1_000 },
            protocolVersion: 1,
            requestEventId,
            type: 'heartbeat.pong',
          }
        : {
            correlationId,
            ok: true,
            payload: {
              activeGameId: null,
              guest: {
                avatar: 'knight_amber_01',
                expiresAt: '2099-07-28T20:00:00.000Z',
                id: guestId,
                name: 'SilentKnight482',
              },
            },
            protocolVersion: 1,
            requestEventId,
            type: 'session.ready',
          },
    );
  }

  off(): void {
    this.handlers.clear();
  }

  offAny(): void {
    this.anyHandler = undefined;
  }

  on(name: string, handler: Handler): void {
    const handlers = this.handlers.get(name) ?? new Set();
    handlers.add(handler);
    this.handlers.set(name, handlers);
  }

  onAny(handler: (name: string, event: unknown) => void): void {
    this.anyHandler = handler;
  }

  serverEvent(name: string, event: unknown): void {
    this.anyHandler?.(name, event);
  }

  timeout(): this {
    return this;
  }

  trigger(name: string, ...arguments_: unknown[]): void {
    for (const handler of this.handlers.get(name) ?? []) handler(...arguments_);
  }
}
