import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AppConfigService } from '../../src/common/config/app-config.service.js';
import { MetricsService } from '../../src/common/metrics/metrics.service.js';
import { RedisService } from '../../src/common/redis/redis.service.js';
import { TelemetryService } from '../../src/common/telemetry/telemetry.service.js';
import { GameAllocationService } from '../../src/modules/game/game-allocation.service.js';
import type { MatchReservation } from '../../src/modules/matchmaking/domain/matchmaking.types.js';
import { MatchmakingScriptService } from '../../src/modules/matchmaking/infrastructure/matchmaking-script.service.js';
import { MatchmakingService } from '../../src/modules/matchmaking/matchmaking.service.js';
import { PresenceService } from '../../src/modules/presence/presence.service.js';
import {
  createGuestSession,
  createPool,
  truncateApplicationTables,
} from './support/database.js';

describe('atomic matchmaking and durable allocation', () => {
  let allocations: GameAllocationService;
  let app: INestApplicationContext;
  let matchmaking: MatchmakingService;
  let pool: Pool;
  let presence: PresenceService;
  let redis: RedisService;
  let scripts: MatchmakingScriptService;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    allocations = app.get(GameAllocationService);
    matchmaking = app.get(MatchmakingService);
    pool = createPool();
    presence = app.get(PresenceService);
    redis = app.get(RedisService);
    scripts = app.get(MatchmakingScriptService);
    await redis.ensureConnected();
  });

  beforeEach(async () => {
    await truncateApplicationTables(pool);
    await redis.connection.flushdb();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('keeps Lua queue operations atomic, fair, validated, and reloadable', async () => {
    const now = Date.now();
    const disconnected = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    await Promise.all([
      presence.markConnected(first, 'instance-a:first', new Date(now)),
      presence.markConnected(second, 'instance-b:second', new Date(now)),
    ]);

    await scripts.enqueue(disconnected, 'blitz', now - 30);
    const initial = await scripts.enqueue(first, 'blitz', now - 20);
    await redis.connection.script('FLUSH');
    const duplicate = await scripts.enqueue(first, 'blitz', now);
    await scripts.enqueue(second, 'blitz', now - 10);

    expect(initial).toMatchObject({ duplicate: false, since: now - 20 });
    expect(duplicate).toMatchObject({ duplicate: true, since: now - 20 });
    expect(await redis.connection.zscore('mm:queue:blitz', first)).toBe(
      String(now - 20),
    );
    expect(await redis.connection.pttl(`mm:queued:${first}`)).toBeGreaterThan(
      100_000,
    );
    expect(await redis.connection.pttl(`user:${first}:state`)).toBeGreaterThan(
      3_500_000,
    );

    const attempt = await scripts.tryMatch(
      'blitz',
      randomUUID(),
      randomUUID(),
      now,
      10,
    );
    expect(attempt.discarded).toEqual([
      { guestSessionId: disconnected, reason: 'disconnected' },
    ]);
    expect(attempt.reservation).toMatchObject({
      a: first,
      aScore: now - 20,
      b: second,
      bScore: now - 10,
    });
    const reservation = requiredReservation(attempt.reservation);
    expect(
      await redis.connection.pttl(`match:${reservation.matchId}:reservation`),
    ).toBeGreaterThan(20_000);
    expect(await redis.connection.get(`user:${first}:state`)).toBe('RESERVED');
    expect(await redis.connection.get(`user:${second}:state`)).toBe('RESERVED');

    await expect(
      scripts.finalize({ ...reservation, gameId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'RESERVATION_MISMATCH' });
    await expect(scripts.finalize(reservation)).resolves.toBe(true);
    await expect(scripts.finalize(reservation)).resolves.toBe(false);
    expect(await redis.connection.get(`user:${first}:active-game`)).toBe(
      reservation.gameId,
    );
    expect(await redis.connection.get(`user:${second}:active-game`)).toBe(
      reservation.gameId,
    );
    expect(await scripts.leave(first, 'blitz')).toEqual({
      left: false,
      status: 'LEFT',
    });
  });

  it('never matches one queue member with itself and makes leave idempotent', async () => {
    const guest = randomUUID();
    const now = Date.now();
    await presence.markConnected(guest, 'instance:socket', new Date(now));
    await scripts.enqueue(guest, 'blitz', now);

    const attempt = await scripts.tryMatch(
      'blitz',
      randomUUID(),
      randomUUID(),
      now,
      10,
    );
    expect(attempt.reservation).toBeNull();
    expect(await scripts.queueSize('blitz')).toBe(1);
    await expect(scripts.leave(guest, 'blitz')).resolves.toMatchObject({
      left: true,
    });
    await expect(scripts.leave(guest, 'blitz')).resolves.toMatchObject({
      left: false,
    });
  });

  it('sweeps timed-out, disconnected, and inconsistent queue entries', async () => {
    const now = Date.now();
    const timedOut = randomUUID();
    const disconnected = randomUUID();
    const stale = randomUUID();
    await Promise.all([
      presence.markConnected(timedOut, 'instance:timed-out', new Date(now)),
      presence.markConnected(stale, 'instance:stale', new Date(now)),
    ]);
    await scripts.enqueue(timedOut, 'blitz', now - 120_001);
    await scripts.enqueue(disconnected, 'blitz', now - 2);
    await scripts.enqueue(stale, 'blitz', now - 1);
    await redis.connection.del(`mm:queued:${stale}`);

    const removed = await scripts.sweep('blitz', now, 10);
    expect(removed).toHaveLength(3);
    expect(removed).toEqual(
      expect.arrayContaining([
        { guestSessionId: timedOut, reason: 'timeout' },
        { guestSessionId: disconnected, reason: 'disconnected' },
        { guestSessionId: stale, reason: 'stale' },
      ]),
    );
    expect(await scripts.queueSize('blitz')).toBe(0);
  });

  it('rolls reservations back only to eligible present guests at fair scores', async () => {
    const now = Date.now();
    const assigned = randomUUID();
    const waiting = randomUUID();
    const durableGameId = randomUUID();
    await Promise.all([
      presence.markConnected(assigned, 'instance:assigned', new Date(now)),
      presence.markConnected(waiting, 'instance:waiting', new Date(now)),
    ]);
    await scripts.enqueue(assigned, 'blitz', now - 20);
    await scripts.enqueue(waiting, 'blitz', now - 10);
    const attempt = await scripts.tryMatch(
      'blitz',
      randomUUID(),
      randomUUID(),
      now,
      10,
    );
    const reservation = requiredReservation(attempt.reservation);

    await expect(
      scripts.rollback(
        { ...reservation, matchId: randomUUID() },
        {
          a: { activeGameId: durableGameId, eligible: true },
          b: { activeGameId: null, eligible: true },
        },
        now,
      ),
    ).rejects.toMatchObject({ code: 'RESERVATION_MISMATCH' });

    const result = await scripts.rollback(
      reservation,
      {
        a: { activeGameId: durableGameId, eligible: true },
        b: { activeGameId: null, eligible: true },
      },
      now,
    );
    expect(result.requeued).toEqual([
      { guestSessionId: waiting, since: now - 10 },
    ]);
    expect(await redis.connection.get(`user:${assigned}:state`)).toBe(
      'IN_GAME',
    );
    expect(await redis.connection.get(`user:${assigned}:active-game`)).toBe(
      durableGameId,
    );
    expect(await redis.connection.zscore('mm:queue:blitz', waiting)).toBe(
      String(now - 10),
    );
    await expect(
      scripts.rollback(
        reservation,
        {
          a: { activeGameId: durableGameId, eligible: true },
          b: { activeGameId: null, eligible: true },
        },
        now,
      ),
    ).resolves.toEqual({ requeued: [] });
    await scripts.leave(waiting, 'blitz');

    const disconnectedA = randomUUID();
    const disconnectedB = randomUUID();
    await presence.markConnected(
      disconnectedA,
      'instance:disconnected-a',
      new Date(now),
    );
    await presence.markConnected(
      disconnectedB,
      'instance:disconnected-b',
      new Date(now),
    );
    await scripts.enqueue(disconnectedA, 'blitz', now + 10);
    await scripts.enqueue(disconnectedB, 'blitz', now + 20);
    const disconnectedAttempt = await scripts.tryMatch(
      'blitz',
      randomUUID(),
      randomUUID(),
      now,
      10,
    );
    const disconnectedReservation = requiredReservation(
      disconnectedAttempt.reservation,
    );
    await presence.remove(
      disconnectedB,
      'instance:disconnected-b',
      new Date(now),
    );
    const disconnectedRollback = await scripts.rollback(
      disconnectedReservation,
      {
        a: { activeGameId: null, eligible: true },
        b: { activeGameId: null, eligible: true },
      },
      now,
    );
    expect(disconnectedRollback.requeued).toEqual([
      { guestSessionId: disconnectedA, since: now + 10 },
    ]);
    expect(
      await redis.connection.zscore('mm:queue:blitz', disconnectedB),
    ).toBeNull();
  });

  it('prevents guest reuse under parallel drains from independent services', async () => {
    const now = new Date();
    const guests = await Promise.all([
      createGuestSession(pool, 'parallel-a'),
      createGuestSession(pool, 'parallel-b'),
      createGuestSession(pool, 'parallel-c'),
      createGuestSession(pool, 'parallel-d'),
    ]);
    await Promise.all(
      guests.map((guestSessionId, index) =>
        presence.markConnected(
          guestSessionId,
          `instance:${String(index)}`,
          now,
        ),
      ),
    );
    await Promise.all(
      guests.map((guestSessionId, index) =>
        scripts.enqueue(guestSessionId, 'blitz', now.getTime() + index),
      ),
    );

    const secondScripts = new MatchmakingScriptService(
      redis,
      app.get(AppConfigService),
    );
    const secondInstance = new MatchmakingService(
      allocations,
      app.get(MetricsService),
      presence,
      secondScripts,
      app.get(TelemetryService),
      app.get(AppConfigService),
    );
    const effects = await Promise.all([
      matchmaking.drain('blitz', now),
      secondInstance.drain('blitz', now),
    ]);
    expect(effects.flatMap((effect) => effect.allocations)).toHaveLength(2);

    const audit = await pool.query<{
      assignments: number;
      games: number;
      players: number;
    }>(
      `
        SELECT
          (SELECT count(*)::int FROM games) AS games,
          (SELECT count(*)::int FROM game_players) AS players,
          (
            SELECT count(DISTINCT guest_session_id)::int
            FROM active_game_assignments
          ) AS assignments
      `,
    );
    expect(audit.rows).toEqual([{ assignments: 4, games: 2, players: 4 }]);
    expect(await scripts.queueSize('blitz')).toBe(0);
  });

  it('recovers the same committed game after a crash before Redis finalize', async () => {
    const observedAt = new Date();
    const first = await createGuestSession(pool, 'crash-a');
    const second = await createGuestSession(pool, 'crash-b');
    await Promise.all([
      presence.markConnected(first, 'instance:crash-a', observedAt),
      presence.markConnected(second, 'instance:crash-b', observedAt),
    ]);
    await scripts.enqueue(first, 'blitz', observedAt.getTime() - 2);
    await scripts.enqueue(second, 'blitz', observedAt.getTime() - 1);
    const attempt = await scripts.tryMatch(
      'blitz',
      randomUUID(),
      randomUUID(),
      observedAt.getTime(),
      10,
    );
    const reservation = requiredReservation(attempt.reservation);
    const committed = await allocations.allocate(reservation, observedAt);
    const repeated = await allocations.allocate(reservation, observedAt);
    expect(repeated.game.id).toBe(committed.game.id);
    expect(repeated.players).toEqual(committed.players);

    const recovered = await matchmaking.reconcile(observedAt);
    expect(recovered.allocations.map((item) => item.game.id)).toContain(
      committed.game.id,
    );
    expect(
      await redis.connection.exists(`match:${reservation.matchId}:reservation`),
    ).toBe(0);
    expect(await redis.connection.get(`user:${first}:active-game`)).toBe(
      committed.game.id,
    );
    expect(await redis.connection.get(`user:${second}:active-game`)).toBe(
      committed.game.id,
    );

    await redis.connection.flushdb();
    await expect(
      matchmaking.join(first, 'blitz', observedAt),
    ).rejects.toMatchObject({ code: 'ALREADY_IN_GAME' });
    const repaired = await matchmaking.reconcile(observedAt);
    expect(repaired.allocations.map((item) => item.game.id)).toEqual([
      committed.game.id,
    ]);
    expect(await redis.connection.get(`user:${first}:active-game`)).toBe(
      committed.game.id,
    );
  });

  it('restores durable assignees and requeues only the unassigned peer', async () => {
    const observedAt = new Date();
    const assigned = await createGuestSession(pool, 'failure-assigned');
    const waiting = await createGuestSession(pool, 'failure-waiting');
    const existingOpponent = await createGuestSession(pool, 'failure-opponent');
    await Promise.all([
      presence.markConnected(assigned, 'instance:assigned', observedAt),
      presence.markConnected(waiting, 'instance:waiting', observedAt),
      presence.markConnected(
        existingOpponent,
        'instance:existing-opponent',
        observedAt,
      ),
    ]);

    const existingReservation = reservation(
      assigned,
      existingOpponent,
      observedAt.getTime() - 100,
    );
    const existing = await allocations.allocate(
      existingReservation,
      observedAt,
    );
    await scripts.enqueue(assigned, 'blitz', observedAt.getTime() - 20);
    await scripts.enqueue(waiting, 'blitz', observedAt.getTime() - 10);
    const failedAttempt = await scripts.tryMatch(
      'blitz',
      randomUUID(),
      randomUUID(),
      observedAt.getTime(),
      10,
    );
    const failedReservation = requiredReservation(failedAttempt.reservation);

    const effects = await matchmaking.reconcile(observedAt);
    expect(effects.requeued).toEqual([
      {
        guestSessionId: waiting,
        since: failedReservation.bScore,
      },
    ]);
    expect(await redis.connection.get(`user:${assigned}:active-game`)).toBe(
      existing.game.id,
    );
    expect(
      await redis.connection.zscore('mm:queue:blitz', assigned),
    ).toBeNull();
    expect(await redis.connection.zscore('mm:queue:blitz', waiting)).toBe(
      String(failedReservation.bScore),
    );
  });
});

function requiredReservation(value: MatchReservation | null): MatchReservation {
  if (value === null) {
    throw new Error('Expected Redis to reserve a match');
  }
  return value;
}

function reservation(
  a: string,
  b: string,
  createdAt: number,
): MatchReservation {
  return {
    a,
    aScore: createdAt,
    b,
    bScore: createdAt + 1,
    createdAt,
    gameId: randomUUID(),
    matchId: randomUUID(),
    mode: 'blitz',
  };
}
