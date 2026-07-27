import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { io as createSocketClient } from 'socket.io-client';

const baseUrl = process.env.MULTI_BASE_URL ?? 'https://localhost:3443';
const origin = process.env.MULTI_ORIGIN ?? 'https://localhost:3443';
const sockets = new Set();

try {
  await verifyHealthEndpoints();
  const sessions = await createSessionsAcrossReplicas();
  const [sessionA, sessionB, sessionC] = sessions;

  await verifySessionRead(sessionA);
  await verifySessionRead(sessionB);
  await verifySessionRenew(sessionA);
  await verifyNoActiveGame(sessionA);

  const clientC = await connect(sessionC);
  await verifyHeartbeat(clientC);
  await verifyQueueLeave(clientC);

  const clientA = await connect(sessionA);
  const clientB = await connect(sessionB);
  assert.notEqual(
    sessionA.upstream,
    sessionB.upstream,
    'gameplay clients must be pinned to different app replicas',
  );
  const game = await matchAndStart(clientA, clientB);
  await verifyActiveGame(sessionA, game.id);
  await verifySnapshot(sessionA, game.id, 2);
  const movedVersion = await submitMove(game, clientA, clientB);
  await verifySocketSync(game, clientA, clientB, movedVersion);
  await verifySnapshot(sessionB, game.id, movedVersion);
  await resign(game, clientA, clientB, movedVersion);
  await resetSession(sessionC, clientC);
  await verifyMetricsBoundary();
  process.stdout.write(
    'Multi-instance HTTP, WSS, matchmaking, gameplay, recovery, and reset smoke passed\n',
  );
} finally {
  for (const socket of sockets) {
    socket.disconnect();
  }
}

async function verifyHealthEndpoints() {
  const live = await api('/healthz');
  assert.equal(live.response.status, 200);
  assert.equal(live.body.status, 'ok');
  const ready = await api('/readyz');
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.status, 'ok');
  assert.equal(ready.body.deps.db.status, 'up');
  assert.equal(ready.body.deps.redis.status, 'up');
}

async function createSessionsAcrossReplicas() {
  const candidates = [];
  const byUpstream = new Map();
  for (let index = 0; index < 8 && byUpstream.size < 2; index += 1) {
    const idempotencyKey = randomUUID();
    const created = await api('/v1/session', {
      body: {},
      headers: { 'Idempotency-Key': idempotencyKey },
      method: 'POST',
    });
    assert.equal(created.response.status, 201);
    assert.equal(typeof created.body.token, 'string');
    assert.equal(typeof created.body.guest?.id, 'string');
    const candidate = {
      cookie: cookiesFrom(created.response),
      guest: created.body.guest,
      token: created.body.token,
      upstream: requiredHeader(created.response, 'x-cluchess-upstream'),
    };
    candidates.push(candidate);
    byUpstream.set(candidate.upstream, candidate);

    if (index === 0) {
      const replay = await api('/v1/session', {
        body: {},
        cookie: candidate.cookie,
        headers: { 'Idempotency-Key': idempotencyKey },
        method: 'POST',
      });
      assert.equal(replay.response.status, 200);
      assert.equal(replay.body.token, candidate.token);
    }
  }
  assert.equal(byUpstream.size, 2, 'both app replicas must receive traffic');

  const [first, second] = [...byUpstream.values()];
  const third =
    candidates.find(
      (candidate) =>
        candidate.guest.id !== first.guest.id &&
        candidate.guest.id !== second.guest.id,
    ) ?? (await createSession());
  return [first, second, third];
}

async function createSession() {
  const created = await api('/v1/session', {
    body: {},
    headers: { 'Idempotency-Key': randomUUID() },
    method: 'POST',
  });
  assert.equal(created.response.status, 201);
  return {
    cookie: cookiesFrom(created.response),
    guest: created.body.guest,
    token: created.body.token,
    upstream: requiredHeader(created.response, 'x-cluchess-upstream'),
  };
}

async function verifySessionRead(session) {
  const current = await authorizedApi('/v1/session', session);
  assert.equal(current.response.status, 200);
  assert.equal(current.body.guest.id, session.guest.id);
  assert.equal(
    requiredHeader(current.response, 'x-cluchess-upstream'),
    session.upstream,
  );
}

