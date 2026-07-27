import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import type { GameAllocation } from '../game/application/ports/game.repository.js';
import { GameAllocationService } from '../game/game-allocation.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { MatchmakingError } from './domain/matchmaking.errors.js';
import type {
  MatchAttempt,
  MatchMode,
  MatchReservation,
  QueueJoin,
  QueueLeave,
  RemovedQueueGuest,
} from './domain/matchmaking.types.js';
import { MatchmakingScriptService } from './infrastructure/matchmaking-script.service.js';

export type MatchmakingEffects = Readonly<{
  allocations: readonly GameAllocation[];
  requeued: readonly Readonly<{
    guestSessionId: string;
    since: number;
  }>[];
  removed: readonly RemovedQueueGuest[];
}>;

export type JoinQueueResult = Readonly<{
  effects: MatchmakingEffects;
  queue: QueueJoin;
}>;

export type LeaveQueueResult = Readonly<{
  queue: QueueLeave;
}>;

const EMPTY_EFFECTS: MatchmakingEffects = {
  allocations: [],
  removed: [],
  requeued: [],
};

@Injectable()
export class MatchmakingService {
  private readonly batchSize: number;

  constructor(
    private readonly allocations: GameAllocationService,
    private readonly presence: PresenceService,
    private readonly scripts: MatchmakingScriptService,
    config: AppConfigService,
  ) {
    this.batchSize = config.values.JOB_BATCH_SIZE;
  }

  async join(
    guestSessionId: string,
    mode: MatchMode,
    observedAt = new Date(),
  ): Promise<JoinQueueResult> {
    const [eligibility, present] = await Promise.all([
      this.allocations.eligibility(guestSessionId, observedAt),
      this.presence.isPresent(guestSessionId, observedAt),
    ]);
    if (eligibility.activeGameId !== null) {
      throw new MatchmakingError(
        'ALREADY_IN_GAME',
        'The guest already has a durable active game.',
        false,
      );
    }
    if (!eligibility.eligible) {
      throw new MatchmakingError(
        'ALREADY_IN_GAME',
        'The guest session is no longer eligible for matchmaking.',
        false,
      );
    }
    if (!present) {
      throw new MatchmakingError(
        'NOT_PRESENT',
        'A live guest connection is required for matchmaking.',
        true,
      );
    }

    const queue = await this.scripts.enqueue(
      guestSessionId,
      mode,
      observedAt.getTime(),
    );
    const effects = await this.attemptMatch(mode, observedAt);
    return { effects, queue };
  }

  async leave(
    guestSessionId: string,
    mode: MatchMode,
  ): Promise<LeaveQueueResult> {
    return { queue: await this.scripts.leave(guestSessionId, mode) };
  }

  async finallyDisconnected(
    guestSessionId: string,
    mode: MatchMode = 'blitz',
  ): Promise<boolean> {
    return (await this.scripts.leave(guestSessionId, mode)).left;
  }

  async drain(
    mode: MatchMode = 'blitz',
    observedAt = new Date(),
  ): Promise<MatchmakingEffects> {
    if ((await this.scripts.queueSize(mode)) < 2) {
      return EMPTY_EFFECTS;
    }

    const effects: MutableEffects = this.mutableEffects();
    const pairBudget = Math.max(1, Math.floor(this.batchSize / 2));
    for (let index = 0; index < pairBudget; index += 1) {
      const cycle = await this.attemptMatch(mode, observedAt);
      this.mergeEffects(effects, cycle);
      if (cycle.allocations.length === 0) {
        break;
      }
    }
    return effects;
  }

  async sweep(
    mode: MatchMode = 'blitz',
    observedAt = new Date(),
  ): Promise<MatchmakingEffects> {
    return {
      ...EMPTY_EFFECTS,
      removed: await this.scripts.sweep(
        mode,
        observedAt.getTime(),
        this.batchSize,
      ),
    };
  }

  async reconcile(observedAt = new Date()): Promise<MatchmakingEffects> {
    const effects: MutableEffects = this.mutableEffects();
    const reservations = await this.scripts.listReservations(this.batchSize);
    const handledGameIds = new Set<string>();

    for (const reservation of reservations) {
      const cycle = await this.processReservation(reservation, observedAt);
      this.mergeEffects(effects, cycle);
      for (const allocation of cycle.allocations) {
        handledGameIds.add(allocation.game.id);
      }
    }

    const active = await this.allocations.listActive(this.batchSize);
    for (const allocation of active) {
      if (handledGameIds.has(allocation.game.id)) {
        continue;
      }
      const [a, b] = allocation.players;
      if (
        await this.scripts.repairCommitted(
          'blitz',
          allocation.game.id,
          a.guestSessionId,
          b.guestSessionId,
        )
      ) {
        effects.allocations.push(allocation);
      }
    }

    return effects;
  }

