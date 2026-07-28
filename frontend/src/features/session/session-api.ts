import {
  clientActiveGameResponseSchema,
  clientCreateSessionResponseSchema,
  clientGetSessionResponseSchema,
  clientRenewSessionResponseSchema,
  clientResetSessionResponseSchema,
  type ActiveGameResponse,
  type CreateSessionResponse,
  type GetSessionResponse,
  type RenewSessionResponse,
  type ResetSessionResponse,
} from '@cluchess/protocol-v1/http';

import { apiFetch } from '@/lib/api/api-fetch';

export interface SessionApiClient {
  create(idempotencyKey: string): Promise<CreateSessionResponse>;
  getActive(token: string): Promise<ActiveGameResponse>;
  getCurrent(token?: string): Promise<GetSessionResponse>;
  renew(idempotencyKey: string, token?: string): Promise<RenewSessionResponse>;
  reset(idempotencyKey: string, token: string): Promise<ResetSessionResponse>;
}

export const sessionApi: SessionApiClient = {
  create(idempotencyKey) {
    return apiFetch('/v1/session', {
      body: {},
      idempotencyKey,
      method: 'POST',
      schema: clientCreateSessionResponseSchema,
    });
  },
  getActive(token) {
    return apiFetch('/v1/games/active', {
      schema: clientActiveGameResponseSchema,
      token,
    });
  },
  getCurrent(token) {
    return apiFetch('/v1/session', {
      schema: clientGetSessionResponseSchema,
      ...(token ? { token } : {}),
    });
  },
  renew(idempotencyKey, token) {
    return apiFetch('/v1/session/renew', {
      body: {},
      idempotencyKey,
      method: 'POST',
      schema: clientRenewSessionResponseSchema,
      ...(token ? { token } : {}),
    });
  },
  reset(idempotencyKey, token) {
    return apiFetch('/v1/session/reset', {
      body: {},
      idempotencyKey,
      method: 'POST',
      schema: clientResetSessionResponseSchema,
      token,
    });
  },
};
