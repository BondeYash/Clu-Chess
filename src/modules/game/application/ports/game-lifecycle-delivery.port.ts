import type {
  PlayerDisconnected,
  PlayerReconnected,
  TerminalSubmission,
} from './game-lifecycle.repository.js';

export interface GameLifecycleDeliveryPort {
  gameEnded(submission: TerminalSubmission): void;
  playerDisconnected(event: PlayerDisconnected): void;
  playerReconnected(event: PlayerReconnected): void;
}