async function verifySessionRenew(session) {
  const renewed = await authorizedApi('/v1/session/renew', session, {
    body: {},
    headers: { 'Idempotency-Key': randomUUID() },
    method: 'POST',
  });
  assert.equal(renewed.response.status, 200);
  assert.equal(typeof renewed.body.token, 'string');
  session.token = renewed.body.token;
  session.cookie = mergeCookies(session.cookie, cookiesFrom(renewed.response));
}

async function verifyNoActiveGame(session) {
  const active = await authorizedApi('/v1/games/active', session);
  assert.equal(active.response.status, 200);
  assert.equal(active.body.gameId, null);
}

async function connect(session) {
  const socket = createSocketClient(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: {
      Cookie: session.cookie,
      Origin: origin,
    },
    forceNew: true,
    reconnection: false,
    rejectUnauthorized: false,
    transports: ['websocket'],
  });
  sockets.add(socket);
  const ready = waitForEvent(socket, 'session.ready');
  const connected = new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  socket.connect();
  await connected;
  const readyEvent = await ready;
  assert.equal(readyEvent.payload.guest.id, session.guest.id);
  return { session, socket };
}

async function verifyHeartbeat(client) {
  const ack = await emitWithAck(
    client.socket,
    'heartbeat.ping',
    envelope('heartbeat.ping', {
      payload: { lastKnownGameVersion: 0 },
    }),
  );
  assert.equal(ack.ok, true);
  assert.equal(ack.type, 'heartbeat.pong');
}

async function verifyQueueLeave(client) {
  const joined = await emitWithAck(
    client.socket,
    'queue.join',
    envelope('queue.join', { payload: { mode: 'blitz' } }),
  );
  assert.equal(joined.ok, true);
  assert.equal(joined.type, 'queue.joined');
  const left = await emitWithAck(
    client.socket,
    'queue.leave',
    envelope('queue.leave', { payload: { mode: 'blitz' } }),
  );
  assert.equal(left.ok, true);
  assert.equal(left.type, 'queue.left');
  assert.equal(left.payload.reason, 'requested');
}

async function matchAndStart(clientA, clientB) {
  const joinedA = await emitWithAck(
    clientA.socket,
    'queue.join',
    envelope('queue.join', { payload: { mode: 'blitz' } }),
  );
  assert.equal(joinedA.ok, true);
  const foundA = waitForEvent(clientA.socket, 'match.found');
  const foundB = waitForEvent(clientB.socket, 'match.found');
  const joinedB = await emitWithAck(
    clientB.socket,
    'queue.join',
    envelope('queue.join', { payload: { mode: 'blitz' } }),
  );
  assert.equal(joinedB.ok, true);
  const [matchA, matchB] = await Promise.all([foundA, foundB]);
  assert.equal(matchA.gameId, matchB.gameId);

  const readyA = await emitWithAck(
    clientA.socket,
    'game.ready',
    envelope('game.ready', {
      gameId: matchA.gameId,
      gameVersion: matchA.gameVersion,
    }),
  );
  assert.equal(readyA.ok, true);
  const startedA = waitForEvent(clientA.socket, 'game.started');
  const startedB = waitForEvent(clientB.socket, 'game.started');
  const readyB = await emitWithAck(
    clientB.socket,
    'game.ready',
    envelope('game.ready', {
      gameId: matchB.gameId,
      gameVersion: matchB.gameVersion,
    }),
  );
  assert.equal(readyB.ok, true);
  await Promise.all([startedA, startedB]);
  return {
    colorA: matchA.payload.color,
    colorB: matchB.payload.color,
    id: matchA.gameId,
  };
}

async function verifyActiveGame(session, gameId) {
  const active = await authorizedApi('/v1/games/active', session);
  assert.equal(active.response.status, 200);
  assert.equal(active.body.gameId, gameId);
}

async function verifySnapshot(session, gameId, version) {
  const snapshot = await authorizedApi(
    `/v1/games/${encodeURIComponent(gameId)}/snapshot`,
    session,
  );
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.body.gameId, gameId);
  assert.equal(snapshot.body.gameVersion, version);
  return snapshot.body;
}

