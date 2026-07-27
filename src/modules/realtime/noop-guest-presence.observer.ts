import { Injectable } from '@nestjs/common';
import type { GuestPresenceObserver } from './application/ports/guest-presence-observer.port.js';

@Injectable()
export class NoopGuestPresenceObserver implements GuestPresenceObserver {
  finallyDisconnected(_guestSessionId: string): Promise<void> {
    return Promise.resolve();
  }

  reconnected(_guestSessionId: string): Promise<void> {
    return Promise.resolve();
  }
}
