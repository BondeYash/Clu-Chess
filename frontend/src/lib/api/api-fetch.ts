import { clientHttpErrorResponseSchema } from '@cluchess/protocol-v1/http';
import type { z } from 'zod';

import { publicEnvironment } from '@/config/environment';

import { ApiError } from './api-error';

const DEFAULT_TIMEOUT_MS = 10_000;
const REDACTED = '[REDACTED]';
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);

export interface ApiFetchOptions<T> {
  body?: unknown;
  correlationId?: string;
  fetchImplementation?: typeof fetch;
  headers?: HeadersInit;
  idempotencyKey?: string;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  origin?: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
  token?: string;
}

export async function apiFetch<T>(
  path: `/${string}`,
  options: ApiFetchOptions<T>,
): Promise<T> {
  const {
    body,
    correlationId = crypto.randomUUID(),
    fetchImplementation = fetch,
    headers: extraHeaders,
    idempotencyKey,
    method = 'GET',
    origin = publicEnvironment.NEXT_PUBLIC_API_ORIGIN,
    schema,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    token,
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();

  const headers = new Headers(extraHeaders);
  headers.set('Accept', 'application/json');
  headers.set('X-Correlation-Id', correlationId);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const response = await fetchImplementation(resolveApiUrl(origin, path), {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'include',
      headers,
      method,
      signal: controller.signal,
    });
    const responseCorrelationId =
      response.headers.get('x-correlation-id') ?? correlationId;
    const parsedBody = await parseResponseBody(response, responseCorrelationId);

    if (!response.ok) {
      const parsedError = clientHttpErrorResponseSchema.safeParse(parsedBody);
      if (parsedError.success) {
        throw new ApiError({
          code: parsedError.data.error.code,
          correlationId: parsedError.data.correlationId,
          message: parsedError.data.error.message,
          retryable: parsedError.data.error.retryable,
          retryAfterMs:
            parsedError.data.error.retryAfterMs ??
            parseRetryAfter(response.headers.get('retry-after')),
          status: response.status,
        });
      }

      throw new ApiError({
        code: 'INVALID_RESPONSE',
        correlationId: responseCorrelationId,
        message: 'The service returned an unreadable error response.',
        retryable: response.status >= 500,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        status: response.status,
      });
    }

    const result = schema.safeParse(parsedBody);
    if (!result.success) {
      throw new ApiError({
        cause: result.error,
        code: 'INVALID_RESPONSE',
        correlationId: responseCorrelationId,
        message: 'The service returned data this version cannot safely use.',
        retryable: false,
        status: response.status,
      });
    }
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError({
        cause: error,
        code: 'REQUEST_TIMEOUT',
        correlationId,
        message: 'The request took too long to complete.',
        retryable: true,
        status: 0,
      });
    }
    if (signal?.aborted) {
      throw new ApiError({
        cause: error,
        code: 'REQUEST_ABORTED',
        correlationId,
        message: 'The request was cancelled.',
        retryable: false,
        status: 0,
      });
    }
    throw new ApiError({
      cause: error,
      code: 'NETWORK_ERROR',
      correlationId,
      message: 'The service could not be reached.',
      retryable: true,
      status: 0,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function parseResponseBody(
  response: Response,
  correlationId: string,
): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError({
      code: 'INVALID_RESPONSE',
      correlationId,
      message: 'The service returned an unsupported response format.',
      retryable: response.status >= 500,
      status: response.status,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ApiError({
      cause: error,
      code: 'INVALID_RESPONSE',
      correlationId,
      message: 'The service returned malformed JSON.',
      retryable: response.status >= 500,
      status: response.status,
    });
  }
}

function resolveApiUrl(origin: string, path: string): string {
  return origin ? new URL(path, `${origin}/`).toString() : path;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

export function redactHeaders(headers: HeadersInit): Record<string, string> {
  const safe: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    safe[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  });
  return safe;
}

export function redactUrl(value: string): string {
  const url = new URL(value, 'http://redaction.invalid');
  return `${url.origin === 'http://redaction.invalid' ? '' : url.origin}${url.pathname}`;
}
