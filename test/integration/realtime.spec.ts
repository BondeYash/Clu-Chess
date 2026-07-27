import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import type { Response as SuperAgentResponse } from 'superagent';
import request from 'supertest';
import {
  type Socket as ClientSocket,
  io as createSocketClient,
} from 'socket.io-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { RedisService } from '../../src/common/redis/redis.service.js';
import { BroadcastService } from '../../src/modules/realtime/broadcast.service.js';
import { configureRealtimeAdapter } from '../../src/modules/realtime/infrastructure/redis-streams-io.adapter.js';
import { RealtimeRedisService } from '../../src/modules/realtime/infrastructure/realtime-redis.service.js';
import { RealtimeProtocolService } from '../../src/modules/realtime/protocol/realtime-protocol.service.js';
import {
  realtimeAckSchema,
  serverEnvelopeSchema,
  type RealtimeAck,
  type ServerEventEnvelope,
} from '../../src/modules/realtime/protocol/protocol.schemas.js';
import { createSessionResponseSchema } from '../../src/modules/session/session.schemas.js';
import {
  allocateGame,
  createGuestSession,
  createPool,
  truncateApplicationTables,
} from './support/database.js';

const allowedOrigin = 'http://test.local';

describe('authenticated realtime gateway', () => {
  const clients = new Set<ClientSocket>();
  let appA: INestApplication;
  let appB: INestApplication;
  let pool: Pool;
  let redis: RedisService;
  let serverA: Server;
  let urlA: string;
  let urlB: string;

  beforeAll(async () => {
    pool = createPool();
    appA = await createApplication('realtime-a');
    appB = await createApplication('realtime-b');
    serverA = appA.getHttpServer() as Server;
    urlA = applicationUrl(appA);
    urlB = applicationUrl(appB);
    redis = appA.get(RedisService);
    await redis.ensureConnected();
  });

  beforeEach(async () => {
    await truncateApplicationTables(pool);
    await redis.connection.flushdb();
  });

  afterEach(() => {
    for (const client of clients) {
      client.disconnect();
    }
    clients.clear();
  });

  afterAll(async () => {
    await Promise.all([appA.close(), appB.close()]);
    await pool.end();
  });

  it('authenticates a valid JWT and exposes the durable active-game hint', async () => {
    const session = await createSession(serverA);
    const opponentId = await createGuestSession(pool);
    const game = await allocateGame(pool, {
      guestSessionIds: [session.guest.id, opponentId],
    });

    const { ready } = await connectClient(urlA, session.token);

    expect(ready).toMatchObject({
      payload: {
        activeGameId: game.gameId,
        guest: session.guest,
      },
      protocolVersion: 1,
      type: 'session.ready',
    });
    expect(ready.eventId).toMatch(uuidV4());
  });

  it('rejects malformed, forged, expired, and revoked credentials', async () => {
    const session = await createSession(serverA);
    const malformed = await connectionFailure(urlA, 'not-a-jwt');
    const forged = await connectionFailure(urlA, forge(session.token));
    const expired = await connectionFailure(urlA, expiredToken(session.token));

    expect([malformed.code, forged.code, expired.code]).toEqual([
      'UNAUTHORIZED',
      'UNAUTHORIZED',
      'UNAUTHORIZED',
    ]);

    const live = await connectClient(urlB, session.token);
    const disconnected = new Promise<void>((resolve) => {
      live.socket.once('disconnect', () => {
        resolve();
      });
    });
    await request(serverA)
      .post('/v1/session/reset')
      .set('Authorization', `Bearer ${session.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);
    await expect(disconnected).resolves.toBeUndefined();
    const revoked = await connectionFailure(urlA, session.token);
    expect(revoked).toMatchObject({
      code: 'UNAUTHORIZED',
      retryable: false,
    });
  });

  it('enforces exact origins and the distributed per-address connection cap', async () => {
    const rejectedOrigin = await connectionFailure(
      urlA,
      (await createSession(serverA)).token,
      'http://evil.test',
    );
    expect(rejectedOrigin.message.length).toBeGreaterThan(0);

    const sessions = await Promise.all([
      createSession(serverA),
      createSession(serverA),
      createSession(serverA),
    ]);
    await connectClient(urlA, sessions[0].token);
    await connectClient(urlB, sessions[1].token);
    const limited = await connectionFailure(urlA, sessions[2].token);

    expect(limited).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('returns correlated heartbeat acks and rejects invalid commands safely', async () => {
    const session = await createSession(serverA);
    const { socket } = await connectClient(urlA, session.token);
    const eventId = randomUUID();
    const correlationId = randomUUID();
    const heartbeat = await emitWithAck(
      socket,
      'heartbeat.ping',
      envelope('heartbeat.ping', {
        correlationId,
        eventId,
        payload: { lastKnownGameVersion: 3 },
      }),
    );

    expect(heartbeat).toMatchObject({
      correlationId,
      ok: true,
      payload: {
        presenceExpiresInMs: 45_000,
      },
      requestEventId: eventId,
      type: 'heartbeat.pong',
    });
    if (!heartbeat.ok || heartbeat.type !== 'heartbeat.pong') {
      throw new Error('Heartbeat did not return a pong acknowledgement');
    }
    expect(typeof heartbeat.payload.serverTime).toBe('number');

    const mismatch = await emitWithAck(
      socket,
      'game.sync',
      envelope('heartbeat.ping', {}),
    );
    expect(mismatch).toMatchObject({
      error: { code: 'INVALID_PAYLOAD', retryable: false },
      ok: false,
    });

    const unsupported = await emitWithAck(
      socket,
      'not.supported',
      envelope('not.supported', {}),
    );
    expect(unsupported).toMatchObject({
      error: { code: 'UNSUPPORTED_EVENT' },
      ok: false,
    });

    const wrongVersion = await emitWithAck(socket, 'game.sync', {
      ...envelope('game.sync', {}),
      protocolVersion: 2,
    });
    expect(wrongVersion).toMatchObject({
      error: { code: 'UNSUPPORTED_PROTOCOL_VERSION' },
      ok: false,
    });

    const missingAckError = waitForServerEvent(socket, 'server.error');
    socket.emit('game.sync', envelope('game.sync', {}));
    expect(await missingAckError).toMatchObject({
      payload: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('disconnects an oversized client message before command handling', async () => {
    const { socket } = await connectClient(
      urlA,
      (await createSession(serverA)).token,
    );
    const disconnected = new Promise<void>((resolve) => {
      socket.once('disconnect', () => {
        resolve();
      });
    });

    socket.emit(
      'game.sync',
      envelope('game.sync', { payload: { junk: 'x'.repeat(9000) } }),
      () => undefined,
    );

    await expect(disconnected).resolves.toBeUndefined();
  });

  it('tracks multiple tabs and broadcasts personal events across instances', async () => {
    const session = await createSession(serverA);
    const first = await connectClient(urlA, session.token);
    const second = await connectClient(urlB, session.token);
    const presenceKey = `presence:${session.guest.id}`;

    await eventually(async () => {
      expect(await redis.connection.zcard(presenceKey)).toBe(2);
    });

    const protocol = appA.get(RealtimeProtocolService);
    const event = protocol.createServerEvent({
      payload: {
        presenceExpiresInMs: 45_000,
        serverTime: Date.now(),
      },
      type: 'heartbeat.pong',
    });
    const receivedByFirst = waitForServerEvent(first.socket, event.type);
    const receivedBySecond = waitForServerEvent(second.socket, event.type);
    appA.get(BroadcastService).toGuest(session.guest.id, event);

    expect((await receivedByFirst).eventId).toBe(event.eventId);
    expect((await receivedBySecond).eventId).toBe(event.eventId);

    first.socket.disconnect();
    await eventually(async () => {
      expect(await redis.connection.zcard(presenceKey)).toBe(1);
    });
    second.socket.disconnect();
    await eventually(async () => {
      expect(await redis.connection.exists(presenceKey)).toBe(0);
    });
  });

  it('matches guests across instances and persists idempotent room readiness', async () => {
    const sessionA = await createSession(serverA);
    const sessionB = await createSession(appB.getHttpServer() as Server);
    const clientA = await connectClient(urlA, sessionA.token);
    const clientB = await connectClient(urlB, sessionB.token);

    const firstJoin = await emitWithAck(
      clientA.socket,
      'queue.join',
      envelope('queue.join', { payload: { mode: 'blitz' } }),
    );
    const duplicateJoin = await emitWithAck(
      clientA.socket,
      'queue.join',
      envelope('queue.join', { payload: { mode: 'blitz' } }),
    );
    expect(firstJoin).toMatchObject({
      ok: true,
      payload: { mode: 'blitz', position: 1 },
      type: 'queue.joined',
    });
    expect(duplicateJoin).toMatchObject({
      ok: true,
      payload: {
        mode: 'blitz',
        position: 1,
        since:
          firstJoin.ok && firstJoin.type === 'queue.joined'
            ? firstJoin.payload.since
            : undefined,
      },
      type: 'queue.joined',
    });

    const matchForA = waitForServerEvent(clientA.socket, 'match.found');
    const matchForB = waitForServerEvent(clientB.socket, 'match.found');
    const leftForA = waitForServerEvent(clientA.socket, 'queue.left');
    const leftForB = waitForServerEvent(clientB.socket, 'queue.left');
    const secondJoin = await emitWithAck(
      clientB.socket,
      'queue.join',
      envelope('queue.join', { payload: { mode: 'blitz' } }),
    );
    expect(secondJoin).toMatchObject({
      ok: true,
      payload: { mode: 'blitz', position: 2 },
      type: 'queue.joined',
    });

    const [foundA, foundB] = await Promise.all([matchForA, matchForB]);
    expect(await leftForA).toMatchObject({
      payload: { mode: 'blitz', reason: 'matched' },
    });
    expect(await leftForB).toMatchObject({
      payload: { mode: 'blitz', reason: 'matched' },
    });
    if (foundA.type !== 'match.found' || foundB.type !== 'match.found') {
      throw new Error('Matchmaking did not publish match.found');
    }
    expect(foundA.gameId).toBe(foundB.gameId);
    expect([foundA.payload.color, foundB.payload.color].sort()).toEqual([
      'black',
      'white',
    ]);
    expect(foundA.payload.opponent.name).toBe(sessionB.guest.name);
    expect(foundB.payload.opponent.name).toBe(sessionA.guest.name);

    const persisted = await pool.query<{
      assignments: number;
      colors: string[];
      players: number;
      status: string;
      version: number;
    }>(
      `
        SELECT
          game.status,
          game.version,
          count(DISTINCT player.id)::int AS players,
          count(DISTINCT assignment.guest_session_id)::int AS assignments,
          array_agg(DISTINCT player.color ORDER BY player.color) AS colors
        FROM games AS game
        JOIN game_players AS player ON player.game_id = game.id
        JOIN active_game_assignments AS assignment
          ON assignment.game_id = game.id
        WHERE game.id = $1
        GROUP BY game.id
      `,
      [foundA.gameId],
    );
    expect(persisted.rows).toEqual([
      {
        assignments: 2,
        colors: ['b', 'w'],
        players: 2,
        status: 'WAITING_FOR_PLAYERS',
        version: 0,
      },
    ]);

    const readyA = await emitWithAck(
      clientA.socket,
      'game.ready',
      envelope('game.ready', {
        gameId: foundA.gameId,
        gameVersion: foundA.gameVersion,
      }),
    );
    expect(readyA).toMatchObject({
      gameVersion: 0,
      ok: true,
      payload: { status: 'WAITING_FOR_PLAYERS' },
      type: 'game.snapshot',
    });

    const startedForA = waitForServerEvent(clientA.socket, 'game.started');
    const startedForB = waitForServerEvent(clientB.socket, 'game.started');
    const readyB = await emitWithAck(
      clientB.socket,
      'game.ready',
      envelope('game.ready', {
        gameId: foundB.gameId,
        gameVersion: foundB.gameVersion,
      }),
    );
    expect(readyB).toMatchObject({
      gameVersion: 2,
      ok: true,
      payload: { status: 'IN_PROGRESS' },
      type: 'game.snapshot',
    });
    expect(await startedForA).toMatchObject({
      gameId: foundA.gameId,
      gameVersion: 2,
      payload: { clocks: { running: 'white' }, turn: 'white' },
      type: 'game.started',
    });
    expect(await startedForB).toMatchObject({
      gameId: foundA.gameId,
      gameVersion: 2,
      payload: { clocks: { running: 'white' }, turn: 'white' },
      type: 'game.started',
    });

    const repeatedReady = await emitWithAck(
      clientA.socket,
      'game.ready',
      envelope('game.ready', {
        gameId: foundA.gameId,
        gameVersion: foundA.gameVersion,
      }),
    );
    expect(repeatedReady).toMatchObject({
      gameVersion: 2,
      ok: true,
      payload: { status: 'IN_PROGRESS' },
      type: 'game.snapshot',
    });

    const readyRows = await pool.query<{
      joinedPlayers: number;
      status: string;
      version: number;
    }>(
      `
        SELECT
          game.status,
          game.version,
          count(player.joined_at)::int AS "joinedPlayers"
        FROM games AS game
        JOIN game_players AS player ON player.game_id = game.id
        WHERE game.id = $1
        GROUP BY game.id
      `,
      [foundA.gameId],
    );
    expect(readyRows.rows).toEqual([
      { joinedPlayers: 2, status: 'IN_PROGRESS', version: 2 },
    ]);

    await redis.connection.flushdb();
    const rejectedRejoin = await emitWithAck(
      clientA.socket,
      'queue.join',
      envelope('queue.join', { payload: { mode: 'blitz' } }),
    );
    expect(rejectedRejoin).toMatchObject({
      error: { code: 'ALREADY_IN_GAME', retryable: false },
      ok: false,
    });
  });

  it('broadcasts committed moves and a deterministic checkmate across instances', async () => {
    const whiteSession = await createSession(serverA);
    const blackSession = await createSession(appB.getHttpServer() as Server);
    const allocated = await allocateGame(pool, {
      guestSessionIds: [whiteSession.guest.id, blackSession.guest.id],
    });
    await pool.query(
      `
        UPDATE games
        SET
          status = 'WAITING_FOR_PLAYERS',
          join_deadline_at = clock_timestamp() + interval '20 seconds'
        WHERE id = $1
      `,
      [allocated.gameId],
    );
    const white = await connectClient(urlA, whiteSession.token);
    const black = await connectClient(urlB, blackSession.token);

    await emitWithAck(
      white.socket,
      'game.ready',
      envelope('game.ready', {
        gameId: allocated.gameId,
        gameVersion: 0,
      }),
    );
    const startedForWhite = waitForServerEvent(white.socket, 'game.started');
    const startedForBlack = waitForServerEvent(black.socket, 'game.started');
    const blackReady = await emitWithAck(
      black.socket,
      'game.ready',
      envelope('game.ready', {
        gameId: allocated.gameId,
        gameVersion: 0,
      }),
    );
    expect(blackReady).toMatchObject({
      gameVersion: 2,
      payload: { status: 'IN_PROGRESS' },
      type: 'game.snapshot',
    });
    await Promise.all([startedForWhite, startedForBlack]);

    const sequence = [
      { from: 'e2', socket: white.socket, to: 'e4', watcher: black.socket },
      { from: 'e7', socket: black.socket, to: 'e5', watcher: white.socket },
      { from: 'd1', socket: white.socket, to: 'h5', watcher: black.socket },
      { from: 'b8', socket: black.socket, to: 'c6', watcher: white.socket },
      { from: 'f1', socket: white.socket, to: 'c4', watcher: black.socket },
      { from: 'g8', socket: black.socket, to: 'f6', watcher: white.socket },
      { from: 'h5', socket: white.socket, to: 'f7', watcher: black.socket },
    ] as const;
    let finalEnvelope: Record<string, unknown> | undefined;
    let finalAck: RealtimeAck | undefined;
    let endedForWhite: Promise<ServerEventEnvelope> | undefined;
    let endedForBlack: Promise<ServerEventEnvelope> | undefined;

    for (const [index, move] of sequence.entries()) {
      const clientMoveId = randomUUID();
      const command = envelope('move.submit', {
        clientMoveId,
        gameId: allocated.gameId,
        gameVersion: index + 2,
        payload: { from: move.from, to: move.to },
      });
      const received = waitForMatchingServerEvent(
        move.watcher,
        'move.accepted',
        (serverEvent) =>
          serverEvent.type === 'move.accepted' &&
          serverEvent.clientMoveId === clientMoveId,
      );
      if (index === sequence.length - 1) {
        endedForWhite = waitForServerEvent(white.socket, 'game.ended');
        endedForBlack = waitForServerEvent(black.socket, 'game.ended');
      }
      const ack = await emitWithAck(move.socket, 'move.submit', command);
      expect(ack).toMatchObject({
        gameVersion: index + 3,
        ok: true,
        payload: {
          ply: index + 1,
          uci: `${move.from}${move.to}`,
        },
        type: 'move.accepted',
      });
      expect(await received).toMatchObject({
        clientMoveId,
        gameId: allocated.gameId,
        gameVersion: index + 3,
        payload: { ply: index + 1, uci: `${move.from}${move.to}` },
        type: 'move.accepted',
      });
      finalEnvelope = command;
      finalAck = ack;
    }

    if (endedForWhite === undefined || endedForBlack === undefined) {
      throw new Error('The checkmate event listeners were not registered');
    }
    expect(await endedForWhite).toMatchObject({
      gameId: allocated.gameId,
      gameVersion: 9,
      payload: { result: 'white_win', termination: 'checkmate' },
      type: 'game.ended',
    });
    expect(await endedForBlack).toMatchObject({
      gameId: allocated.gameId,
      gameVersion: 9,
      payload: { result: 'white_win', termination: 'checkmate' },
      type: 'game.ended',
    });
    if (finalEnvelope === undefined || finalAck === undefined) {
      throw new Error('The checkmate command was not submitted');
    }
    const replay = await emitWithAck(
      white.socket,
      'move.submit',
      finalEnvelope,
    );
    expect(replay).toMatchObject({
      gameVersion: 9,
      payload:
        finalAck.ok && finalAck.type === 'move.accepted'
          ? finalAck.payload
          : undefined,
      type: 'move.accepted',
    });

    const postTerminal = await emitWithAck(
      black.socket,
      'move.submit',
      envelope('move.submit', {
        clientMoveId: randomUUID(),
        gameId: allocated.gameId,
        gameVersion: 9,
        payload: { from: 'a7', to: 'a6' },
      }),
    );
    expect(postTerminal).toMatchObject({
      error: {
        authoritativeVersion: 9,
        code: 'GAME_ALREADY_ENDED',
        retryable: false,
      },
      gameVersion: 9,
      ok: false,
      type: 'move.rejected',
    });

    const sync = await emitWithAck(
      black.socket,
      'game.sync',
      envelope('game.sync', { gameId: allocated.gameId, gameVersion: 9 }),
    );
    expect(sync).toMatchObject({
      gameVersion: 9,
      payload: {
        clocks: { running: null },
        moves: sequence.map((move, index) => ({
          ply: index + 1,
          uci: `${move.from}${move.to}`,
        })),
        result: 'white_win',
        status: 'COMPLETED',
        termination: 'checkmate',
      },
      type: 'game.snapshot',
    });

    const audit = await pool.query<{
      assignments: number;
      commands: number;
      moves: number;
      version: number;
    }>(
      `
        SELECT
          game.version,
          count(DISTINCT move.id)::int AS moves,
          count(DISTINCT command.id)::int AS commands,
          count(DISTINCT assignment.guest_session_id)::int AS assignments
        FROM games AS game
        LEFT JOIN moves AS move ON move.game_id = game.id
        LEFT JOIN game_commands AS command ON command.game_id = game.id
        LEFT JOIN active_game_assignments AS assignment
          ON assignment.game_id = game.id
        WHERE game.id = $1
        GROUP BY game.id
      `,
      [allocated.gameId],
    );
    expect(audit.rows).toEqual([
      { assignments: 0, commands: 7, moves: 7, version: 9 },
    ]);
  });

  it('returns session.ready when an unscoped sync has no active game', async () => {
    const { socket } = await connectClient(
      urlA,
      (await createSession(serverA)).token,
    );
    const result = await emitWithAck(
      socket,
      'game.sync',
      envelope('game.sync', {}),
    );

    expect(result).toMatchObject({
      ok: true,
      payload: { activeGameId: null },
      type: 'session.ready',
    });
  });

  it('keeps same-instance delivery usable while the adapter is degraded', async () => {
    const session = await createSession(serverA);
    const { socket } = await connectClient(urlA, session.token);
    const realtimeRedis = appA.get(RealtimeRedisService);
    realtimeRedis.connection.disconnect(false);
    await eventually(() => {
      expect(realtimeRedis.isReady).toBe(false);
      return Promise.resolve();
    });

    const event = appA.get(RealtimeProtocolService).createServerEvent({
      payload: {
        presenceExpiresInMs: 45_000,
        serverTime: Date.now(),
      },
      type: 'heartbeat.pong',
    });
    const received = waitForServerEvent(socket, event.type);
    appA.get(BroadcastService).toGuest(session.guest.id, event);
    expect((await received).eventId).toBe(event.eventId);

    await realtimeRedis.ensureConnected();
    expect(realtimeRedis.isReady).toBe(true);
  });

  async function connectClient(
    url: string,
    token: string,
  ): Promise<{ ready: ServerEventEnvelope; socket: ClientSocket }> {
    const socket = socketClient(url, token, allowedOrigin);
    clients.add(socket);
    const ready = waitForServerEvent(socket, 'session.ready');
    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.connect();
    await connected;
    return { ready: await ready, socket };
  }
});

interface ConnectionFailure {
  code?: string;
  message: string;
  retryable?: boolean;
}

async function createApplication(
  instanceId: string,
): Promise<INestApplication> {
  process.env.INSTANCE_ID = instanceId;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1', {
    exclude: [
      { method: RequestMethod.ALL, path: 'healthz' },
      { method: RequestMethod.ALL, path: 'readyz' },
    ],
  });
  await configureRealtimeAdapter(app);
  await app.listen(0, '127.0.0.1');
  return app;
}

function applicationUrl(app: INestApplication): string {
  const address = (app.getHttpServer() as Server).address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

async function createSession(
  server: Server,
): Promise<ReturnType<typeof createSessionResponseSchema.parse>> {
  const response = await request(server)
    .post('/v1/session')
    .set('Idempotency-Key', randomUUID())
    .send({})
    .expect(201);
  return createSessionResponseSchema.parse(responseBody(response));
}

function responseBody(response: SuperAgentResponse): unknown {
  return response.body as unknown;
}

function socketClient(
  url: string,
  token: string,
  origin: string,
): ClientSocket {
  return createSocketClient(url, {
    auth: { token },
    autoConnect: false,
    extraHeaders: { Origin: origin },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
}

async function connectionFailure(
  url: string,
  token: string,
  origin = allowedOrigin,
): Promise<ConnectionFailure> {
  const socket = socketClient(url, token, origin);
  try {
    return await new Promise<ConnectionFailure>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Expected connection to fail'));
      }, 3000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        reject(new Error('Unexpected socket connection'));
      });
      socket.once('connect_error', (error: Error & { data?: unknown }) => {
        clearTimeout(timeout);
        const data =
          typeof error.data === 'object' && error.data !== null
            ? (error.data as Record<string, unknown>)
            : {};
        resolve({
          ...(typeof data.code === 'string' ? { code: data.code } : {}),
          message: error.message,
          ...(typeof data.retryable === 'boolean'
            ? { retryable: data.retryable }
            : {}),
        });
      });
      socket.connect();
    });
  } finally {
    socket.disconnect();
  }
}

function envelope(
  type: string,
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    payload: {},
    protocolVersion: 1,
    timestamp: Date.now(),
    type,
    ...overrides,
  };
}

async function emitWithAck(
  socket: ClientSocket,
  eventName: string,
  event: unknown,
): Promise<RealtimeAck> {
  return new Promise<RealtimeAck>((resolve, reject) => {
    socket
      .timeout(3000)
      .emit(eventName, event, (error: Error | null, ack: unknown) => {
        if (error !== null) {
          reject(error);
          return;
        }
        try {
          resolve(realtimeAckSchema.parse(ack));
        } catch (parseError) {
          reject(asError(parseError));
        }
      });
  });
}

function waitForServerEvent(
  socket: ClientSocket,
  eventName: string,
): Promise<ServerEventEnvelope> {
  return new Promise<ServerEventEnvelope>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, 5000);
    socket.once(eventName, (event: unknown) => {
      clearTimeout(timeout);
      try {
        resolve(serverEnvelopeSchema.parse(event));
      } catch (error) {
        reject(asError(error));
      }
    });
  });
}

function waitForMatchingServerEvent(
  socket: ClientSocket,
  eventName: string,
  matches: (event: ServerEventEnvelope) => boolean,
): Promise<ServerEventEnvelope> {
  return new Promise<ServerEventEnvelope>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for matching ${eventName}`));
    }, 5000);
    const handler = (event: unknown): void => {
      try {
        const parsed = serverEnvelopeSchema.parse(event);
        if (!matches(parsed)) {
          return;
        }
        clearTimeout(timeout);
        socket.off(eventName, handler);
        resolve(parsed);
      } catch (error) {
        clearTimeout(timeout);
        socket.off(eventName, handler);
        reject(asError(error));
      }
    };
    socket.on(eventName, handler);
  });
}