  private async attemptMatch(
    mode: MatchMode,
    observedAt: Date,
  ): Promise<MatchmakingEffects> {
    const attempt = await this.scripts.tryMatch(
      mode,
      randomUUID(),
      randomUUID(),
      observedAt.getTime(),
      this.batchSize,
    );
    const effects = await this.effectsFromAttempt(attempt, observedAt);
    return effects;
  }

  private async effectsFromAttempt(
    attempt: MatchAttempt,
    observedAt: Date,
  ): Promise<MatchmakingEffects> {
    if (attempt.reservation === null) {
      return { ...EMPTY_EFFECTS, removed: attempt.discarded };
    }
    const result = await this.processReservation(
      attempt.reservation,
      observedAt,
    );
    return {
      allocations: result.allocations,
      removed: [...attempt.discarded, ...result.removed],
      requeued: result.requeued,
    };
  }

  private async processReservation(
    reservation: MatchReservation,
    observedAt: Date,
  ): Promise<MatchmakingEffects> {
    try {
      const allocation = await this.allocations.allocate(
        reservation,
        observedAt,
      );
      await this.finalizeCommitted(reservation, allocation);
      return { ...EMPTY_EFFECTS, allocations: [allocation] };
    } catch (error) {
      const recovered = await this.recoverAfterAllocationFailure(
        reservation,
        observedAt,
      );
      if (recovered !== null) {
        return recovered;
      }
      throw error;
    }
  }

  private async finalizeCommitted(
    reservation: MatchReservation,
    allocation: GameAllocation,
  ): Promise<void> {
    try {
      await this.scripts.finalize(reservation);
    } catch (error) {
      if (
        error instanceof MatchmakingError &&
        error.code === 'RESERVATION_MISMATCH'
      ) {
        const [a, b] = allocation.players;
        await this.scripts.repairCommitted(
          reservation.mode,
          allocation.game.id,
          a.guestSessionId,
          b.guestSessionId,
        );
        return;
      }
      if (
        error instanceof MatchmakingError &&
        error.code === 'DEPENDENCY_UNAVAILABLE'
      ) {
        return;
      }
      throw error;
    }
  }

  private async recoverAfterAllocationFailure(
    reservation: MatchReservation,
    observedAt: Date,
  ): Promise<MatchmakingEffects | null> {
    let existing: GameAllocation | null;
    let a;
    let b;
    try {
      [existing, a, b] = await Promise.all([
        this.allocations.findByMatchId(reservation.matchId),
        this.allocations.eligibility(reservation.a, observedAt),
        this.allocations.eligibility(reservation.b, observedAt),
      ]);
    } catch {
      return null;
    }

    if (existing !== null && this.matchesReservation(existing, reservation)) {
      await this.finalizeCommitted(reservation, existing);
      return { ...EMPTY_EFFECTS, allocations: [existing] };
    }

    const rollback = await this.scripts.rollback(
      reservation,
      { a, b },
      observedAt.getTime(),
    );
    return {
      ...EMPTY_EFFECTS,
      requeued: rollback.requeued,
    };
  }

  private matchesReservation(
    allocation: GameAllocation,
    reservation: MatchReservation,
  ): boolean {
    const expected = [reservation.a, reservation.b].sort();
    const actual = allocation.players
      .map((player) => player.guestSessionId)
      .sort();
    return (
      allocation.game.id === reservation.gameId &&
      allocation.game.matchId === reservation.matchId &&
      actual.length === 2 &&
      actual.every(
        (guestSessionId, index) => guestSessionId === expected[index],
      )
    );
  }

  private mergeEffects(
    target: MutableEffects,
    source: MatchmakingEffects,
  ): void {
    target.allocations.push(...source.allocations);
    target.removed.push(...source.removed);
    target.requeued.push(...source.requeued);
  }

  private mutableEffects(): MutableEffects {
    return {
      allocations: [],
      removed: [],
      requeued: [],
    };
  }
}

interface MutableEffects {
  allocations: GameAllocation[];
  removed: RemovedQueueGuest[];
  requeued: Readonly<{ guestSessionId: string; since: number }>[];
}
