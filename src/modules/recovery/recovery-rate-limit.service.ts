import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { RecoveryError } from './recovery.errors.js';

type RecoveryPolicy = 'active' | 'snapshot';

interface PolicyConfiguration {
  readonly limit: number;
  readonly windowMs: number;
}

@Injectable()
export class RecoveryRateLimitService {
  private readonly logger = new Logger(RecoveryRateLimitService.name);
  private readonly policies: Readonly<
    Record<RecoveryPolicy, PolicyConfiguration>
  >;

  constructor(
    config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly redis: RedisService,
  ) {
    this.policies = {
      active: {
        limit: config.values.RL_SESSION_GET_LIMIT,
        windowMs: config.values.RL_SESSION_GET_WINDOW_MS,
      },
      snapshot: {
        limit: config.values.RL_SYNC_LIMIT,
        windowMs: config.values.RL_SYNC_WINDOW_MS,
      },
    };
  }

  async consume(policy: RecoveryPolicy, guestSessionId: string): Promise<void> {
    const configuration = this.policies[policy];
    const identifier = createHash('sha256')
      .update(guestSessionId)
      .digest('hex');
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
        `rl:recovery:${policy}:${identifier}`,
        configuration.windowMs,
      )) as [number, number];
      if (count > configuration.limit) {
        throw new RecoveryError(
          'RATE_LIMITED',
          'Recovery request rate limit exceeded',
          true,
          Math.max(1, ttl),
        );
      }
    } catch (error) {
      if (error instanceof RecoveryError) {
        throw error;
      }
      this.metrics.increment(
        'cluchess_redis_errors_total',
        'Redis operation errors by operation.',
        { op: 'recovery_rate_limit' },
      );
      this.logger.warn('Recovery rate limiter is temporarily failing open');
    }
  }
}
