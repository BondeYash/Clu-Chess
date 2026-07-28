import {
  clientRecoveredSnapshotResponseSchema,
  type RecoveredSnapshotResponse,
} from '@cluchess/protocol-v1/http';

import { apiFetch } from '@/lib/api/api-fetch';

export interface GameRecoveryApiClient {
  getSnapshot(
    gameId: string,
    token: string,
  ): Promise<RecoveredSnapshotResponse>;
}

export const gameRecoveryApi: GameRecoveryApiClient = {
  getSnapshot(gameId, token) {
    return apiFetch(`/v1/games/${encodeURIComponent(gameId)}/snapshot`, {
      schema: clientRecoveredSnapshotResponseSchema,
      token,
    });
  },
};
