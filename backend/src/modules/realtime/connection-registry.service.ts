import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { RealtimeRedisUnavailableError } from './infrastructure/realtime-redis.errors.js';
import { RealtimeError } from './protocol/realtime.errors.js';

@Injectable()
export class ConnectionRegistryService {
  private readonly connectionLimit: number;
  private readonly ttlMs: number;

  constructor(
    private readonly redis: RedisService,
    config: AppConfigService,
  ) {
    this.connectionLimit = config.values.RL_CONNECTIONS_PER_IP;
    this.ttlMs =
      config.values.PRESENCE_TTL_MS + config.values.SOCKET_PING_TIMEOUT_MS;
  }

  addressHash(address: string): string {
    return createHash('sha256').update(address).digest('hex');
  }

  async acquire(
    addressHash: string,
    socketMember: string,
    now = new Date(),
  ): Promise<void> {
    const nowMs = now.getTime();
    try {
      await this.redis.ensureConnected();
      const count = Number(
        await this.redis.connection.eval(
          `
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
            local existing = redis.call('ZSCORE', KEYS[1], ARGV[3])
            local count = redis.call('ZCARD', KEYS[1])
            if not existing and count >= tonumber(ARGV[4]) then
              return -1
            end
            redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
            redis.call('PEXPIRE', KEYS[1], ARGV[5])
            return redis.call('ZCARD', KEYS[1])
          `,
          1,
          this.key(addressHash),
          nowMs,
          nowMs + this.ttlMs,
          socketMember,
          this.connectionLimit,
          this.ttlMs,
        ),
      );
      if (count < 0) {
        throw new RealtimeError(
          'RATE_LIMITED',
          'Connection limit exceeded',
          true,
          { retryAfterMs: this.ttlMs },
        );
      }
    } catch (error) {
      if (error instanceof RealtimeError) {
        throw error;
      }
      throw new RealtimeRedisUnavailableError();
    }
  }

  async refresh(
    addressHash: string,
    socketMember: string,
    now = new Date(),
  ): Promise<void> {
    const nowMs = now.getTime();
    try {
      await this.redis.ensureConnected();
      const results = await this.redis.connection
        .multi()
        .zadd(this.key(addressHash), nowMs + this.ttlMs, socketMember)
        .pexpire(this.key(addressHash), this.ttlMs)
        .exec();
      if (
        results === null ||
        results.some(([error]: [Error | null, unknown]) => error !== null)
      ) {
        throw new Error('Connection registry refresh failed');
      }
    } catch {
      throw new RealtimeRedisUnavailableError();
    }
  }

  async release(addressHash: string, socketMember: string): Promise<void> {
    try {
      await this.redis.ensureConnected();
      await this.redis.connection.zrem(this.key(addressHash), socketMember);
    } catch {
      throw new RealtimeRedisUnavailableError();
    }
  }

  private key(addressHash: string): string {
    return `rl:conn:${addressHash}`;
  }
}
