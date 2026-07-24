import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service.js';

const RESERVATION_SECONDS = 86_400;

@Injectable()
export class NameReservationService {
  constructor(private readonly redis: RedisService) {}

  async reserve(displayName: string, guestSessionId: string): Promise<boolean> {
    await this.redis.ensureConnected();
    const result = await this.redis.connection.set(
      this.key(displayName),
      guestSessionId,
      'EX',
      RESERVATION_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  async release(displayName: string, guestSessionId: string): Promise<void> {
    await this.redis.ensureConnected();
    await this.redis.connection.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      1,
      this.key(displayName),
      guestSessionId,
    );
  }

  private key(displayName: string): string {
    return `name:taken:${displayName.toLowerCase()}`;
  }
}
