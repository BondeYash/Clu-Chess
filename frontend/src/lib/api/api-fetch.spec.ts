import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './api-error';
import { apiFetch, redactHeaders, redactUrl } from './api-fetch';

const correlationId = '11111111-1111-4111-8111-111111111111';
const schema = z.object({ ok: z.literal(true) });

describe('apiFetch', () => {
  it('adds credential, correlation, bearer, JSON, and idempotency policy', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }, 200, {
        'X-Correlation-Id': correlationId,
      }),
    );

    await expect(
      apiFetch('/v1/session/renew', {
        body: {},
        correlationId,
        fetchImplementation,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        method: 'POST',
        origin: 'https://api.cluchess.test',
        schema,
        token: 'private-jwt',
      }),
    ).resolves.toEqual({ ok: true });

    const [url, request] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe('https://api.cluchess.test/v1/session/renew');
    expect(request?.credentials).toBe('include');
    expect(request?.body).toBe('{}');
    const headers = new Headers(request?.headers);
    expect(headers.get('authorization')).toBe('Bearer private-jwt');
    expect(headers.get('idempotency-key')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(headers.get('x-correlation-id')).toBe(correlationId);
  });

  it('returns a typed public API error and honors retry timing', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          correlationId,
          error: {
            code: 'RATE_LIMITED',
            message: 'Wait before retrying',
            retryable: true,
          },
        },
        429,
        { 'Retry-After': '2' },
      ),
    );

    const error = await apiFetch('/v1/session', {
      fetchImplementation,
      origin: '',
      schema,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      correlationId,
      retryable: true,
      retryAfterMs: 2_000,
      status: 429,
    });
  });

  it('rejects malformed, non-JSON, and schema-invalid success responses', async () => {
    const cases = [
      new Response('not-json', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
      new Response('plain text', {
        headers: { 'Content-Type': 'text/plain' },
        status: 200,
      }),
      jsonResponse({ ok: false }, 200),
    ];

    for (const response of cases) {
      await expect(
        apiFetch('/v1/session', {
          fetchImplementation: vi
            .fn<typeof fetch>()
            .mockResolvedValue(response),
          origin: '',
          schema,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('distinguishes timeouts from caller cancellation', async () => {
    const hangingFetch = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    await expect(
      apiFetch('/v1/session', {
        fetchImplementation: hangingFetch,
        origin: '',
        schema,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      retryable: true,
    });

    const controller = new AbortController();
    const request = apiFetch('/v1/session', {
      fetchImplementation: hangingFetch,
      origin: '',
      schema,
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
      retryable: false,
    });
  });

  it('redacts credentials and URL query data before diagnostics', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'guest=secret',
        'X-Correlation-Id': correlationId,
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-correlation-id': correlationId,
    });
    expect(
      redactUrl('https://api.cluchess.test/v1/session?token=secret#fragment'),
    ).toBe('https://api.cluchess.test/v1/session');
  });
});

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
    status,
  });
}
