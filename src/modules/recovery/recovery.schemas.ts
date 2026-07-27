import { z } from 'zod';
import { gameSnapshotPayloadSchema } from '../realtime/protocol/protocol.schemas.js';

export const gameIdParameterSchema = z.uuidv4();

export const activeGameResponseSchema = z
  .object({
    correlationId: z.uuid(),
    gameId: z.uuidv4().nullable(),
  })
  .strict();

export const recoveredSnapshotResponseSchema = gameSnapshotPayloadSchema.extend(
  {
    correlationId: z.uuid(),
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
  },
);
