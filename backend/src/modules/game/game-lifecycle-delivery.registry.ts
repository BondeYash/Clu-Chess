import { Injectable } from '@nestjs/common';
import type { GameLifecycleDeliveryPort } from './application/ports/game-lifecycle-delivery.port.js';
import type {
  PlayerDisconnected,
  PlayerReconnected,
  TerminalSubmission,
} from './application/ports/game-lifecycle.repository.js';

@Injectable()
export class GameLifecycleDeliveryRegistry implements GameLifecycleDeliveryPort {
  private delegate: GameLifecycleDeliveryPort | undefined;

  bind(delegate: GameLifecycleDeliveryPort): void {
    this.delegate = delegate;
  }

  unbind(delegate: GameLifecycleDeliveryPort): void {
    if (this.delegate === delegate) {
      this.delegate = undefined;
    }
  }

  gameEnded(submission: TerminalSubmission): void {
    this.delegate?.gameEnded(submission);
  }

  playerDisconnected(event: PlayerDisconnected): void {
    this.delegate?.playerDisconnected(event);
  }

  playerReconnected(event: PlayerReconnected): void {
    this.delegate?.playerReconnected(event);
  }
}
