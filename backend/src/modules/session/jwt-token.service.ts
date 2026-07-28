import { Injectable } from '@nestjs/common';
import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { AppConfigService } from '../../common/config/app-config.service.js';
import type {
  GuestSessionRecord,
  IssuedSessionClaims,
} from './application/ports/guest-session.repository.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jwtHeaderSchema = z
  .object({
    alg: z.literal('EdDSA'),
    kid: z.string().min(1).max(128),
    typ: z.literal('JWT'),
  })
  .strict();

const jwtClaimsSchema = z
  .object({
    avatar: z.string().min(1).max(128),
    exp: z.number().int().positive(),
    iat: z.number().int().nonnegative(),
    jti: z.string().regex(UUID_V4),
    name: z.string().min(1).max(128),
    sub: z.string().regex(UUID_V4),
    v: z.literal(1),
  })
  .strict();

type JwtClaims = Readonly<z.infer<typeof jwtClaimsSchema>>;

export interface AuthenticatedGuest {
  avatarKey: string;
  expiresAt: Date;
  guestSessionId: string;
  issuedAt: Date;
  jti: string;
  name: string;
}

export type TokenFailureReason =
  'expired' | 'malformed' | 'signature' | 'unknown-kid';

export class TokenVerificationError extends Error {
  constructor(readonly reason: TokenFailureReason) {
    super('Guest token is invalid');
    this.name = 'TokenVerificationError';
  }
}

@Injectable()
export class JwtTokenService {
  private readonly activeKid: string;
  private readonly clockSkewSeconds: number;
  private readonly privateKey: KeyObject;
  private readonly publicKeys: ReadonlyMap<string, KeyObject>;
  private readonly ttlSeconds: number;

  constructor(config: AppConfigService) {
    this.activeKid = config.values.JWT_KID;
    this.clockSkewSeconds = config.values.JWT_CLOCK_SKEW_SECONDS;
    this.ttlSeconds = config.values.JWT_TTL_SECONDS;
    this.privateKey = createPrivateKey(
      readFileSync(config.values.JWT_PRIVATE_KEY_FILE),
    );
    this.publicKeys = this.loadPublicKeys(config.values.JWT_PUBLIC_KEYS_DIR);
    this.assertKeySet();
  }

  issue(
    guestSession: GuestSessionRecord,
    issuedClaims: IssuedSessionClaims,
  ): string {
    const claims: JwtClaims = {
      avatar: guestSession.avatarKey,
      exp: Math.floor(issuedClaims.expiresAt.getTime() / 1000),
      iat: Math.floor(issuedClaims.issuedAt.getTime() / 1000),
      jti: issuedClaims.jti,
      name: guestSession.displayName,
      sub: guestSession.id,
      v: 1,
    };
    const parsedClaims = jwtClaimsSchema.parse(claims);
    if (parsedClaims.exp - parsedClaims.iat !== this.ttlSeconds) {
      throw new Error('Token issuance does not match configured lifetime');
    }

    const header = {
      alg: 'EdDSA',
      kid: this.activeKid,
      typ: 'JWT',
    } as const;
    const signingInput = `${this.encode(header)}.${this.encode(parsedClaims)}`;
    const signature = sign(null, Buffer.from(signingInput), this.privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  verify(token: string, now = new Date()): AuthenticatedGuest {
    if (token.length > 8192) {
      throw new TokenVerificationError('malformed');
    }
    const segments = token.split('.');
    if (segments.length !== 3) {
      throw new TokenVerificationError('malformed');
    }
    const [encodedHeader, encodedClaims, encodedSignature] = segments;
    if (
      encodedHeader === undefined ||
      encodedClaims === undefined ||
      encodedSignature === undefined
    ) {
      throw new TokenVerificationError('malformed');
    }

    const headerResult = jwtHeaderSchema.safeParse(
      this.decodeJson(encodedHeader),
    );
    if (!headerResult.success) {
      throw new TokenVerificationError('malformed');
    }
    const publicKey = this.publicKeys.get(headerResult.data.kid);
    if (publicKey === undefined) {
      throw new TokenVerificationError('unknown-kid');
    }

    const signingInput = `${encodedHeader}.${encodedClaims}`;
    let signature: Buffer;
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
        throw new Error('invalid signature encoding');
      }
      signature = Buffer.from(encodedSignature, 'base64url');
    } catch {
      throw new TokenVerificationError('malformed');
    }
    if (!verify(null, Buffer.from(signingInput), publicKey, signature)) {
      throw new TokenVerificationError('signature');
    }

    const claimsResult = jwtClaimsSchema.safeParse(
      this.decodeJson(encodedClaims),
    );
    if (!claimsResult.success) {
      throw new TokenVerificationError('malformed');
    }
    const claims = claimsResult.data;
    if (claims.exp - claims.iat !== this.ttlSeconds) {
      throw new TokenVerificationError('malformed');
    }

    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (claims.iat > nowSeconds + this.clockSkewSeconds) {
      throw new TokenVerificationError('malformed');
    }
    if (nowSeconds >= claims.exp + this.clockSkewSeconds) {
      throw new TokenVerificationError('expired');
    }

    return {
      avatarKey: claims.avatar,
      expiresAt: new Date(claims.exp * 1000),
      guestSessionId: claims.sub,
      issuedAt: new Date(claims.iat * 1000),
      jti: claims.jti,
      name: claims.name,
    };
  }

  private assertKeySet(): void {
    if (this.privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('JWT private key must use Ed25519');
    }
    const activePublicKey = this.publicKeys.get(this.activeKid);
    if (activePublicKey?.asymmetricKeyType !== 'ed25519') {
      throw new Error('Active JWT public key must use Ed25519');
    }

    const challenge = Buffer.from('cluchess-key-pair-check');
    const signature = sign(null, challenge, this.privateKey);
    if (!verify(null, challenge, activePublicKey, signature)) {
      throw new Error('Active JWT signing key pair does not match');
    }
  }

  private decodeJson(segment: string): unknown {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
        throw new Error('invalid token encoding');
      }
      return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
      throw new TokenVerificationError('malformed');
    }
  }

  private encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private loadPublicKeys(directory: string): ReadonlyMap<string, KeyObject> {
    const keys = new Map<string, KeyObject>();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.pem')) {
        continue;
      }
      const kid = basename(entry.name, '.pem');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(kid)) {
        throw new Error('JWT public key filename contains an invalid key ID');
      }
      const key = createPublicKey(readFileSync(join(directory, entry.name)));
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new Error('JWT public keys must use Ed25519');
      }
      keys.set(kid, key);
    }
    return keys;
  }
}
