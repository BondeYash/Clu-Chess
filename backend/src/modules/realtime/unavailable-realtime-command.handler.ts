import { Injectable } from '@nestjs/common';
import type {
  RealtimeCommandContext,
  RealtimeCommandHandler,
  RealtimeCommandResult,
} from './application/ports/realtime-command-handler.port.js';
import { RealtimeError } from './protocol/realtime.errors.js';
import type { ClientEventEnvelope } from './protocol/protocol.schemas.js';

@Injectable()
export class UnavailableRealtimeCommandHandler implements RealtimeCommandHandler {
  execute(
    _event: ClientEventEnvelope,
    _context: RealtimeCommandContext,
  ): Promise<RealtimeCommandResult> {
    throw new RealtimeError(
      'SERVICE_UNAVAILABLE',
      'Socket command is not available yet',
      true,
    );
  }
}
