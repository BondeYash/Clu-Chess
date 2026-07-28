import { Injectable } from '@nestjs/common';
import type { GuestSocketDisconnectPort } from '../application/ports/guest-socket-disconnect.port.js';

@Injectable()
export class GuestSocketDisconnectRegistry implements GuestSocketDisconnectPort {
  private delegate: GuestSocketDisconnectPort | undefined;

  bind(delegate: GuestSocketDisconnectPort): void {
    this.delegate = delegate;
  }

  unbind(delegate: GuestSocketDisconnectPort): void {
    if (this.delegate === delegate) {
      this.delegate = undefined;
    }
  }

  disconnectGuest(guestSessionId: string): Promise<void> {
    return this.delegate?.disconnectGuest(guestSessionId) ?? Promise.resolve();
  }
}
