import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../src/common/config/app-config.service.js';
import { parseEnvironment } from '../../src/common/config/config.schema.js';
import type {
  GuestSessionRecord,
  IssuedSessionClaims,
} from '../../src/modules/session/application/ports/guest-session.repository.js';
import {
  JwtTokenService,
  TokenVerificationError,
} from '../../src/modules/session/jwt-token.service.js';

const guestSession: GuestSessionRecord = {
  avatarKey: 'knight-midnight',
  createdAt: new Date('2026-07-24T10:00:00.000Z'),
  currentJti: null,
  displayName: 'BraveKnight42',
  expiresAt: new Date('2026-07-24T22:00:00.000Z'),
  id: '67500fc1-8d5e-4930-98ca-496f29db67c9',
  issuedAt: new Date('2026-07-24T10:00:00.000Z'),
  revokedAt: null,
};

const issuance: IssuedSessionClaims = {
  expiresAt: new Date('2026-07-24T22:00:00.000Z'),
  issuedAt: new Date('2026-07-24T10:00:00.000Z'),
  jti: 'ff8656a1-034d-49ef-8598-56eaec721fa5',
};

function config(): AppConfigService {
  return new AppConfigService(
    parseEnvironment({
      JWT_CLOCK_SKEW_SECONDS: '30',
      JWT_KID: process.env.JWT_KID,
      JWT_PRIVATE_KEY_FILE: process.env.JWT_PRIVATE_KEY_FILE,
      JWT_PUBLIC_KEYS_DIR: process.env.JWT_PUBLIC_KEYS_DIR,
      JWT_TTL_SECONDS: '43200',
      NODE_ENV: 'test',
    }),
  );
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Missing test environment ${name}`);
  }
  return value;
}

function segment(token: string, index: number): string {
  const value = token.split('.')[index];
  if (value === undefined) {
    throw new Error('Test token is malformed');
  }
  return value;
}

function signedToken(
  header: unknown,
  claims: unknown,
  privateKey?: string | Buffer,
): string {
  const input = `${encode(header)}.${encode(claims)}`;
  const signingKey =
    privateKey ?? readFileSync(requiredEnvironment('JWT_PRIVATE_KEY_FILE'));
  return `${input}.${sign(null, Buffer.from(input), signingKey).toString(
    'base64url',
  )}`;
}

function claims(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    avatar: guestSession.avatarKey,
    exp: Math.floor(issuance.expiresAt.getTime() / 1000),
    iat: Math.floor(issuance.issuedAt.getTime() / 1000),
    jti: issuance.jti,
    name: guestSession.displayName,
    sub: guestSession.id,
    v: 1,
    ...overrides,
  };
}

describe('Ed25519 guest JWTs', () => {
  it('issues only the approved claims and verifies the identity', () => {
    const service = new JwtTokenService(config());
    const token = service.issue(guestSession, issuance);
    const payload = JSON.parse(
      Buffer.from(segment(token, 1), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(
      ['avatar', 'exp', 'iat', 'jti', 'name', 'sub', 'v'].sort(),
    );
    expect(
      service.verify(token, new Date('2026-07-24T11:00:00.000Z')),
    ).toMatchObject({
      avatarKey: guestSession.avatarKey,
      guestSessionId: guestSession.id,
      jti: issuance.jti,
      name: guestSession.displayName,
    });
  });

  it('rejects expiry, wrong algorithms, unknown kids, and malformed claims', () => {
    const service = new JwtTokenService(config());
    const header = { alg: 'EdDSA', kid: process.env.JWT_KID, typ: 'JWT' };

    expect(() =>
      service.verify(
        service.issue(guestSession, issuance),
        new Date('2026-07-24T22:00:31.000Z'),
      ),
    ).toThrow(expect.objectContaining({ reason: 'expired' }));
    expect(() =>
      service.verify(
        signedToken({ ...header, alg: 'HS256' }, claims()),
        issuance.issuedAt,
      ),
    ).toThrow(expect.objectContaining({ reason: 'malformed' }));
    expect(() =>
      service.verify(
        signedToken({ ...header, kid: 'retired-missing' }, claims()),
        issuance.issuedAt,
      ),
    ).toThrow(expect.objectContaining({ reason: 'unknown-kid' }));
    expect(() =>
      service.verify(
        signedToken(header, claims({ unexpected: true })),
        issuance.issuedAt,
      ),
    ).toThrow(TokenVerificationError);
    expect(() => service.verify('not-a-jwt', issuance.issuedAt)).toThrow(
      expect.objectContaining({ reason: 'malformed' }),
    );
  });

  it('detects signature tampering and future or nonstandard issuances', () => {
    const service = new JwtTokenService(config());
    const header = { alg: 'EdDSA', kid: process.env.JWT_KID, typ: 'JWT' };
    const token = service.issue(guestSession, issuance);
    const tampered = `${segment(token, 0)}.${encode(
      claims({ name: 'OtherKnight22' }),
    )}.${segment(token, 2)}`;

    expect(() => service.verify(tampered, issuance.issuedAt)).toThrow(
      expect.objectContaining({ reason: 'signature' }),
    );
    expect(() =>
      service.verify(
        signedToken(
          header,
          claims({
            exp: Math.floor(issuance.expiresAt.getTime() / 1000) + 1,
          }),
        ),
        issuance.issuedAt,
      ),
    ).toThrow(expect.objectContaining({ reason: 'malformed' }));
    expect(() =>
      service.verify(
        signedToken(
          header,
          claims({
            exp: Math.floor(issuance.expiresAt.getTime() / 1000) + 120,
            iat: Math.floor(issuance.issuedAt.getTime() / 1000) + 120,
          }),
        ),
        issuance.issuedAt,
      ),
    ).toThrow(expect.objectContaining({ reason: 'malformed' }));
  });

  it('accepts a retiring public key during a key-overlap window', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    });
    writeFileSync(
      join(requiredEnvironment('JWT_PUBLIC_KEYS_DIR'), 'retiring-key.pem'),
      publicKey,
    );
    const service = new JwtTokenService(config());
    const retiringToken = signedToken(
      { alg: 'EdDSA', kid: 'retiring-key', typ: 'JWT' },
      claims({ jti: randomUUID() }),
      privateKey,
    );

    expect(
      service.verify(retiringToken, issuance.issuedAt).guestSessionId,
    ).toBe(guestSession.id);
  });
});
