import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { io as createSocketClient } from 'socket.io-client';

const baseUrl = process.env.LOAD_BASE_URL ?? 'https://nginx';
const origin = process.env.LOAD_ORIGIN ?? 'https://localhost:3543';
const profileName = process.env.LOAD_PROFILE ?? 'smoke';
const matchTimeoutMs = Number(process.env.LOAD_MATCH_TIMEOUT_MS ?? 60_000);
const profileHoldMs = {
  burst: 0,
  smoke: 0,
  soak: 3_600_000,
  stress: 900_000,
  target: 900_000,
}[profileName];
const holdMs = Number(process.env.LOAD_HOLD_MS ?? profileHoldMs ?? 0);

const opening = [
  { from: 'e2', to: 'e4' },
  { from: 'e7', to: 'e5' },
  { from: 'g1', to: 'f3' },
  { from: 'b8', to: 'c6' },
  { from: 'f1', to: 'b5' },
  { from: 'a7', to: 'a6' },
];
const foolsMate = [
  { from: 'f2', to: 'f3' },
  { from: 'e7', to: 'e5' },
  { from: 'g2', to: 'g4' },
  { from: 'd8', to: 'h4' },
];

export async function runGameUser(context, events) {
  const startedAt = Date.now();
  const client = await bootstrapClient(events);
  try {
    const match = await joinAndMatch(client, events);
    await runMatchedGame(client, match, events);
    await holdConnected(client, Math.max(0, holdMs - (Date.now() - startedAt)));
  } finally {
    client.socket.disconnect();
  }
}

export async function runQueueChurnUser(context, events) {
  const startedAt = Date.now();
  const client = await bootstrapClient(events);
  try {
    let matched = waitForEvent(client.socket, 'match.found', {
      timeoutMs: 2500,
    }).catch(() => null);
    const joined = await emitWithAck(
      client.socket,
      'queue.join',
      envelope('queue.join', { payload: { mode: 'blitz' } }),
    );
    assertAck(joined, 'queue.joined');
    events.emit('counter', 'queue_churn_joined', 1);
    const randomizedWaitMs = 25 + stablePercent(client.session.guest.id, 475);
    const winner = await Promise.race([
      matched.then((event) => ({ event, kind: 'matched' })),
      delay(randomizedWaitMs).then(() => ({ kind: 'leave' })),
    ]);
    if (winner.kind === 'matched' && winner.event !== null) {
      events.emit('counter', 'queue_churn_matched', 1);
      await runMatchedGame(client, winner.event, events);
    } else {
      const left = await emitWithAck(
        client.socket,
        'queue.leave',
        envelope('queue.leave', { payload: { mode: 'blitz' } }),
      );
      assertAck(left, 'queue.left');
      events.emit('counter', 'queue_churn_left', 1);

      // Churn is an intentional leave/rejoin cycle, not a permanently
      // discarded user. Rejoining keeps the target profile close to one
      // active game per two authenticated users while still exercising the
      // queue leave path and its fairness/cleanup behavior.
      matched = waitForEvent(client.socket, 'match.found', {
        timeoutMs: matchTimeoutMs,
      });
      const rejoined = await emitWithAck(
        client.socket,
        'queue.join',
        envelope('queue.join', { payload: { mode: 'blitz' } }),
      );
      assertAck(rejoined, 'queue.joined');
      const rematch = await matched;
      events.emit('counter', 'queue_churn_rematched', 1);
      await runMatchedGame(client, rematch, events);
    }
    await holdConnected(client, Math.max(0, holdMs - (Date.now() - startedAt)));
  } finally {
    client.socket.disconnect();
  }
}

export async function runSocketOnlyUser(context, events) {
  const startedAt = Date.now();
  const client = await bootstrapClient(events);
  try {
    events.emit('counter', 'authenticated_physical_sockets', 1);
    await holdConnected(client, Math.max(0, holdMs - (Date.now() - startedAt)));
  } finally {
    client.socket.disconnect();
  }
}

