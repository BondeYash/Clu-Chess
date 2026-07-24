import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { DependencyCheck } from '../../common/redis/redis.service.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PostgresHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        status: 'up',
      };
    } catch {
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        status: 'down',
      };
    }
  }
}