function forge(token: string): string {
  const [encodedHeader, encodedClaims, encodedSignature, extraSegment] =
    token.split('.');
  if (
    encodedHeader === undefined ||
    encodedClaims === undefined ||
    encodedSignature === undefined ||
    extraSegment !== undefined
  ) {
    throw new Error('Cannot forge malformed token');
  }
  const signature = Buffer.from(encodedSignature, 'base64url');
  const firstByte = signature[0];
  if (firstByte === undefined) {
    throw new Error('Cannot forge empty token signature');
  }
  signature[0] = firstByte ^ 1;
  return `${encodedHeader}.${encodedClaims}.${signature.toString('base64url')}`;
}

function expiredToken(token: string): string {
  const [encodedHeader, encodedClaims] = token.split('.');
  if (encodedHeader === undefined || encodedClaims === undefined) {
    throw new Error('Cannot expire malformed token');
  }
  const claims = JSON.parse(
    Buffer.from(encodedClaims, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  const expiry = Math.floor(Date.now() / 1000) - 60;
  const expiredClaims = {
    ...claims,
    exp: expiry,
    iat: expiry - 43_200,
    jti: randomUUID(),
  };
  const encodedExpiredClaims = Buffer.from(
    JSON.stringify(expiredClaims),
  ).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedExpiredClaims}`;
  const signature = sign(
    null,
    Buffer.from(signingInput),
    readFileSync(requiredEnvironment('JWT_PRIVATE_KEY_FILE')),
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} was not configured`);
  }
  return value;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Unexpected test failure');
}

function uuidV4(): RegExp {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
}

async function eventually(action: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  throw lastError;
}