async function bootstrapClient(events) {
  const sessionStartedAt = performance.now();
  const created = await api('/v1/session', {
    body: {},
    headers: { 'Idempotency-Key': randomUUID() },
    method: 'POST',
  });
  if (created.response.status !== 201) {
    throw new Error(`session bootstrap returned ${created.response.status}`);
  }
  events.emit(
    'histogram',
    'session_bootstrap_latency',
    performance.now() - sessionStartedAt,
  );
  events.emit('counter', 'sessions_created', 1);
  const session = {
    cookie: cookiesFrom(created.response),
    guest: created.body.guest,
    token: created.body.token,
  };
  const socket = createAuthenticatedSocket(session);
  const connectStartedAt = performance.now();
  const ready = waitForEvent(socket, 'session.ready');
  const connected = waitForEvent(socket, 'connect');
  socket.connect();
  await Promise.all([connected, ready]);
  events.emit(
    'histogram',
    'ws_connect_latency',
    performance.now() - connectStartedAt,
  );
  events.emit('counter', 'authenticated_sockets_connected', 1);
  return { session, socket };
}

function createAuthenticatedSocket(session) {
  return createSocketClient(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: { Cookie: session.cookie, Origin: origin },
    forceNew: true,
    reconnection: false,
    rejectUnauthorized: false,
    transports: ['websocket'],
  });
}

async function joinAndMatch(client, events) {
  const found = waitForEvent(client.socket, 'match.found', {
    timeoutMs: matchTimeoutMs,
  });
  const startedAt = performance.now();
  const joined = await emitWithAck(
    client.socket,
    'queue.join',
    envelope('queue.join', { payload: { mode: 'blitz' } }),
  );
  assertAck(joined, 'queue.joined');
  const match = await found;
  events.emit(
    'histogram',
    'match_with_waiting_opponent_latency',
    performance.now() - startedAt,
  );
  events.emit('counter', 'matches_observed', 1);
  return match;
}

async function runMatchedGame(client, match, events) {
  const startedEvent = waitForEvent(client.socket, 'game.started', {
    predicate: (event) => event.gameId === match.gameId,
    timeoutMs: matchTimeoutMs,
  });
  const ready = await emitWithAck(
    client.socket,
    'game.ready',
    envelope('game.ready', {
      gameId: match.gameId,
      gameVersion: match.gameVersion,
    }),
  );
  if (!ready.ok) {
    throw new Error(`game.ready failed with ${ready.error?.code ?? 'unknown'}`);
  }
  await startedEvent;

  if (stablePercent(client.session.guest.id, 100) < 15) {
    await reconnectWithinGrace(client, match.gameId, events);
  }

  const snapshot = await waitUntilPlayable(client, match.gameId);
  const checkmateGame =
    profileName === 'smoke' || stablePercent(match.gameId, 20) === 0;
  await playMoves(
    client,
    match.gameId,
    snapshot.you.color,
    checkmateGame ? foolsMate : opening,
    events,
  );
  events.emit(
    'counter',
    checkmateGame ? 'checkmate_games_driven' : 'opening_games_driven',
    1,
  );
}

async function reconnectWithinGrace(client, gameId, events) {
  const previousSocket = client.socket;
  const disconnected = waitForEvent(client.socket, 'disconnect', {
    timeoutMs: 5000,
  });
  hardDisconnect(previousSocket);
  await disconnected.catch(() => undefined);
  await delay(100 + stablePercent(client.session.guest.id, 400));

  // Build a fresh Socket.IO client after a transport drop. Reusing a manager
  // whose Engine.IO transport was terminated is implementation-dependent and
  // can leave a reconnect attempt queued behind the old closed transport.
  const socket = createAuthenticatedSocket(client.session);
  const startedAt = performance.now();
  const ready = waitForEvent(socket, 'session.ready');
  const snapshot = waitForEvent(socket, 'game.snapshot', {
    predicate: (event) => event.gameId === gameId,
  });
  const connected = waitForEvent(socket, 'connect');
  socket.connect();
  await Promise.all([connected, ready, snapshot]);
  client.socket = socket;
  events.emit(
    'histogram',
    'reconnect_snapshot_latency',
    performance.now() - startedAt,
  );
  events.emit('counter', 'hard_reconnects_completed', 1);
}

