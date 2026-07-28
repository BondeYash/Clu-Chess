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
}

export interface SessionMockState {
  createKeys: string[];
  currentName(): string;
  resetKeys: string[];
}

export async function installSessionMock(
  page: Page,
  {
    activeGameId = null,
    createFirstVisit = false,
    loseFirstCreateResponse = false,
  }: SessionMockOptions = {},
): Promise<SessionMockState> {
  let created = !createFirstVisit;
  let createAttempts = 0;
  let generation = 0;
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

    await route.fallback();
  });

  return {
    createKeys,
    currentName: () =>
      generation === 0 ? 'SilentKnight482' : 'CopperBishop731',
    resetKeys,
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
  code: 'UNAUTHORIZED',
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
