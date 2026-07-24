import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { toDatabaseError } from './database-errors.js';
import { PrismaService } from './prisma.service.js';

export type TransactionClient = Prisma.TransactionClient;

export interface LockedGameClock {
  blackClockMs: number;
  observedAt: Date;
  status: string;
  turnColor: string;
  turnStartedAt: Date | null;
  version: number;
  whiteClockMs: number;
}

@Injectable()
export class TransactionService {
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.timeoutMs = config.values.DATABASE_TX_TIMEOUT_MS;
  }

  async run<T>(
    work: (transaction: TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = 'ReadCommitted',
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw(
            Prisma.sql`SELECT set_config(
              'statement_timeout',
              ${`${String(this.timeoutMs)}ms`},
              true
            )`,
          );
          return work(transaction);
        },
        {
          isolationLevel,
          maxWait: this.timeoutMs,
          timeout: this.timeoutMs,
        },
      );
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async lockGuestSessions(
    transaction: TransactionClient,
    guestSessionIds: readonly string[],
  ): Promise<void> {
    const sortedIds = [...new Set(guestSessionIds)].sort();
    if (sortedIds.length === 0) {
      return;
    }

    await transaction.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "guest_sessions"
        WHERE "id" IN (${Prisma.join(sortedIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
  }

  async lockGameClock(
    transaction: TransactionClient,
    gameId: string,
  ): Promise<LockedGameClock | null> {
    const rows = await transaction.$queryRaw<LockedGameClock[]>(
      Prisma.sql`
        WITH observation AS MATERIALIZED (
          SELECT clock_timestamp() AS "observedAt"
        )
        SELECT
          game."status",
          game."turn_color" AS "turnColor",
          game."turn_started_at" AS "turnStartedAt",
          game."version",
          CASE
            WHEN game."status" IN ('IN_PROGRESS', 'RECONNECTING')
              AND game."turn_color" = 'w'
              AND game."turn_started_at" IS NOT NULL
            THEN greatest(
              0,
              game."white_clock_ms" -
                floor(
                  extract(
                    epoch FROM (
                      observation."observedAt" - game."turn_started_at"
                    )
                  ) * 1000
                )::INTEGER
            )
            ELSE game."white_clock_ms"
          END AS "whiteClockMs",
          CASE
            WHEN game."status" IN ('IN_PROGRESS', 'RECONNECTING')
              AND game."turn_color" = 'b'
              AND game."turn_started_at" IS NOT NULL
            THEN greatest(
              0,
              game."black_clock_ms" -
                floor(
                  extract(
                    epoch FROM (
                      observation."observedAt" - game."turn_started_at"
                    )
                  ) * 1000
                )::INTEGER
            )
            ELSE game."black_clock_ms"
          END AS "blackClockMs",
          observation."observedAt"
        FROM "games" AS game
        CROSS JOIN observation
        WHERE game."id" = ${gameId}::UUID
        FOR UPDATE OF game
      `,
    );

    return rows[0] ?? null;
  }

  async updateGameAtVersion(
    transaction: TransactionClient,
    gameId: string,
    expectedVersion: number,
    data: Omit<Prisma.GameUpdateManyMutationInput, 'version'>,
  ): Promise<number | null> {
    const result = await transaction.game.updateMany({
      data: {
        ...data,
        version: { increment: 1 },
      },
      where: {
        id: gameId,
        version: expectedVersion,
      },
    });

    return result.count === 1 ? expectedVersion + 1 : null;
  }
}
