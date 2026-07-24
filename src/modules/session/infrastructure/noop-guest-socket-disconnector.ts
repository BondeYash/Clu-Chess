import { Injectable } from '@nestjs/common';
import type { GuestSocketDisconnectPort } from '../application/ports/guest-socket-disconnect.port.js';

@Injectable()
export class NoopGuestSocketDisconnector implements GuestSocketDisconnectPort {
  disconnectGuest(_guestSessionId: string): Promise<void> {
    return Promise.resolve();
  }
}
