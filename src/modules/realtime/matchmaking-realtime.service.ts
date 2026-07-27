import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service.js';
import type {
  GameAllocation,
  GamePlayerRecord,
} from '../game/application/ports/game.repository.js';
import { GameRoomService } from '../game/game-room.service.js';
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
import type { ClientEventEnvelope } from './protocol/protocol.schemas.js';

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
    private readonly games: GameRoomService,
    private readonly matchmaking: MatchmakingService,
    private readonly protocol: RealtimeProtocolService,
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
      default:
        throw new RealtimeError(
          'SERVICE_UNAVAILABLE',
          'This game command is not available until its implementation phase.',
          true,
        );
    }
  }

  async finallyDisconnected(guestSessionId: string): Promise<void> {
    if (await this.matchmaking.finallyDisconnected(guestSessionId)) {
      this.broadcast.toGuest(
        guestSessionId,
        this.protocol.createServerEvent({
          payload: { mode: 'blitz', reason: 'disconnected' },
          type: 'queue.left',
        }),
      );
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
    const allocation = await this.games.ready(
      event.gameId,
      context.identity.guestSessionId,
      event.gameVersion,
    );
    return this.snapshotResult(allocation, context.identity.guestSessionId);
  }

  private async syncGame(
    event: Extract<ClientEventEnvelope, { type: 'game.sync' }>,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    const allocation =
      event.gameId === undefined
        ? await this.games.activeSnapshot(context.identity.guestSessionId)
        : await this.games.snapshot(
            event.gameId,
            context.identity.guestSessionId,
          );
    await context.joinGameRoom(allocation.game.id);
    return this.snapshotResult(allocation, context.identity.guestSessionId);
  }

  private snapshotResult(
    allocation: GameAllocation,
    guestSessionId: string,
  ): RealtimeCommandResult {
    const you = allocation.players.find(
      (player) => player.guestSessionId === guestSessionId,
    );
    const opponent = allocation.players.find(
      (player) => player.guestSessionId !== guestSessionId,
    );
    if (you === undefined || opponent === undefined) {
      throw new RealtimeError(
        'NOT_A_PLAYER',
        'The authenticated guest is not a game member.',
        false,
      );
    }
    const game = allocation.game;
    const running =
      game.status === 'IN_PROGRESS' || game.status === 'RECONNECTING'
        ? this.wireColor(game.turnColor)
        : null;

    return {
      gameVersion: game.version,
      payload: {
        clocks: {
          blackMs: game.blackClockMs,
          running,
          serverTime: Date.now(),
          whiteMs: game.whiteClockMs,
        },
        currentFen: game.currentFen,
        initialFen: game.initialFen,
        moves: [],
        opponent: this.publicPlayer(opponent),
        result: game.result,
        status: game.status,
        termination: game.termination,
        turn: this.wireColor(game.turnColor),
        you: this.publicPlayer(you),
      },
      type: 'game.snapshot',
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

  private publicPlayer(player: GamePlayerRecord): {
    avatar: string;
    color: 'black' | 'white';
    connected: boolean;
    name: string;
  } {
    return {
      avatar: player.avatarKey,
      color: this.wireColor(player.color),
      connected: player.connectedAt !== null,
      name: player.displayName,
    };
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
        this.logger.log({
          changed,
          durationMs: Math.round(performance.now() - startedAt),
          job: name,
        });
      }
    } catch {
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