async function submitMove(game, clientA, clientB) {
  const white = game.colorA === 'white' ? clientA : clientB;
  const black = game.colorA === 'black' ? clientA : clientB;
  const clientMoveId = randomUUID();
  const acceptedByOpponent = waitForEvent(
    black.socket,
    'move.accepted',
    (event) => event.clientMoveId === clientMoveId,
  );
  const accepted = await emitWithAck(
    white.socket,
    'move.submit',
    envelope('move.submit', {
      clientMoveId,
      gameId: game.id,
      gameVersion: 2,
      payload: { from: 'e2', to: 'e4' },
    }),
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.type, 'move.accepted');
  assert.equal(accepted.gameVersion, 3);
  assert.equal((await acceptedByOpponent).payload.uci, 'e2e4');
  return 3;
}

async function verifySocketSync(game, clientA, clientB, version) {
  const client = game.colorA === 'black' ? clientA : clientB;
  const synced = await emitWithAck(
    client.socket,
    'game.sync',
    envelope('game.sync', {
      gameId: game.id,
      gameVersion: version,
    }),
  );
  assert.equal(synced.ok, true);
  assert.equal(synced.type, 'game.snapshot');
  assert.equal(synced.gameVersion, version);
  assert.equal(synced.payload.moves.at(-1).uci, 'e2e4');
}

async function resign(game, clientA, clientB, version) {
  const resigning = game.colorA === 'black' ? clientA : clientB;
  const observer = game.colorA === 'white' ? clientA : clientB;
  const ended = waitForEvent(observer.socket, 'game.ended');
  const accepted = await emitWithAck(
    resigning.socket,
    'game.resign',
    envelope('game.resign', {
      gameId: game.id,
      gameVersion: version,
    }),
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.type, 'game.ended');
  assert.equal(accepted.payload.termination, 'resignation');
  assert.equal((await ended).payload.termination, 'resignation');
}

async function resetSession(session, client) {
  const disconnected = new Promise((resolve) => {
    client.socket.once('disconnect', resolve);
  });
  const reset = await authorizedApi('/v1/session/reset', session, {
    body: {},
    headers: { 'Idempotency-Key': randomUUID() },
    method: 'POST',
  });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.body.ok, true);
  await disconnected;
}

async function verifyMetricsBoundary() {
  const metrics = await api('/metrics', { parseJson: false });
  assert.equal(metrics.response.status, 404);
}

async function authorizedApi(path, session, options = {}) {
  return api(path, {
    ...options,
    cookie: session.cookie,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session.token}`,
    },
  });
}

async function api(
  path,
  { body, cookie, headers = {}, method = 'GET', parseJson = true } = {},
) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie === undefined ? {} : { Cookie: cookie }),
      ...headers,
    },
    method,
  });
  const responseBody = parseJson
    ? await response.json()
    : await response.text();
  return { body: responseBody, response };
}

function cookiesFrom(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

function mergeCookies(current, updates) {
  const merged = new Map();
  for (const source of [current, updates]) {
    for (const pair of source.split(';')) {
      const normalized = pair.trim();
      if (normalized.length === 0) {
        continue;
      }
      const separator = normalized.indexOf('=');
      merged.set(
        normalized.slice(0, separator),
        normalized.slice(separator + 1),
      );
    }
  }
  return [...merged.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function requiredHeader(response, name) {
  const value = response.headers.get(name);
  assert.ok(value, `response header ${name} is required`);
  return value;
}

function envelope(type, overrides = {}) {
  return {
    eventId: randomUUID(),
    payload: {},
    protocolVersion: 1,
    timestamp: Date.now(),
    type,
    ...overrides,
  };
}

async function emitWithAck(socket, eventName, event) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(eventName, event, (error, acknowledgment) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(acknowledgment);
    });
  });
}

async function waitForEvent(socket, eventName, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, 10_000);
    const listener = (event) => {
      if (!predicate(event)) {
        return;
      }
      clearTimeout(timeout);
      socket.off(eventName, listener);
      resolve(event);
    };
    socket.on(eventName, listener);
  });
}
