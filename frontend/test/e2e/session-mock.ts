import type { Page, Route } from '@playwright/test';

const correlationId = '11111111-1111-4111-8111-111111111111';
const firstGuestId = '22222222-2222-4222-8222-222222222222';
const secondGuestId = '33333333-3333-4333-8333-333333333333';
const expiresAt = '2099-07-28T20:00:00.000Z';
const issuedAt = '2026-07-28T08:00:00.000Z';

export interface SessionMockOptions {
  activeGameId?: string | null;
  createFirstVisit?: boolean;
  loseFirstCreateResponse?: boolean;
  privateSnapshotStatus?: 403 | 404;
}

export interface SessionMockState {
  createKeys: string[];
  currentName(): string;
  failSnapshots(value: boolean): void;
  resetKeys: string[];
  snapshotCalls(): number;
}

export async function installSessionMock(
  page: Page,
  {
    activeGameId = null,
    createFirstVisit = false,
    loseFirstCreateResponse = false,
    privateSnapshotStatus,
  }: SessionMockOptions = {},
): Promise<SessionMockState> {
  let created = !createFirstVisit;
  let createAttempts = 0;
  let generation = 0;
  let snapshotsFail = false;
  let snapshotRequestCount = 0;
  const createKeys: string[] = [];
  const resetKeys: string[] = [];

  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    if (method === 'OPTIONS') {
      await route.fulfill({ headers: corsHeaders(), status: 204 });
      return;
    }

    if (pathname === '/v1/session' && method === 'GET') {
      if (!created) {
        await fulfillError(route, 'UNAUTHORIZED', 401, false);
        return;
      }
      await fulfillJson(route, {
        correlationId,
        guest: guest(generation, true),
      });
      return;
    }

    if (pathname === '/v1/session' && method === 'POST') {
      const key = request.headers()['idempotency-key'] ?? '';
      createKeys.push(key);
      createAttempts += 1;
      if (loseFirstCreateResponse && createAttempts === 1) {
        await route.abort('connectionreset');
        return;
      }
      created = true;
      await fulfillJson(
        route,
        {
          correlationId,
          guest: guest(generation, false),
          token: `private-jwt-${generation}`,
        },
        201,
      );
      return;
    }

    if (pathname === '/v1/session/renew' && method === 'POST') {
      await fulfillJson(route, {
        correlationId,
        expiresAt,
        token: `renewed-private-jwt-${generation}`,
      });
      return;
    }

    if (pathname === '/v1/session/reset' && method === 'POST') {
      resetKeys.push(request.headers()['idempotency-key'] ?? '');
      created = false;
      generation += 1;
      await fulfillJson(route, { correlationId, ok: true });
      return;
    }

    if (pathname === '/v1/games/active' && method === 'GET') {
      await fulfillJson(route, { correlationId, gameId: activeGameId });
      return;
    }

    if (
      /^\/v1\/games\/[0-9a-f-]+\/snapshot$/i.test(pathname) &&
      method === 'GET'
    ) {
      snapshotRequestCount += 1;
      if (snapshotsFail) {
        await route.abort('connectionrefused');
        return;
      }
      if (privateSnapshotStatus) {
        await fulfillError(
          route,
          privateSnapshotStatus === 403 ? 'NOT_A_PLAYER' : 'GAME_NOT_FOUND',
          privateSnapshotStatus,
          false,
        );
        return;
      }
      const gameId = pathname.split('/')[3] ?? '';
      await fulfillJson(route, snapshot(gameId));
      return;
    }

    await route.fallback();
  });

  return {
    createKeys,
    currentName: () =>
      generation === 0 ? 'SilentKnight482' : 'CopperBishop731',
    failSnapshots: (value) => {
      snapshotsFail = value;
    },
    resetKeys,
    snapshotCalls: () => snapshotRequestCount,
  };
}

function guest(generation: number, includeIssuedAt: boolean) {
  const value = {
    avatar: generation === 0 ? 'knight_amber_01' : 'knight_chestnut_01',
    expiresAt,
    id: generation === 0 ? firstGuestId : secondGuestId,
    name: generation === 0 ? 'SilentKnight482' : 'CopperBishop731',
  };
  return includeIssuedAt ? { ...value, issuedAt } : value;
}

async function fulfillError(
  route: Route,
  code: 'GAME_NOT_FOUND' | 'NOT_A_PLAYER' | 'UNAUTHORIZED',
  status: number,
  retryable: boolean,
) {
  await fulfillJson(
    route,
    {
      correlationId,
      error: { code, message: 'Guest authentication is required', retryable },
    },
    status,
  );
}

function snapshot(gameId: string) {
  return {
    clocks: {
      blackMs: 287_000,
      running: 'white',
      serverTime: Date.now(),
      whiteMs: 296_000,
    },
    correlationId,
    currentFen:
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    gameId,
    gameVersion: 7,
    initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: Array.from({ length: 40 }, (_, index) => ({
      color: index % 2 === 0 ? 'white' : 'black',
      ply: index + 1,
      san: ['e4', 'e5', 'Nf3', 'Nc6'][index % 4],
      uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'][index % 4],
    })),
    opponent: {
      avatar: 'knight_black_01',
      color: 'black',
      connected: true,
      name: 'NobleRook91',
    },
    result: null,
    status: 'IN_PROGRESS',
    termination: null,
    turn: 'white',
    you: {
      avatar: 'knight_amber_01',
      color: 'white',
      connected: true,
      name: 'SilentKnight482',
    },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
    },
    status,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Idempotency-Key, X-Correlation-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
  };
}
