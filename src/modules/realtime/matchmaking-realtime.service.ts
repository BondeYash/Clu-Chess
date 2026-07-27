import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import type {
  GameAllocation,
  GamePlayerRecord,
} from '../game/application/ports/game.repository.js';
import type {
  AcceptedMove,
  EndedGame,
  GameplayClock,
  StartedGame,
} from '../game/application/ports/gameplay.repository.js';
import { GameDeadlineService } from '../game/game-deadline.service.js';
import { GameLifecycleDeliveryRegistry } from '../game/game-lifecycle-delivery.registry.js';
import { GameLifecycleService } from '../game/game-lifecycle.service.js';
import { GameMoveService } from '../game/game-move.service.js';
import { GameRecoveryService } from '../game/game-recovery.service.js';
import { GameRoomService } from '../game/game-room.service.js';
import { GameSnapshotPresenter } from '../game/game-snapshot.presenter.js';
import {
  MatchmakingService,
  type MatchmakingEffects,
} from '../matchmaking/matchmaking.service.js';
import type { GuestPresenceObserver } from './application/ports/guest-presence-observer.port.js';
import type {
  RealtimeCommandContext,
  RealtimeCommandHandler,
  RealtimeCommandResult,
} from './application/ports/realtime-command-handler.port.js';
import { BroadcastService } from './broadcast.service.js';
import { RealtimeProtocolService } from './protocol/realtime-protocol.service.js';
import { RealtimeError } from './protocol/realtime.errors.js';
import type {
  ClientEventEnvelope,
  ServerEventEnvelope,
} from './protocol/protocol.schemas.js';

type JobName = 'drain' | 'reconcile' | 'sweep';

