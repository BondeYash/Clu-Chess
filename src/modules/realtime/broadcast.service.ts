import { Injectable } from '@nestjs/common';
import type { GuestSocketDisconnectPort } from '../session/application/ports/guest-socket-disconnect.port.js';
import type { RealtimeDeliveryPort } from './application/ports/realtime-delivery.port.js';
import { RealtimeRedisService } from './infrastructure/realtime-redis.service.js';
import type { ServerEventEnvelope } from './protocol/protocol.schemas.js';
import { gameRoom, guestRoom } from './realtime-rooms.js';
import type { RealtimeServer } from './realtime.types.js';

@Injectable()
export class BroadcastService
  implements RealtimeDeliveryPort, GuestSocketDisconnectPort
{
  private server: RealtimeServer | undefined;

  constructor(private readonly realtimeRedis: RealtimeRedisService) {}

  bind(server: RealtimeServer): void {
    this.server = server;
  }

  unbind(server: RealtimeServer): void {
    if (this.server === server) {
      this.server = undefined;
    }
  }

  async disconnectGuest(guestSessionId: string): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    const room = guestRoom(guestSessionId);
    const localSockets = await server.local.in(room).fetchSockets();
    for (const socket of localSockets) {
      socket.disconnect(true);
    }
    if (!this.realtimeRedis.isReady) {
      return;
    }
    const sockets = await server.in(room).fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }
  }

  toGame(gameId: string, event: ServerEventEnvelope): void {
    this.emit(gameRoom(gameId), event);
  }

  leaveGame(gameId: string): void {
    this.server?.in(gameRoom(gameId)).socketsLeave(gameRoom(gameId));
  }

  toGuest(guestSessionId: string, event: ServerEventEnvelope): void {
    this.emit(guestRoom(guestSessionId), event);
  }

  private emit(room: string, event: ServerEventEnvelope): void {
    if (this.realtimeRedis.isReady) {
      this.server?.to(room).emit(event.type, event);
      return;
    }
    this.server?.local.to(room).emit(event.type, event);
  }
}
