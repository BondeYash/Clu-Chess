import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppConfigService } from '../../../common/config/app-config.service.js';
import { RedisService } from '../../../common/redis/redis.service.js';
import { MatchmakingError } from '../domain/matchmaking.errors.js';
import type {
  MatchAttempt,
  MatchMode,
  MatchReservation,
  QueueJoin,
  QueueLeave,
  RemovedQueueGuest,
  RollbackResult,
} from '../domain/matchmaking.types.js';

const SCRIPT_FILES = {
  enqueue: 'enqueue.lua',
  finalize: 'finalize.lua',
  leave: 'leave.lua',
  repairCommitted: 'repair-committed.lua',
  rollback: 'rollback.lua',
  sweep: 'sweep.lua',
  tryMatch: 'try-match.lua',
} as const;

type ScriptName = keyof typeof SCRIPT_FILES;

const removedGuestSchema = z
  .object({
    guestSessionId: z.uuid(),
    reason: z.enum(['disconnected', 'stale', 'timeout']),
  })
  .strict();

const reservationSchema = z
  .object({
    a: z.uuid(),
    aScore: z.number().int().nonnegative(),
    b: z.uuid(),
    bScore: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    gameId: z.uuidv4(),
    matchId: z.uuidv4(),
    mode: z.literal('blitz'),
  })
  .strict();

const enqueueResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      code: z.literal('ALREADY_IN_GAME'),
      status: z.literal('ERROR'),
    })
    .strict(),
  z
    .object({
      duplicate: z.boolean(),
      position: z.number().int().positive(),
      since: z.number().int().nonnegative(),
      status: z.literal('QUEUED'),
    })
    .strict(),
]);

const leaveResponseSchema = z
  .object({ left: z.boolean(), status: z.literal('LEFT') })
  .strict();

const matchResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      code: z.literal('RESERVATION_MISMATCH'),
      status: z.literal('ERROR'),
    })
    .strict(),
  z
    .object({
      discarded: z.array(removedGuestSchema).optional(),
      status: z.literal('NO_MATCH'),
    })
    .strict(),
  z
    .object({
      discarded: z.array(removedGuestSchema).optional(),
      reservation: reservationSchema,
      status: z.literal('MATCHED'),
    })
    .strict(),
]);

const finalizeResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      code: z.literal('RESERVATION_MISMATCH'),
      status: z.literal('ERROR'),
    })
    .strict(),
  z
    .object({
      duplicate: z.boolean(),
      status: z.literal('FINALIZED'),
    })
    .strict(),
]);

const rollbackResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      code: z.literal('RESERVATION_MISMATCH'),
      status: z.literal('ERROR'),
    })
    .strict(),
  z
    .object({
      requeued: z
        .array(
          z
            .object({
              guestSessionId: z.uuid(),
              since: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .optional(),
      status: z.literal('ROLLED_BACK'),
    })
    .strict(),
]);

const sweepResponseSchema = z
  .object({
    removed: z.array(removedGuestSchema).optional(),
    status: z.literal('SWEPT'),
  })
  .strict();

const repairResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      code: z.literal('RESERVATION_MISMATCH'),
      status: z.literal('ERROR'),
    })
    .strict(),
  z
    .object({
      changed: z.boolean(),
      status: z.literal('REPAIRED'),
    })
    .strict(),
]);

@Injectable()
export class MatchmakingScriptService {
  private readonly guardTtlMs: number;
  private readonly maxWaitMs: number;
  private readonly reservationTtlMs: number;
  private readonly sources: Readonly<Record<ScriptName, string>>;
  private readonly stateTtlMs: number;
  private readonly scriptHashes = new Map<ScriptName, string>();

  constructor(
    private readonly redis: RedisService,
    config: AppConfigService,
  ) {
    this.guardTtlMs = config.values.QUEUE_GUARD_TTL_MS;
    this.maxWaitMs = config.values.QUEUE_MAX_WAIT_MS;
    this.reservationTtlMs = config.values.RESERVATION_TTL_MS;
    this.stateTtlMs = config.values.MATCH_STATE_TTL_MS;
    this.sources = Object.fromEntries(
      Object.entries(SCRIPT_FILES).map(([name, filename]) => [
        name,
        this.readScript(filename),
      ]),
    ) as Record<ScriptName, string>;
  }

