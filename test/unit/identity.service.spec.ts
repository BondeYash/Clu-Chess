import { describe, expect, it, vi } from 'vitest';
import {
  ADJECTIVES,
  AVATARS,
  NOUNS,
} from '../../src/modules/identity/domain/identity.catalogs.js';
import {
  containsProfanity,
  normalizeForProfanity,
} from '../../src/modules/identity/domain/profanity.js';
import {
  IdentityGenerationError,
  IdentityService,
} from '../../src/modules/identity/identity.service.js';
import {
  CryptoIdentityRandomSource,
  IdentityRandomSource,
} from '../../src/modules/identity/identity-random-source.js';
import type { NameReservationService } from '../../src/modules/identity/name-reservation.service.js';

class DeterministicRandomSource extends IdentityRandomSource {
  fallbackSuffix(): string {
    return 'abcdef123456';
  }

  index(): number {
    return 0;
  }

  numericSuffix(length: number): string {
    return '7'.repeat(length);
  }
}

function reservation(
  reserve: (displayName: string, guestSessionId: string) => Promise<boolean>,
): NameReservationService {
  return {
    release: vi.fn().mockResolvedValue(undefined),
    reserve,
  } as unknown as NameReservationService;
}

describe('anonymous identity generation', () => {
  it('normalizes leetspeak and rejects embedded profanity', () => {
    expect(normalizeForProfanity('F.u-C_k')).toBe('fuck');
    expect(containsProfanity('BraveSh1tKnight42')).toBe(true);
    expect(containsProfanity('BraveKnight42')).toBe(false);
    expect(
      [...ADJECTIVES, ...NOUNS, ...AVATARS.map((avatar) => avatar.key)].some(
        containsProfanity,
      ),
    ).toBe(false);
  });

  it('uses cryptographic bounded random values for every identity component', () => {
    const random = new CryptoIdentityRandomSource();

    expect(random.index(AVATARS.length)).toBeGreaterThanOrEqual(0);
    expect(random.index(AVATARS.length)).toBeLessThan(AVATARS.length);
    expect(random.numericSuffix(4)).toMatch(/^\d{4}$/);
    expect(random.fallbackSuffix()).toMatch(/^[a-f0-9]{12}$/);
  });

  it('allocates the documented name shape and a catalog avatar key', async () => {
    const service = new IdentityService(
      reservation(vi.fn().mockResolvedValue(true)),
      new DeterministicRandomSource(),
    );

    const identity = await service.generate(
      '9b121189-02ee-48f8-a629-9206497b36bd',
    );

    expect(identity.displayName).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
    expect(AVATARS.map((avatar) => avatar.key)).toContain(identity.avatarKey);
  });

  it('increases suffix entropy after collisions and uses a bounded fallback', async () => {
    const reserve = vi
      .fn<(displayName: string, guestSessionId: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const service = new IdentityService(
      reservation(reserve),
      new DeterministicRandomSource(),
    );

    const identity = await service.generate(
      'f9a4eeed-f52b-4939-a4ab-e58ea1fc1bb9',
    );

    expect(reserve).toHaveBeenCalledTimes(13);
    expect(identity.displayName).toMatch(/abcdef123456$/);
    expect(reserve.mock.calls[4]?.[0].match(/\d+$/)?.[0]).toHaveLength(3);
    expect(reserve.mock.calls[8]?.[0].match(/\d+$/)?.[0]).toHaveLength(4);
  });

  it('fails closed when reservations are unavailable or all candidates collide', async () => {
    const unavailable = new IdentityService(
      reservation(vi.fn().mockRejectedValue(new Error('redis unavailable'))),
      new DeterministicRandomSource(),
    );
    const exhausted = new IdentityService(
      reservation(vi.fn().mockResolvedValue(false)),
      new DeterministicRandomSource(),
    );

    await expect(
      unavailable.generate('f6b6e7c9-456c-45c1-ac42-8bc7d42ca203'),
    ).rejects.toBeInstanceOf(IdentityGenerationError);
    await expect(
      exhausted.generate('64af0dad-bac1-474b-b750-f6b559f5ba31'),
    ).rejects.toBeInstanceOf(IdentityGenerationError);
  });
});
