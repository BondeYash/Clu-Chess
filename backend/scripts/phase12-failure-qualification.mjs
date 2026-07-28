import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { io as createSocketClient } from 'socket.io-client';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
process.chdir(repositoryRoot);

const project = process.env.QUALIFICATION_PROJECT ?? 'cluchess-phase12-failure';
const edgePort = process.env.MULTI_EDGE_PORT ?? '3543';
const baseUrl = `https://localhost:${edgePort}`;
const origin = baseUrl;
const artifactRoot = resolve(
  process.env.QUALIFICATION_ARTIFACT_DIR ?? '.artifacts/phase12',
);
const artifactDir = resolve(artifactRoot, 'failure');
const composeFiles = [
  '--file',
  'compose.multi.yaml',
  '--file',
  'compose.qualification.yaml',
];
const composeBase = ['compose', '--project-name', project, ...composeFiles];
const events = [];
const sockets = new Set();
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

await mkdir(artifactDir, { recursive: true });
await Promise.all([chmod(artifactRoot, 0o777), chmod(artifactDir, 0o777)]);
compose(
  ['--profile', 'qualification', 'down', '--volumes', '--remove-orphans'],
  {
    allowFailure: true,
  },
);

let failure;
try {
  mark('stack.starting');
  compose(['up', '--build', '--detach', '--wait', 'nginx']);
  mark('stack.ready');

  const sessions = await createSessionsAcrossReplicas();
  const clients = await Promise.all(sessions.map(connect));
  const game = await matchAndStart(clients[0], clients[1]);
  mark('game.started', { gameId: game.id });

  const disconnected = clients.map((client) =>
    waitForEvent(client.socket, 'disconnect', { timeoutMs: 20_000 })
      .then(() => client)
      .catch(() => null),
  );
  mark('process_crash.injecting', { service: 'app-a', signal: 'SIGKILL' });
  compose(['kill', '--signal', 'SIGKILL', 'app-a']);
  const crashedClient = await firstNonNull(disconnected);
  assert.ok(crashedClient, 'one client pinned to app-a must disconnect');
  mark('process_crash.observed', {
    guestId: crashedClient.session.guest.id,
  });

  sockets.delete(crashedClient.socket);
  const reconnectStartedAt = performance.now();
  crashedClient.socket = await reconnect(crashedClient.session, game.id);
  sockets.add(crashedClient.socket);
  const reconnectMs = performance.now() - reconnectStartedAt;
  mark('process_crash.recovered', { reconnectMs });
  assert.ok(reconnectMs <= 30_000, 'crash recovery must remain bounded');

  compose(['start', 'app-a']);
  await waitUntil(
    async () => (await directHealth('app-a')).status === 200,
    60_000,
    'app-a did not become ready after restart',
  );
  mark('process_crash.replica_rejoined');

  await playFoolsMate(game, clients[0], clients[1]);
  mark('checkmate.completed', { gameId: game.id });
  for (const client of clients) {
    client.socket.disconnect();
  }
  await delay(100);

  await dependencyKill('postgres');
  await dependencyKill('redis');

  await captureEvidence();
  mark('qualification.completed');
} catch (error) {
  failure = error;
  mark('qualification.failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  await captureLogs().catch(() => undefined);
} finally {
  for (const socket of sockets) {
    socket.disconnect();
  }
  const report = {
    events,
    failed: failure !== undefined,
    finishedAt: new Date().toISOString(),
    project,
    schemaVersion: 1,
  };
  await writeFile(
    resolve(artifactDir, 'failure-qualification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  execFileSync('chmod', ['-R', 'a+rX', artifactDir]);
  compose(
    ['--profile', 'qualification', 'down', '--volumes', '--remove-orphans'],
    { allowFailure: true },
  );
}

if (failure !== undefined) {
  throw failure;
}
process.stdout.write(
  'Phase 12 process-crash, dependency-kill, checkmate, audit, and metrics qualification passed\n',
);

async function dependencyKill(service) {
  mark(`${service}.kill.injecting`);
  compose(['stop', service]);
  await waitUntil(
    async () => (await edgeHealth()).status === 503,
    30_000,
    `${service} loss did not make readiness fail closed`,
  );
  const live = await api('/healthz', { parseJson: false });
  assert.equal(
    live.response.status,
    200,
    'liveness must survive dependency loss',
  );
  mark(`${service}.kill.observed`);
  compose(['start', service]);
  await waitUntil(
    async () => (await edgeHealth()).status === 200,
    60_000,
    `${service} recovery did not restore readiness`,
  );
  mark(`${service}.recovered`);
}

async function captureEvidence() {
  const evidencePath = '/evidence/failure';
  compose([
    '--profile',
    'qualification',
    'run',
    '--rm',
    '--no-deps',
    'qualification-client',
    'node',
    'scripts/qualification-audit.mjs',
    `${evidencePath}/correctness-audit.json`,
  ]);
  compose([
    '--profile',
    'qualification',
    'run',
    '--rm',
    '--no-deps',
    'qualification-client',
    'node',
    'scripts/qualification-metrics.mjs',
    `${evidencePath}/metrics.json`,
  ]);

  const containerIds = composeOutput(['ps', '--quiet'])
    .split(/\r?\n/)
    .filter(Boolean);
  const stats = containerIds.map((containerId) =>
    JSON.parse(
      dockerOutput([
        'stats',
        '--no-stream',
        '--format',
        '{{json .}}',
        containerId,
      ]),
    ),
  );
  await writeFile(
    resolve(artifactDir, 'docker-stats.json'),
    `${JSON.stringify(stats, null, 2)}\n`,
    { mode: 0o600 },
  );

  const versions = {
    applicationCommit: gitOutput(['rev-parse', 'HEAD']),
    compose: dockerOutput(['compose', 'version']),
    docker: dockerOutput(['version', '--format', '{{json .}}']),
    images: composeOutput(['images', '--format', 'json']),
    node: process.version,
  };
  await writeFile(
    resolve(artifactDir, 'versions.json'),
    `${JSON.stringify(versions, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    resolve(artifactDir, 'compose-rendered.yaml'),
    composeOutput(['config']),
    { mode: 0o600 },
  );
}

async function captureLogs() {
  await writeFile(
    resolve(artifactDir, 'compose.log'),
    composeOutput(['logs', '--no-color', '--tail', '500'], {
      allowFailure: true,
    }),
    { mode: 0o600 },
  );
}

async function createSessionsAcrossReplicas() {
  const sessionsByUpstream = new Map();
  for (let index = 0; index < 12 && sessionsByUpstream.size < 2; index += 1) {
    const created = await api('/v1/session', {
      body: {},
      headers: { 'Idempotency-Key': randomUUID() },
      method: 'POST',
    });
    assert.equal(created.response.status, 201);
    const session = {
      cookie: cookiesFrom(created.response),
      guest: created.body.guest,
      token: created.body.token,
      upstream: requiredHeader(created.response, 'x-cluchess-upstream'),
    };
    sessionsByUpstream.set(session.upstream, session);
  }
  assert.equal(
    sessionsByUpstream.size,
    2,
    'sessions must be pinned across both replicas',
  );
  return [...sessionsByUpstream.values()];
}

async function connect(session) {
  const socket = socketFor(session);
  sockets.add(socket);
  const ready = waitForEvent(socket, 'session.ready');
  const connected = waitForEvent(socket, 'connect');
  socket.connect();
  const [, readyEvent] = await Promise.all([connected, ready]);
  assert.equal(readyEvent.payload.guest.id, session.guest.id);
  return { session, socket };
}

async function reconnect(session, gameId) {
  const socket = socketFor(session, true);
  const ready = waitForEvent(socket, 'session.ready', { timeoutMs: 30_000 });
  const snapshot = waitForEvent(socket, 'game.snapshot', {
    predicate: (event) => event.gameId === gameId,
    timeoutMs: 30_000,
  });
  const connected = waitForEvent(socket, 'connect', { timeoutMs: 30_000 });
  socket.connect();
  await Promise.all([connected, ready, snapshot]);
  return socket;
}

function socketFor(session, reconnection = false) {
  return createSocketClient(baseUrl, {
    auth: { token: session.token },
    autoConnect: false,
    extraHeaders: {
      Cookie: reconnection
        ? withoutRouteCookie(session.cookie)
        : session.cookie,
      Origin: origin,
    },
    forceNew: true,
    reconnection,
    reconnectionAttempts: 30,
    reconnectionDelay: 200,
    reconnectionDelayMax: 500,
    rejectUnauthorized: false,
    transports: ['websocket'],
  });
}

function withoutRouteCookie(cookie) {
  return cookie
    .split(/;\s*/u)
    .filter((entry) => !entry.startsWith('cluchess_route='))
    .join('; ');
}

async function matchAndStart(clientA, clientB) {
  const foundA = waitForEvent(clientA.socket, 'match.found');
  const joinedA = await emitWithAck(
    clientA.socket,
    'queue.join',
    envelope('queue.join', { payload: { mode: 'blitz' } }),
  );
  assertAck(joinedA, 'queue.joined');
  const foundB = waitForEvent(clientB.socket, 'match.found');
  const joinedB = await emitWithAck(
    clientB.socket,
    'queue.join',
    envelope('queue.join', { payload: { mode: 'blitz' } }),
  );
  assertAck(joinedB, 'queue.joined');
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

async function playFoolsMate(game, clientA, clientB) {
  const byColor = {
    [game.colorA]: clientA,
    [game.colorB]: clientB,
  };
  const moves = [
    { color: 'white', from: 'f2', to: 'f3' },
    { color: 'black', from: 'e7', to: 'e5' },
    { color: 'white', from: 'g2', to: 'g4' },
    { color: 'black', from: 'd8', to: 'h4' },
  ];
  for (const move of moves) {
    const client = byColor[move.color];
    const snapshot = await authorizedApi(
      `/v1/games/${encodeURIComponent(game.id)}/snapshot`,
      client.session,
    );
    assert.equal(snapshot.response.status, 200);
    assert.equal(snapshot.body.turn, move.color);
    const accepted = await emitWithAck(
      client.socket,
      'move.submit',
      envelope('move.submit', {
        clientMoveId: randomUUID(),
        gameId: game.id,
        gameVersion: snapshot.body.gameVersion,
        payload: { from: move.from, to: move.to },
      }),
    );
    assert.equal(accepted.ok, true);
    assert.equal(accepted.type, 'move.accepted');
  }
  const terminal = await authorizedApi(
    `/v1/games/${encodeURIComponent(game.id)}/snapshot`,
    clientA.session,
  );
  assert.equal(terminal.response.status, 200);
  assert.equal(terminal.body.status, 'COMPLETED');
  assert.equal(terminal.body.termination, 'checkmate');
}

async function authorizedApi(path, session) {
  return api(path, {
    cookie: session.cookie,
    headers: { Authorization: `Bearer ${session.token}` },
  });
}

async function edgeHealth() {
  return api('/readyz', { parseJson: false }).then(({ response }) => response);
}

async function directHealth(service) {
  const result = composeOutput([
    'exec',
    '-T',
    service,
    'node',
    '-e',
    "fetch('http://127.0.0.1:3000/readyz').then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('0'))",
  ]);
  return { status: Number(result) };
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
  return {
    body: parseJson ? await response.json() : await response.text(),
    response,
  };
}

function cookiesFrom(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
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

async function firstNonNull(promises) {
  const pending = promises.map((promise, index) =>
    promise.then((value) => ({ index, value })),
  );
  while (pending.length > 0) {
    const winner = await Promise.race(pending);
    if (winner.value !== null) {
      return winner.value;
    }
    pending.splice(
      pending.findIndex((_, index) => index === winner.index),
      1,
    );
  }
  return null;
}

async function waitUntil(probe, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await probe()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `${message}${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

function assertAck(acknowledgment, type) {
  assert.equal(acknowledgment.ok, true);
  assert.equal(acknowledgment.type, type);
}

function mark(type, details = {}) {
  const event = { at: new Date().toISOString(), details, type };
  events.push(event);
  process.stdout.write(`${type}\n`);
}

function compose(arguments_, options = {}) {
  const result = spawnSync('docker', [...composeBase, ...arguments_], {
    encoding: 'utf8',
    env: {
      ...process.env,
      COMPOSE_PROGRESS: 'plain',
      MULTI_EDGE_PORT: edgePort,
      QUALIFICATION_ARTIFACT_DIR: artifactRoot,
    },
    stdio: 'inherit',
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker compose ${arguments_.join(' ')} failed`);
  }
}

function composeOutput(arguments_, options = {}) {
  try {
    return execFileSync('docker', [...composeBase, ...arguments_], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MULTI_EDGE_PORT: edgePort,
        QUALIFICATION_ARTIFACT_DIR: artifactRoot,
      },
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return error.stdout?.toString().trim() ?? '';
    }
    throw error;
  }
}

function dockerOutput(arguments_) {
  return execFileSync('docker', arguments_, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function gitOutput(arguments_) {
  return execFileSync('git', arguments_, { encoding: 'utf8' }).trim();
}
