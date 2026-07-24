import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppConfigService } from '../../src/common/config/app-config.service.js';
import { parseEnvironment } from '../../src/common/config/config.schema.js';
import { DatabaseError } from '../../src/modules/persistence/database-errors.js';
import { PrismaService } from '../../src/modules/persistence/prisma.service.js';
import { TransactionService } from '../../src/modules/persistence/transaction.service.js';
import {
  allocateGame,
  createGuestSession,
  createPool,
  truncateApplicationTables,
} from './support/database.js';

describe('transaction utilities', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let transactions: TransactionService;

  beforeAll(async () => {
    pool = createPool();
    const config = new AppConfigService(parseEnvironment(process.env));
    prisma = new PrismaService(config);
    transactions = new TransactionService(prisma, config);
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await truncateApplicationTables(pool);
  });

  afterAll(async () => {
    await prisma.onApplicationShutdown();
    await pool.end();
  });

  it('locks a game with one database clock observation', async () => {
    const allocation = await allocateGame(pool);
    const game = await transactions.run((transaction) =>
      transactions.lockGameClock(transaction, allocation.gameId),
    );

    expect(game).toMatchObject({
      blackClockMs: 300_000,
      status: 'CREATED',
      turnColor: 'w',
      turnStartedAt: null,
      version: 0,
      whiteClockMs: 300_000,
    });
    expect(game?.observedAt).toBeInstanceOf(Date);
  });

  it('applies an optimistic update exactly once', async () => {
    const allocation = await allocateGame(pool);
    const firstVersion = await transactions.run((transaction) =>
      transactions.updateGameAtVersion(transaction, allocation.gameId, 0, {
        currentFen: 'after-e4',
      }),
    );
    const staleVersion = await transactions.run((transaction) =>
      transactions.updateGameAtVersion(transaction, allocation.gameId, 0, {
        currentFen: 'stale-write',
      }),
    );

    expect(firstVersion).toBe(1);
    expect(staleVersion).toBeNull();
    const persisted = await pool.query<{
      current_fen: string;
      version: number;
    }>('SELECT current_fen, version FROM games WHERE id = $1', [
      allocation.gameId,
    ]);
    expect(persisted.rows[0]).toEqual({
      current_fen: 'after-e4',
      version: 1,
    });
  });

  it('maps transaction failures without exposing database details', async () => {
    await createGuestSession(pool, 'duplicate');

    try {
      await transactions.run(async (transaction) => {
        await transaction.guestSession.create({
          data: {
            avatarKey: 'pawn',
            displayName: 'guest-DUPLICATE',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toMatchObject({ kind: 'unique', retryable: false });
      expect((error as Error).message).not.toContain('guest_sessions');
      return;
    }

    throw new Error('Expected a stable unique database error');
  });
});
