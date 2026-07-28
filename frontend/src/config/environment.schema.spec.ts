import { describe, expect, it } from 'vitest';

import {
  parseFrontendEnvironment,
  parsePublicEnvironment,
} from './environment.schema';

describe('frontend environment', () => {
  it('provides safe local defaults', () => {
    const environment = parseFrontendEnvironment({});

    expect(environment).toMatchObject({
      FRONTEND_DEPLOYMENT_ENV: 'local',
      NEXT_PUBLIC_API_ORIGIN: 'http://localhost:3000',
      NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:5173',
      NEXT_PUBLIC_ENABLE_DEVTOOLS: false,
      NEXT_PUBLIC_FF_LEARN_HUB: false,
      NEXT_PUBLIC_PROTOCOL_VERSION: 1,
      NEXT_PUBLIC_SOCKET_ORIGIN: 'http://localhost:3000',
    });
  });

  it('accepts a secure production matrix', () => {
    const environment = parseFrontendEnvironment({
      FRONTEND_DEPLOYMENT_ENV: 'production',
      NEXT_PUBLIC_API_ORIGIN: 'https://api.cluchess.example',
      NEXT_PUBLIC_APP_ORIGIN: 'https://cluchess.example',
      NEXT_PUBLIC_PROTOCOL_VERSION: '1',
      NEXT_PUBLIC_SOCKET_ORIGIN: 'wss://api.cluchess.example',
    });

    expect(environment.FRONTEND_DEPLOYMENT_ENV).toBe('production');
  });

  it('accepts same-origin production service routes', () => {
    const environment = parseFrontendEnvironment({
      FRONTEND_DEPLOYMENT_ENV: 'production',
      NEXT_PUBLIC_API_ORIGIN: '',
      NEXT_PUBLIC_APP_ORIGIN: 'https://cluchess.example',
      NEXT_PUBLIC_FF_LEARN_HUB: 'true',
      NEXT_PUBLIC_SOCKET_ORIGIN: '',
    });

    expect(environment.NEXT_PUBLIC_API_ORIGIN).toBe('');
    expect(environment.NEXT_PUBLIC_FF_LEARN_HUB).toBe(true);
    expect(environment.NEXT_PUBLIC_SOCKET_ORIGIN).toBe('');
  });

  it('rejects insecure production origins', () => {
    expect(() =>
      parseFrontendEnvironment({
        FRONTEND_DEPLOYMENT_ENV: 'production',
        NEXT_PUBLIC_API_ORIGIN: 'http://api.cluchess.example',
        NEXT_PUBLIC_APP_ORIGIN: 'https://cluchess.example',
        NEXT_PUBLIC_SOCKET_ORIGIN: 'wss://api.cluchess.example',
      }),
    ).toThrow();
  });

  it('rejects a protocol version mismatch', () => {
    expect(() =>
      parsePublicEnvironment({ NEXT_PUBLIC_PROTOCOL_VERSION: '2' }),
    ).toThrow();
  });

  it('rejects secret-shaped public variables', () => {
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_SESSION_TOKEN: 'must-not-be-public',
      }),
    ).toThrow(/cannot use the NEXT_PUBLIC_ prefix/);
  });
});
