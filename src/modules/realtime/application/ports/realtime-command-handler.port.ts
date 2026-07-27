import type {
  ClientEventEnvelope,
  ServerEventEnvelope,
} from '../../protocol/protocol.schemas.js';
import type { AuthenticatedSocketIdentity } from '../../realtime.types.js';

export interface RealtimeCommandContext {
  identity: Readonly<AuthenticatedSocketIdentity>;
  joinGameRoom(gameId: string): Promise<void>;
  leaveGameRoom(gameId: string): Promise<void>;
  socketId: string;
}

type CommandResponseType =
  | 'session.ready'
  | 'queue.joined'
  | 'queue.left'
  | 'game.snapshot'
  | 'move.accepted'
  | 'game.ended'
  | 'heartbeat.pong';

type CommandResult<Type extends CommandResponseType> = Readonly<{
  payload: Extract<ServerEventEnvelope, { type: Type }>['payload'];
  type: Type;
}> &
  (Extract<ServerEventEnvelope, { type: Type }> extends {
    gameVersion: number;
  }
    ? Readonly<{ gameVersion: number }>
    : Readonly<{ gameVersion?: never }>);

export type RealtimeCommandResult = {
  [Type in CommandResponseType]: CommandResult<Type>;
}[CommandResponseType];

export const REALTIME_COMMAND_HANDLER = Symbol('REALTIME_COMMAND_HANDLER');

export interface RealtimeCommandHandler {
  execute(
    event: ClientEventEnvelope,
    context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult>;
}
