import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import type { ClientEventName } from './protocol/protocol.constants.js';
import { RealtimeError } from './protocol/realtime.errors.js';

interface RateLimitPolicy {
  limit: number;
  scope: 'move' | 'queue' | 'sync';
  windowMs: number;
}

@Injectable()
export class RealtimeRateLimitService {
  private readonly logger = new Logger(RealtimeRateLimitService.name);
  private readonly policies: Readonly<Record<ClientEventName, RateLimitPolicy>>;

  constructor(
    private readonly redis: RedisService,
    config: AppConfigService,
  ) {
    const queue = {
      limit: config.values.RL_QUEUE_LIMIT,
      scope: 'queue',
      windowMs: config.values.RL_QUEUE_WINDOW_MS,
    } as const;
    const move = {
      limit: config.values.RL_MOVE_LIMIT,
      scope: 'move',
      windowMs: config.values.RL_MOVE_WINDOW_MS,
    } as const;
    const sync = {
      limit: config.values.RL_SYNC_LIMIT,
      scope: 'sync',
      windowMs: config.values.RL_SYNC_WINDOW_MS,
    } as const;
    this.policies = Object.freeze({
      'game.ready': sync,
      'game.resign': move,
      'game.sync': sync,
      'heartbeat.ping': sync,
      'move.submit': move,
      'queue.join': queue,
      'queue.leave': queue,
    });
  }

  async consume(
    eventName: ClientEventName,
    guestSessionId: string,
  ): Promise<void> {
    const policy = this.policies[eventName];
    try {
      await this.redis.ensureConnected();
      const [count, ttl] = (await this.redis.connection.eval(
        `
          local count = redis.call('INCR', KEYS[1])
          if count == 1 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
          end
          return {count, redis.call('PTTL', KEYS[1])}
        `,
        1,
        `rl:${policy.scope}:${guestSessionId}`,
        policy.windowMs,
      )) as [number, number];
      if (count > policy.limit) {
        throw new RealtimeError(
          'RATE_LIMITED',
          'Socket command rate limit exceeded',
          true,
          { retryAfterMs: Math.max(1, ttl) },
        );
      }
    } catch (error) {
      if (error instanceof RealtimeError) {
        throw error;
      }
      this.logger.warn(
        'Realtime command rate limiter is temporarily failing open',
      );
    }
  }
}