  async enqueue(
    guestSessionId: string,
    mode: MatchMode,
    nowMs: number,
  ): Promise<QueueJoin> {
    const response = await this.execute(
      'enqueue',
      [
        this.queueKey(mode),
        this.guardKey(guestSessionId),
        this.stateKey(guestSessionId),
        this.activeGameKey(guestSessionId),
      ],
      [
        guestSessionId,
        mode,
        String(nowMs),
        String(this.guardTtlMs),
        String(this.stateTtlMs),
      ],
      enqueueResponseSchema,
    );

    if (response.status === 'ERROR') {
      throw new MatchmakingError(
        response.code,
        'The guest already has an active or reserved game.',
        false,
      );
    }

    return response;
  }

  async leave(guestSessionId: string, mode: MatchMode): Promise<QueueLeave> {
    return this.execute(
      'leave',
      [
        this.queueKey(mode),
        this.guardKey(guestSessionId),
        this.stateKey(guestSessionId),
        this.activeGameKey(guestSessionId),
      ],
      [guestSessionId, String(this.stateTtlMs)],
      leaveResponseSchema,
    );
  }

  async tryMatch(
    mode: MatchMode,
    matchId: string,
    gameId: string,
    nowMs: number,
    maxScan: number,
  ): Promise<MatchAttempt> {
    const response = await this.execute(
      'tryMatch',
      [this.queueKey(mode), this.reservationKey(matchId)],
      [
        mode,
        String(nowMs),
        String(this.maxWaitMs),
        matchId,
        gameId,
        String(this.reservationTtlMs),
        String(this.guardTtlMs),
        'mm:queued:',
        'user:',
        'user:',
        'presence:',
        String(maxScan),
      ],
      matchResponseSchema,
    );

    if (response.status === 'ERROR') {
      throw this.reservationMismatch();
    }

    return {
      discarded: response.discarded ?? [],
      reservation: response.status === 'MATCHED' ? response.reservation : null,
    };
  }

  async finalize(reservation: MatchReservation): Promise<boolean> {
    const response = await this.execute(
      'finalize',
      [
        this.reservationKey(reservation.matchId),
        this.guardKey(reservation.a),
        this.stateKey(reservation.a),
        this.activeGameKey(reservation.a),
        this.stateKey(reservation.b),
        this.activeGameKey(reservation.b),
        this.guardKey(reservation.b),
      ],
      [
        reservation.matchId,
        reservation.a,
        reservation.b,
        reservation.gameId,
        String(this.stateTtlMs),
      ],
      finalizeResponseSchema,
    );

    if (response.status === 'ERROR') {
      throw this.reservationMismatch();
    }
    return !response.duplicate;
  }

  async rollback(
    reservation: MatchReservation,
    durable: Readonly<{
      a: Readonly<{ activeGameId: string | null; eligible: boolean }>;
      b: Readonly<{ activeGameId: string | null; eligible: boolean }>;
    }>,
    nowMs: number,
  ): Promise<RollbackResult> {
    const response = await this.execute(
      'rollback',
      [
        this.queueKey(reservation.mode),
        this.reservationKey(reservation.matchId),
        this.stateKey(reservation.a),
        this.activeGameKey(reservation.a),
        this.guardKey(reservation.a),
        this.presenceKey(reservation.a),
        this.stateKey(reservation.b),
        this.activeGameKey(reservation.b),
        this.guardKey(reservation.b),
        this.presenceKey(reservation.b),
      ],
      [
        reservation.matchId,
        reservation.a,
        reservation.b,
        reservation.gameId,
        reservation.mode,
        String(reservation.aScore),
        String(reservation.bScore),
        String(nowMs),
        String(this.guardTtlMs),
        String(this.stateTtlMs),
        durable.a.activeGameId ?? '',
        durable.b.activeGameId ?? '',
        durable.a.eligible ? '1' : '0',
        durable.b.eligible ? '1' : '0',
      ],
      rollbackResponseSchema,
    );

    if (response.status === 'ERROR') {
      throw this.reservationMismatch();
    }
    return { requeued: response.requeued ?? [] };
  }

  async sweep(
    mode: MatchMode,
    nowMs: number,
    batchSize: number,
  ): Promise<readonly RemovedQueueGuest[]> {
    const response = await this.execute(
      'sweep',
      [this.queueKey(mode)],
      [
        String(nowMs),
        String(this.maxWaitMs),
        String(batchSize),
        mode,
        'mm:queued:',
        'user:',
        'user:',
        'presence:',
        String(this.stateTtlMs),
      ],
      sweepResponseSchema,
    );
    return response.removed ?? [];
  }

