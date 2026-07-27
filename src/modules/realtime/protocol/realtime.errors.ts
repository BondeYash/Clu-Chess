import type {
  ProtocolErrorCode,
  ServerEventName,
} from './protocol.constants.js';

export class RealtimeError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly options: Readonly<{
      authoritativeVersion?: number;
      gameVersion?: number;
      responseType?: Extract<ServerEventName, 'server.error' | 'move.rejected'>;
      retryAfterMs?: number;
    }> = {},
  ) {
    super(message);
    this.name = 'RealtimeError';
  }
}
