import type { RecoveredSnapshotResponse } from '@cluchess/protocol-v1/http';

export type GameSnapshot = Omit<RecoveredSnapshotResponse, 'correlationId'> & {
  correlationId?: string | undefined;
};
