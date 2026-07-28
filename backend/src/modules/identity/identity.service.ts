import { Injectable } from '@nestjs/common';
import {
  ADJECTIVES,
  AVATARS,
  NOUNS,
  type AvatarKey,
} from './domain/identity.catalogs.js';
import { containsProfanity } from './domain/profanity.js';
import { IdentityRandomSource } from './identity-random-source.js';
import { NameReservationService } from './name-reservation.service.js';

const CANDIDATE_ATTEMPTS = 12;
const FALLBACK_ATTEMPTS = 4;

export interface GeneratedIdentity {
  avatarKey: AvatarKey;
  displayName: string;
}

export class IdentityGenerationError extends Error {
  constructor() {
    super('Anonymous identity could not be allocated');
    this.name = 'IdentityGenerationError';
  }
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly reservations: NameReservationService,
    private readonly random: IdentityRandomSource,
  ) {}

  async generate(guestSessionId: string): Promise<GeneratedIdentity> {
    try {
      for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt += 1) {
        const suffixLength = Math.min(4, 2 + Math.floor(attempt / 4));
        const displayName = `${this.pick(ADJECTIVES)}${this.pick(
          NOUNS,
        )}${this.random.numericSuffix(suffixLength)}`;
        if (
          !containsProfanity(displayName) &&
          (await this.reservations.reserve(displayName, guestSessionId))
        ) {
          return {
            avatarKey: this.pick(AVATARS).key,
            displayName,
          };
        }
      }

      for (let attempt = 0; attempt < FALLBACK_ATTEMPTS; attempt += 1) {
        const displayName = `${this.pick(ADJECTIVES)}${this.pick(
          NOUNS,
        )}${this.random.fallbackSuffix()}`;
        if (
          !containsProfanity(displayName) &&
          (await this.reservations.reserve(displayName, guestSessionId))
        ) {
          return {
            avatarKey: this.pick(AVATARS).key,
            displayName,
          };
        }
      }

      throw new IdentityGenerationError();
    } catch (error) {
      if (error instanceof IdentityGenerationError) {
        throw error;
      }
      throw new IdentityGenerationError();
    }
  }

  async release(
    identity: GeneratedIdentity,
    guestSessionId: string,
  ): Promise<void> {
    await this.reservations.release(identity.displayName, guestSessionId);
  }

  private pick<T>(catalog: readonly T[]): T {
    const item = catalog[this.random.index(catalog.length)];
    if (item === undefined) {
      throw new IdentityGenerationError();
    }
    return item;
  }
}