@Injectable()
export class MatchmakingRealtimeService
  implements
    RealtimeCommandHandler,
    GuestPresenceObserver,
    OnApplicationBootstrap,
    OnApplicationShutdown
{
  private readonly intervals: Readonly<Record<JobName, number>>;
  private readonly logger = new Logger(MatchmakingRealtimeService.name);
  private readonly runningJobs = new Set<JobName>();
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly broadcast: BroadcastService,
    private readonly config: AppConfigService,
    private readonly deadlines: GameDeadlineService,
    private readonly gameDelivery: GameLifecycleDeliveryRegistry,
    private readonly gameLifecycle: GameLifecycleService,
    private readonly gameRecovery: GameRecoveryService,
    private readonly games: GameRoomService,
    private readonly matchmaking: MatchmakingService,
    private readonly metrics: MetricsService,
    private readonly moves: GameMoveService,
    private readonly protocol: RealtimeProtocolService,
    private readonly snapshots: GameSnapshotPresenter,
  ) {
    this.intervals = {
      drain: config.values.JOB_MATCH_DRAIN_MS,
      reconcile: config.values.JOB_RESERVATION_RECONCILE_MS,
      sweep: config.values.JOB_QUEUE_SWEEP_MS,
    };
  }

  async execute(
    event: ClientEventEnvelope,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    switch (event.type) {
      case 'queue.join':
        return this.joinQueue(context, event.payload.mode);
      case 'queue.leave':
        return this.leaveQueue(context, event.payload.mode);
      case 'game.ready':
        return this.readyGame(event, context);
      case 'game.sync':
        return this.syncGame(event, context);
      case 'move.submit':
        return this.submitMove(event, context);
      case 'game.resign':
        return this.resignGame(event, context);
      default:
        throw new RealtimeError(
          'SERVICE_UNAVAILABLE',
          'This game command is not available until its implementation phase.',
          true,
        );
    }
  }

  async finallyDisconnected(guestSessionId: string): Promise<void> {
    const [queueResult, gameResult] = await Promise.allSettled([
      this.matchmaking.finallyDisconnected(guestSessionId),
      this.gameLifecycle.disconnected(guestSessionId),
    ]);
    if (queueResult.status === 'fulfilled' && queueResult.value) {
      this.broadcast.toGuest(
        guestSessionId,
        this.protocol.createServerEvent({
          payload: { mode: 'blitz', reason: 'disconnected' },
          type: 'queue.left',
        }),
      );
    }
    if (gameResult.status === 'fulfilled' && gameResult.value !== null) {
      await this.deadlines.scheduleGame(gameResult.value.gameId);
    }
    if (queueResult.status === 'rejected') {
      this.logger.warn(
        { guestSessionId },
        'Matchmaking disconnect cleanup failed',
      );
    }
    if (gameResult.status === 'rejected') {
      this.logger.warn({ guestSessionId }, 'Game disconnect transition failed');
    }
  }

  async reconnected(guestSessionId: string): Promise<void> {
    const event = await this.gameLifecycle.reconnected(guestSessionId);
    if (event !== null) {
      await this.deadlines.scheduleGame(event.gameId);
    }
  }

  onApplicationBootstrap(): void {
    this.schedule('drain', () => this.matchmaking.drain());
    this.schedule('sweep', () => this.matchmaking.sweep());
    this.schedule('reconcile', () => this.matchmaking.reconcile());
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers.length = 0;
  }

  private async joinQueue(
    context: RealtimeCommandContext,
    mode: 'blitz',
  ): Promise<RealtimeCommandResult> {
    const result = await this.matchmaking.join(
      context.identity.guestSessionId,
      mode,
    );
    this.publishEffects(result.effects);
    return {
      payload: {
        mode,
        position: result.queue.position,
        since: result.queue.since,
      },
      type: 'queue.joined',
    };
  }

  private async leaveQueue(
    context: RealtimeCommandContext,
    mode: 'blitz',
  ): Promise<RealtimeCommandResult> {
    await this.matchmaking.leave(context.identity.guestSessionId, mode);
    const payload = { mode, reason: 'requested' as const };
    this.broadcast.toGuest(
      context.identity.guestSessionId,
      this.protocol.createServerEvent({
        payload,
        type: 'queue.left',
      }),
    );
    return { payload, type: 'queue.left' };
  }

  private async readyGame(
    event: Extract<ClientEventEnvelope, { type: 'game.ready' }>,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    await this.games.authorize(event.gameId, context.identity.guestSessionId);
    await context.joinGameRoom(event.gameId);
    const result = await this.games.ready(
      event.gameId,
      context.identity.guestSessionId,
      event.gameVersion,
    );
    if (result.started !== null) {
      this.publishStarted(result.started);
    }
    return {
      gameVersion: result.snapshot.game.version,
      payload: this.snapshots.present(
        result.snapshot,
        context.identity.guestSessionId,
      ),
      type: 'game.snapshot',
    };
  }

  private async syncGame(
    event: Extract<ClientEventEnvelope, { type: 'game.sync' }>,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    const snapshot =
      event.gameId === undefined
        ? await this.gameRecovery.activeSnapshot(
            context.identity.guestSessionId,
          )
        : await this.gameRecovery.snapshot(
            event.gameId,
            context.identity.guestSessionId,
          );
    await context.joinGameRoom(snapshot.gameId);
    await this.deadlines.scheduleGame(snapshot.gameId);
    return {
      gameVersion: snapshot.gameVersion,
      payload: snapshot.payload,
      type: 'game.snapshot',
    };
  }

  private async submitMove(
    event: Extract<ClientEventEnvelope, { type: 'move.submit' }>,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    const submission = await this.moves.submit({
      clientMoveId: event.clientMoveId,
      expectedVersion: event.gameVersion,
      gameId: event.gameId,
      guestSessionId: context.identity.guestSessionId,
      move: {
        from: event.payload.from,
        ...(event.payload.promotion === undefined
          ? {}
          : { promotion: event.payload.promotion }),
        to: event.payload.to,
      },
    });
    if (!submission.duplicate) {
      if (submission.started !== null) {
        this.publishStarted(submission.started);
      }
      this.publishAccepted(submission.accepted);
      if (submission.ended !== null) {
        this.gameDelivery.gameEnded({
          duplicate: false,
          ended: submission.ended,
          guestSessionIds: submission.guestSessionIds,
        });
      }
    }
    return {
      gameVersion: submission.accepted.gameVersion,
      payload: this.acceptedPayload(submission.accepted),
      type: 'move.accepted',
    };
  }

  private async resignGame(
    event: Extract<ClientEventEnvelope, { type: 'game.resign' }>,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    const submission = await this.gameLifecycle.resign({
      eventId: event.eventId,
      expectedVersion: event.gameVersion,
      gameId: event.gameId,
      guestSessionId: context.identity.guestSessionId,
    });
    return {
      gameVersion: submission.ended.gameVersion,
      payload: this.endedPayload(submission.ended),
      type: 'game.ended',
    };
  }

  private publishStarted(started: StartedGame): void {
    this.broadcast.toGame(
      started.gameId,
      this.protocol.createServerEvent({
        gameId: started.gameId,
        gameVersion: started.gameVersion,
        payload: {
          clocks: {
            ...this.wireClocks(started.clocks),
            running: 'white',
          },
          initialFen: started.initialFen,
          turn: 'white',
        },
        type: 'game.started',
      }),
    );
  }

  private publishAccepted(accepted: AcceptedMove): void {
    this.broadcast.toGame(
      accepted.gameId,
      this.protocol.createServerEvent({
        clientMoveId: accepted.clientMoveId,
        gameId: accepted.gameId,
        gameVersion: accepted.gameVersion,
        payload: this.acceptedPayload(accepted),
        type: 'move.accepted',
      }),
    );
  }

  private acceptedPayload(accepted: AcceptedMove): {
    check: boolean;
    clocks: {
      blackMs: number;
      running: 'black' | 'white' | null;
      serverTime: number;
      whiteMs: number;
    };
    fenAfter: string;
    ply: number;
    san: string;
    turn: 'black' | 'white';
    uci: string;
  } {
    return {
      check: accepted.check,
      clocks: this.wireClocks(accepted.clocks),
      fenAfter: accepted.fenAfter,
      ply: accepted.ply,
      san: accepted.san,
      turn: this.wireColor(accepted.turn),
      uci: accepted.uci,
    };
  }

  private wireClocks(clocks: GameplayClock): {
    blackMs: number;
    running: 'black' | 'white' | null;
    serverTime: number;
    whiteMs: number;
  } {
    return {
      blackMs: clocks.blackMs,
      running: clocks.running === null ? null : this.wireColor(clocks.running),
      serverTime: clocks.observedAt,
      whiteMs: clocks.whiteMs,
    };
  }

  private publishEffects(effects: MatchmakingEffects): void {
    for (const removed of effects.removed) {
      this.broadcast.toGuest(
        removed.guestSessionId,
        this.protocol.createServerEvent({
          payload: { mode: 'blitz', reason: removed.reason },
          type: 'queue.left',
        }),
      );
    }
    for (const requeued of effects.requeued) {
      this.broadcast.toGuest(
        requeued.guestSessionId,
        this.protocol.createServerEvent({
          payload: { mode: 'blitz', since: requeued.since },
          type: 'queue.joined',
        }),
      );
    }
    for (const allocation of effects.allocations) {
      this.publishAllocation(allocation);
    }
  }

  private publishAllocation(allocation: GameAllocation): void {
    const [first, second] = allocation.players;
    this.publishMatchFound(allocation, first, second);
    this.publishMatchFound(allocation, second, first);
    void this.deadlines.scheduleGame(allocation.game.id);
  }

  private endedPayload(
    ended: EndedGame,
  ): Extract<ServerEventEnvelope, { type: 'game.ended' }>['payload'] {
    return {
      clocks: {
        ...this.wireClocks(ended.clocks),
        running: null,
      },
      finalFen: ended.finalFen,
      pgn: ended.pgn,
      result: ended.result,
      termination: ended.termination,
    };
  }

  private publishMatchFound(
    allocation: GameAllocation,
    player: GamePlayerRecord,
    opponent: GamePlayerRecord,
  ): void {
    const deadline = allocation.game.joinDeadlineAt;
    if (deadline === null) {
      throw new Error('An allocated game has no join deadline.');
    }
    const queueLeft = this.protocol.createServerEvent({
      payload: { mode: 'blitz', reason: 'matched' },
      type: 'queue.left',
    });
    const matchFound = this.protocol.createServerEvent({
      gameId: allocation.game.id,
      gameVersion: allocation.game.version,
      payload: {
        color: this.wireColor(player.color),
        joinDeadline: deadline.getTime(),
        opponent: {
          avatar: opponent.avatarKey,
          name: opponent.displayName,
        },
        timeControl: {
          incrementMs: allocation.game.incrementMs,
          initialMs: allocation.game.timeInitialMs,
        },
      },
      type: 'match.found',
    });
    this.broadcast.toGuest(player.guestSessionId, queueLeft);
    this.broadcast.toGuest(player.guestSessionId, matchFound);
  }

  private schedule(
    name: JobName,
    work: () => Promise<MatchmakingEffects>,
  ): void {
    const timer = setInterval(() => {
      void this.runJob(name, work);
    }, this.intervals[name]);
    timer.unref();
    this.timers.push(timer);
  }

  private async runJob(
    name: JobName,
    work: () => Promise<MatchmakingEffects>,
  ): Promise<void> {
    if (this.runningJobs.has(name)) {
      return;
    }
    this.runningJobs.add(name);
    const startedAt = performance.now();
    try {
      const effects = await work();
      this.publishEffects(effects);
      const changed =
        effects.allocations.length +
        effects.removed.length +
        effects.requeued.length;
      if (changed > 0) {
        this.metrics.increment(
          'cluchess_reconciliation_repairs_total',
          'Reconciliation repairs by job and kind.',
          { job: `matchmaking_${name}`, kind: 'effect' },
          changed,
        );
        this.logger.log({
          changed,
          durationMs: Math.round(performance.now() - startedAt),
          job: name,
        });
      }
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: `matchmaking_${name}`, outcome: 'success' },
      );
    } catch {
      this.metrics.increment(
        'cluchess_cleanup_failures_total',
        'Background cleanup and reconciliation failures by job.',
        { job: `matchmaking_${name}` },
      );
      this.metrics.increment(
        'cluchess_reconciliation_runs_total',
        'Reconciliation job runs by job and outcome.',
        { job: `matchmaking_${name}`, outcome: 'failure' },
      );
      this.logger.warn({
        durationMs: Math.round(performance.now() - startedAt),
        job: name,
      });
    } finally {
      this.runningJobs.delete(name);
    }
  }

  private wireColor(color: 'b' | 'w'): 'black' | 'white' {
    return color === 'w' ? 'white' : 'black';
  }
}
