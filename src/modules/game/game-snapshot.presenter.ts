import { Injectable } from '@nestjs/common';
import type { GamePlayerRecord } from './application/ports/game.repository.js';
import type { GameSnapshotView } from './game-room.service.js';
import type { ServerEventEnvelope } from '../realtime/protocol/protocol.schemas.js';

export type GameSnapshotPayload = Extract<
  ServerEventEnvelope,
  { type: 'game.snapshot' }
>['payload'];

@Injectable()
export class GameSnapshotPresenter {
  present(
    snapshot: GameSnapshotView,
    guestSessionId: string,
  ): GameSnapshotPayload {
    const you = snapshot.players.find(
      (player) => player.guestSessionId === guestSessionId,
    );
    const opponent = snapshot.players.find(
      (player) => player.guestSessionId !== guestSessionId,
    );
    if (you === undefined || opponent === undefined) {
      throw new Error('An authorized snapshot has malformed membership.');
    }
    const game = snapshot.game;
    return {
      clocks: {
        blackMs: snapshot.clocks.blackMs,
        running:
          snapshot.clocks.running === null
            ? null
            : this.wireColor(snapshot.clocks.running),
        serverTime: snapshot.clocks.observedAt.getTime(),
        whiteMs: snapshot.clocks.whiteMs,
      },
      currentFen: game.currentFen,
      initialFen: game.initialFen,
      moves: snapshot.moves.map((move) => ({
        color: this.wireColor(move.color),
        ply: move.ply,
        san: move.san,
        uci: move.uci,
      })),
      opponent: this.publicPlayer(opponent),
      result: game.result,
      status: game.status,
      termination: game.termination,
      turn: this.wireColor(game.turnColor),
      you: this.publicPlayer(you),
    };
  }

  private publicPlayer(player: GamePlayerRecord): {
    avatar: string;
    color: 'black' | 'white';
    connected: boolean;
    name: string;
  } {
    return {
      avatar: player.avatarKey,
      color: this.wireColor(player.color),
      connected: player.connectedAt !== null,
      name: player.displayName,
    };
  }

  private wireColor(color: 'b' | 'w'): 'black' | 'white' {
    return color === 'w' ? 'white' : 'black';
  }
}