function hardDisconnect(socket) {
  // A normal Socket.IO disconnect sends an application-level DISCONNECT
  // packet and exercises the voluntary logout path. Qualification needs to
  // model a dropped network/replica instead, so terminate the underlying
  // ws transport without sending that packet. The fallback remains useful
  // for alternate Engine.IO transports or future client versions.
  const transport = socket.io.engine?.transport;
  const rawSocket = transport?.ws;
  if (rawSocket && typeof rawSocket.terminate === 'function') {
    rawSocket.terminate();
    return;
  }
  transport?.close();
}

async function waitUntilPlayable(client, gameId) {
  const deadline = Date.now() + matchTimeoutMs;
  let last;
  while (Date.now() < deadline) {
    const current = await authorizedApi(
      `/v1/games/${encodeURIComponent(gameId)}/snapshot`,
      client.session,
    );
    if (current.response.ok) {
      last = current.body;
      if (current.body.status === 'IN_PROGRESS') {
        return current.body;
      }
      if (['COMPLETED', 'ABANDONED', 'EXPIRED'].includes(current.body.status)) {
        return current.body;
      }
    }
    await delay(100);
  }
  throw new Error(
    `game ${gameId} did not become playable; last status ${last?.status ?? 'unknown'}`,
  );
}

async function playMoves(client, gameId, color, sequence, events) {
  const deadline = Date.now() + matchTimeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await authorizedApi(
      `/v1/games/${encodeURIComponent(gameId)}/snapshot`,
      client.session,
    );
    if (!snapshot.response.ok) {
      await delay(50);
      continue;
    }
    const state = snapshot.body;
    if (
      ['COMPLETED', 'ABANDONED', 'EXPIRED'].includes(state.status) ||
      state.moves.length >= sequence.length
    ) {
      return;
    }
    const moveIndex = state.moves.length;
    if (state.turn !== color) {
      await waitForEvent(client.socket, 'move.accepted', {
        predicate: (event) => event.gameId === gameId,
        timeoutMs: 1000,
      }).catch(() => undefined);
      continue;
    }
    const clientMoveId = randomUUID();
    const startedAt = performance.now();
    const accepted = await emitWithAck(
      client.socket,
      'move.submit',
      envelope('move.submit', {
        clientMoveId,
        gameId,
        gameVersion: snapshot.body.gameVersion,
        payload: sequence[moveIndex],
      }),
    );
    if (!accepted.ok) {
      if (
        accepted.error?.code === 'STALE_GAME_VERSION' ||
        accepted.error?.code === 'NOT_YOUR_TURN'
      ) {
        continue;
      }
      throw new Error(
        `move.submit failed with ${accepted.error?.code ?? 'unknown'}`,
      );
    }
    events.emit(
      'histogram',
      'move_validate_persist_latency',
      performance.now() - startedAt,
    );
    events.emit('counter', 'committed_moves', 1);
    events.emit('rate', 'committed_move_rate');
  }
  throw new Error(`scripted opening timed out for game ${gameId}`);
}

async function holdConnected(client, durationMs) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    await delay(Math.min(20_000, deadline - Date.now()));
    if (!client.socket.connected) {
      return;
    }
    const acknowledgment = await emitWithAck(
      client.socket,
      'heartbeat.ping',
      envelope('heartbeat.ping', {
        payload: {},
      }),
    );
    if (!acknowledgment.ok) {
      throw new Error('heartbeat failed during connection hold');
    }
  }
}

async function authorizedApi(path, session) {
  return api(path, {
    cookie: session.cookie,
    headers: { Authorization: `Bearer ${session.token}` },
  });
}

async function api(path, { body, cookie, headers = {}, method = 'GET' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
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
  const responseBody = await response.json().catch(() => ({}));
  return { body: responseBody, response };
}

function cookiesFrom(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
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

function emitWithAck(socket, eventName, event) {
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

function waitForEvent(
  socket,
  eventName,
  { predicate = () => true, timeoutMs = 10_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`timed out waiting for ${eventName}`));
    }, timeoutMs);
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

function assertAck(acknowledgment, expectedType) {
  if (!acknowledgment?.ok || acknowledgment.type !== expectedType) {
    throw new Error(
      `expected ${expectedType}; received ${acknowledgment?.type ?? 'no acknowledgement'}`,
    );
  }
}

function stablePercent(value, modulo) {
  let result = 0;
  for (const character of value) {
    result = (result * 31 + character.codePointAt(0)) % modulo;
  }
  return result;
}
