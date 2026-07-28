import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { GameLifecycleDeliveryPort } from '../game/application/ports/game-lifecycle-delivery.port.js';
import type {
  PlayerDisconnected,
  PlayerReconnected,
  TerminalSubmission,
} from '../game/application/ports/game-lifecycle.repository.js';
import { GameDeadlineService } from '../game/game-deadline.service.js';
import { GameLifecycleDeliveryRegistry } from '../game/game-lifecycle-delivery.registry.js';
import { BroadcastService } from './broadcast.service.js';
import { RealtimeProtocolService } from './protocol/realtime-protocol.service.js';

const TERMINAL_ROOM_RETENTION_MS = 250;

@Injectable()
export class GameLifecycleDeliveryService
  implements
    GameLifecycleDeliveryPort,
    OnApplicationBootstrap,
    OnApplicationShutdown
{
  private readonly roomCleanupTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly broadcast: BroadcastService,
    private readonly deadlines: GameDeadlineService,
    private readonly protocol: RealtimeProtocolService,
    private readonly registry: GameLifecycleDeliveryRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.registry.bind(this);
  }

  onApplicationShutdown(): void {
    this.registry.unbind(this);
    for (const timer of this.roomCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.roomCleanupTimers.clear();
  }

  gameEnded(submission: TerminalSubmission): void {
    const ended = submission.ended;
    const event = this.protocol.createServerEvent({
      gameId: ended.gameId,
      gameVersion: ended.gameVersion,
      payload: {
        clocks: {
          blackMs: ended.clocks.blackMs,
          running: null,
          serverTime: ended.clocks.observedAt,
          whiteMs: ended.clocks.whiteMs,
        },
        finalFen: ended.finalFen,
        pgn: ended.pgn,
        result: ended.result,
        termination: ended.termination,
      },
      type: 'game.ended',
    });
    for (const guestSessionId of submission.guestSessionIds) {
      this.broadcast.toGuest(guestSessionId, event);
    }
    this.deadlines.cancel(ended.gameId);
    this.scheduleRoomCleanup(ended.gameId);
  }

  playerDisconnected(event: PlayerDisconnected): void {
    this.broadcast.toGame(
      event.gameId,
      this.protocol.createServerEvent({
        gameId: event.gameId,
        gameVersion: event.gameVersion,
        payload: {
          clocksContinue: true,
          color: this.wireColor(event.color),
          graceDeadline: event.graceDeadline,
        },
        type: 'player.disconnected',
      }),
    );
  }

  playerReconnected(event: PlayerReconnected): void {
    this.broadcast.toGame(
      event.gameId,
      this.protocol.createServerEvent({
        gameId: event.gameId,
        gameVersion: event.gameVersion,
        payload: { color: this.wireColor(event.color) },
        type: 'player.reconnected',
      }),
    );
  }

  private scheduleRoomCleanup(gameId: string): void {
    const existing = this.roomCleanupTimers.get(gameId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.roomCleanupTimers.delete(gameId);
      this.broadcast.leaveGame(gameId);
    }, TERMINAL_ROOM_RETENTION_MS);
    timer.unref();
    this.roomCleanupTimers.set(gameId, timer);
  }

  private wireColor(color: 'b' | 'w'): 'black' | 'white' {
    return color === 'w' ? 'white' : 'black';
  }
}
