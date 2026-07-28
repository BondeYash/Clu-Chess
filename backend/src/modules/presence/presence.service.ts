import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { RealtimeRedisUnavailableError } from '../realtime/infrastructure/realtime-redis.errors.js';

@Injectable()
export class PresenceService {
  private readonly keyTtlMs: number;
  private readonly presenceTtlMs: number;
  private readonly queueGuardTtlMs: number;

  constructor(
    private readonly redis: RedisService,
    config: AppConfigService,
  ) {
    this.presenceTtlMs = config.values.PRESENCE_TTL_MS;
    this.queueGuardTtlMs = config.values.QUEUE_GUARD_TTL_MS;
    this.keyTtlMs = this.presenceTtlMs + config.values.SOCKET_PING_TIMEOUT_MS;
  }

  get expiresInMs(): number {
    return this.presenceTtlMs;
  }

  async markConnected(
    guestSessionId: string,
    socketMember: string,
    now = new Date(),
  ): Promise<number> {
    return this.refresh(guestSessionId, socketMember, now);
  }

  async refresh(
    guestSessionId: string,
    socketMember: string,
    now = new Date(),
  ): Promise<number> {
    const nowMs = now.getTime();
    try {
      await this.redis.ensureConnected();
      return Number(
        await this.redis.connection.eval(
          `
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
            redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
            redis.call('PEXPIRE', KEYS[1], ARGV[4])
            if redis.call('EXISTS', KEYS[2]) == 1 then
              redis.call('PEXPIRE', KEYS[2], ARGV[5])
            end
            return redis.call('ZCARD', KEYS[1])
          `,
          2,
          this.key(guestSessionId),
          `mm:queued:${guestSessionId}`,
          nowMs,
          nowMs + this.presenceTtlMs,
          socketMember,
          this.keyTtlMs,
          this.queueGuardTtlMs,
        ),
      );
    } catch {
      throw new RealtimeRedisUnavailableError();
    }
  }

  async remove(
    guestSessionId: string,
    socketMember: string,
    now = new Date(),
  ): Promise<number> {
    try {
      await this.redis.ensureConnected();
      return Number(
        await this.redis.connection.eval(
          `
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
            redis.call('ZREM', KEYS[1], ARGV[2])
            local count = redis.call('ZCARD', KEYS[1])
            if count == 0 then
              redis.call('DEL', KEYS[1])
            end
            return count
          `,
          1,
          this.key(guestSessionId),
          now.getTime(),
          socketMember,
        ),
      );
    } catch {
      throw new RealtimeRedisUnavailableError();
    }
  }

  async count(guestSessionId: string, now = new Date()): Promise<number> {
    try {
      await this.redis.ensureConnected();
      return Number(
        await this.redis.connection.eval(
          `
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
            local count = redis.call('ZCARD', KEYS[1])
            if count == 0 then
              redis.call('DEL', KEYS[1])
            end
            return count
          `,
          1,
          this.key(guestSessionId),
          now.getTime(),
        ),
      );
    } catch {
      throw new RealtimeRedisUnavailableError();
    }
  }

  async isPresent(guestSessionId: string, now = new Date()): Promise<boolean> {
    return (await this.count(guestSessionId, now)) > 0;
  }

  private key(guestSessionId: string): string {
    return `presence:${guestSessionId}`;
  }
}
