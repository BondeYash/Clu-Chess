import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { SessionError } from './session.errors.js';

export type SessionRateLimitPolicy = 'create' | 'get' | 'renew' | 'reset';

interface RateLimitConfiguration {
  limit: number;
  windowMs: number;
}

@Injectable()
export class SessionRateLimitService {
  private readonly policies: Readonly<
    Record<SessionRateLimitPolicy, RateLimitConfiguration>
  >;

  constructor(
    private readonly redis: RedisService,
    config: AppConfigService,
  ) {
    this.policies = Object.freeze({
      create: {
        limit: config.values.RL_SESSION_CREATE_LIMIT,
        windowMs: config.values.RL_SESSION_CREATE_WINDOW_MS,
      },
      get: {
        limit: config.values.RL_SESSION_GET_LIMIT,
        windowMs: config.values.RL_SESSION_GET_WINDOW_MS,
      },
      renew: {
        limit: config.values.RL_SESSION_RENEW_LIMIT,
        windowMs: config.values.RL_SESSION_RENEW_WINDOW_MS,
      },
      reset: {
        limit: config.values.RL_SESSION_RESET_LIMIT,
        windowMs: config.values.RL_SESSION_RESET_WINDOW_MS,
      },
    });
  }

  async consume(
    policy: SessionRateLimitPolicy,
    identifier: string,
  ): Promise<void> {
    const configuration = this.policies[policy];
    const safeIdentifier = createHash('sha256')
      .update(identifier)
      .digest('hex');
    try {
      await this.redis.ensureConnected();
      const result = (await this.redis.connection.eval(
        `
          local count = redis.call('INCR', KEYS[1])
          if count == 1 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
          end
          local ttl = redis.call('PTTL', KEYS[1])
          return {count, ttl}
        `,
        1,
        `rl:session:${policy}:${safeIdentifier}`,
        configuration.windowMs,
      )) as [number, number];
      const [count, ttl] = result;
      if (count > configuration.limit) {
        throw new SessionError(
          'RATE_LIMITED',
          'Session request rate limit exceeded',
          true,
          Math.max(1, ttl),
        );
      }
    } catch (error) {
      if (error instanceof SessionError) {
        throw error;
      }
      throw new SessionError(
        'SERVICE_UNAVAILABLE',
        'Session service is temporarily unavailable',
        true,
      );
    }
  }
}
