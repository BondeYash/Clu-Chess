import type { ClientEventEnvelope } from '../../protocol/protocol.schemas.js';
import type { AuthenticatedSocketIdentity } from '../../realtime.types.js';

export interface RealtimeCommandContext {
  identity: Readonly<AuthenticatedSocketIdentity>;
  joinGameRoom(gameId: string): Promise<void>;
  leaveGameRoom(gameId: string): Promise<void>;
  socketId: string;
}

export interface RealtimeCommandResult {
  gameVersion?: number;
  payload: unknown;
  type:
    | 'session.ready'
    | 'queue.joined'
    | 'queue.left'
    | 'game.snapshot'
    | 'move.accepted'
    | 'game.ended'
    | 'heartbeat.pong';
}

export const REALTIME_COMMAND_HANDLER = Symbol('REALTIME_COMMAND_HANDLER');

export interface RealtimeCommandHandler {
  execute(
    event: ClientEventEnvelope,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult>;
}