  async repairCommitted(
    mode: MatchMode,
    gameId: string,
    a: string,
    b: string,
  ): Promise<boolean> {
    const response = await this.execute(
      'repairCommitted',
      [
        this.stateKey(a),
        this.activeGameKey(a),
        this.stateKey(b),
        this.activeGameKey(b),
        this.queueKey(mode),
        this.guardKey(a),
        this.guardKey(b),
      ],
      [gameId, String(this.stateTtlMs), a, b],
      repairResponseSchema,
    );

    if (response.status === 'ERROR') {
      throw this.reservationMismatch();
    }
    return response.changed;
  }

  async queueSize(mode: MatchMode): Promise<number> {
    try {
      await this.redis.ensureConnected();
      return await this.redis.connection.zcard(this.queueKey(mode));
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  async listReservations(limit: number): Promise<readonly MatchReservation[]> {
    try {
      await this.redis.ensureConnected();
      const reservations: MatchReservation[] = [];
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.connection.scan(
          cursor,
          'MATCH',
          'match:*:reservation',
          'COUNT',
          Math.max(limit, 10),
        );
        cursor = nextCursor;
        for (const key of keys) {
          const values = await this.redis.connection.hgetall(key);
          if (Object.keys(values).length === 0) {
            continue;
          }
          const parsed = reservationSchema.safeParse({
            ...values,
            aScore: Number(values.aScore),
            bScore: Number(values.bScore),
            createdAt: Number(values.createdAt),
          });
          if (!parsed.success) {
            throw new MatchmakingError(
              'RESERVATION_MISMATCH',
              'A Redis match reservation is malformed.',
              false,
            );
          }
          reservations.push(parsed.data);
          if (reservations.length >= limit) {
            return reservations;
          }
        }
      } while (cursor !== '0');
      return reservations;
    } catch (error) {
      if (error instanceof MatchmakingError) {
        throw error;
      }
      throw this.unavailable(error);
    }
  }

  private activeGameKey(guestSessionId: string): string {
    return `user:${guestSessionId}:active-game`;
  }

  private async execute<Output>(
    name: ScriptName,
    keys: readonly string[],
    arguments_: readonly string[],
    schema: z.ZodType<Output>,
  ): Promise<Output> {
    try {
      await this.redis.ensureConnected();
      let hash = this.scriptHashes.get(name);
      hash ??= await this.load(name);

      let raw: unknown;
      try {
        raw = await this.redis.connection.evalsha(
          hash,
          keys.length,
          ...keys,
          ...arguments_,
        );
      } catch (error) {
        if (!this.isNoScript(error)) {
          throw error;
        }
        hash = await this.load(name);
        raw = await this.redis.connection.evalsha(
          hash,
          keys.length,
          ...keys,
          ...arguments_,
        );
      }

      if (typeof raw !== 'string') {
        throw new Error(`Lua script ${name} returned a non-string response.`);
      }
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof MatchmakingError) {
        throw error;
      }
      throw this.unavailable(error);
    }
  }

  private guardKey(guestSessionId: string): string {
    return `mm:queued:${guestSessionId}`;
  }

  private isNoScript(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('NOSCRIPT');
  }

  private async load(name: ScriptName): Promise<string> {
    const hash = await this.redis.connection.script('LOAD', this.sources[name]);
    if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) {
      throw new Error(`Redis returned an invalid SHA for ${name}.`);
    }
    this.scriptHashes.set(name, hash);
    return hash;
  }

  private presenceKey(guestSessionId: string): string {
    return `presence:${guestSessionId}`;
  }

  private readScript(filename: string): string {
    const runtimeUrl = new URL(`./lua/${filename}`, import.meta.url);
    const path = existsSync(runtimeUrl)
      ? runtimeUrl
      : resolve(
          process.cwd(),
          'src/modules/matchmaking/infrastructure/lua',
          filename,
        );
    return readFileSync(path, 'utf8');
  }

  private queueKey(mode: MatchMode): string {
    return `mm:queue:${mode}`;
  }

  private reservationKey(matchId: string): string {
    return `match:${matchId}:reservation`;
  }

  private reservationMismatch(): MatchmakingError {
    return new MatchmakingError(
      'RESERVATION_MISMATCH',
      'The match reservation no longer matches its expected owner or members.',
      false,
    );
  }

  private stateKey(guestSessionId: string): string {
    return `user:${guestSessionId}:state`;
  }

  private unavailable(error: unknown): MatchmakingError {
    return new MatchmakingError(
      'DEPENDENCY_UNAVAILABLE',
      'Matchmaking Redis state is temporarily unavailable.',
      true,
      { cause: error },
    );
  }
}
