import { z } from "zod";

import {
  clientGameSnapshotPayloadSchema,
  gameSnapshotPayloadSchema,
} from "./realtime.js";
import { PROTOCOL_ERROR_CODES } from "./constants.js";

export const HTTP_ERROR_CODES = [
  "BAD_REQUEST",
  ...PROTOCOL_ERROR_CODES,
] as const;

export const emptySessionBodySchema = z.object({}).strict();

const correlationIdSchema = z.uuid();
const instantSchema = z.iso.datetime();
const publicGuestSchema = z
  .object({
    avatar: z.string().min(1).max(128),
    expiresAt: instantSchema,
    id: z.uuid(),
    issuedAt: instantSchema,
    name: z.string().min(1).max(128),
  })
  .strict();

export const createSessionResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
    guest: publicGuestSchema.omit({ issuedAt: true }),
    token: z.string().min(1),
  })
  .strict();

export const renewSessionResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
    expiresAt: instantSchema,
    token: z.string().min(1),
  })
  .strict();

export const getSessionResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
    guest: publicGuestSchema,
  })
  .strict();

export const resetSessionResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
    ok: z.literal(true),
  })
  .strict();

export const gameIdParameterSchema = z.uuidv4();

export const activeGameResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
    gameId: z.uuidv4().nullable(),
  })
  .strict();

export const recoveredSnapshotResponseSchema = gameSnapshotPayloadSchema.extend(
  {
    correlationId: correlationIdSchema,
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
  },
);

export const httpErrorResponseSchema = z
  .object({
    correlationId: correlationIdSchema,
    error: z
      .object({
        code: z.enum(HTTP_ERROR_CODES),
        message: z.string().min(1).max(256),
        retryAfterMs: z.number().int().positive().optional(),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

/*
 * Response schemas used in the browser strip additive server fields while
 * retaining validation for every field the current client understands.
 */
const clientPublicGuestSchema = z.object({
  avatar: z.string().min(1).max(128),
  expiresAt: instantSchema,
  id: z.uuid(),
  issuedAt: instantSchema,
  name: z.string().min(1).max(128),
});

export const clientCreateSessionResponseSchema = z.object({
  correlationId: correlationIdSchema,
  guest: clientPublicGuestSchema.omit({ issuedAt: true }),
  token: z.string().min(1),
});

export const clientRenewSessionResponseSchema = z.object({
  correlationId: correlationIdSchema,
  expiresAt: instantSchema,
  token: z.string().min(1),
});

export const clientGetSessionResponseSchema = z.object({
  correlationId: correlationIdSchema,
  guest: clientPublicGuestSchema,
});

export const clientResetSessionResponseSchema = z.object({
  correlationId: correlationIdSchema,
  ok: z.literal(true),
});

export const clientActiveGameResponseSchema = z.object({
  correlationId: correlationIdSchema,
  gameId: z.uuidv4().nullable(),
});

export const clientRecoveredSnapshotResponseSchema =
  clientGameSnapshotPayloadSchema.extend({
    correlationId: correlationIdSchema,
    gameId: z.uuidv4(),
    gameVersion: z.number().int().nonnegative(),
  });

export const clientHttpErrorResponseSchema = z.object({
  correlationId: correlationIdSchema,
  error: z.object({
    code: z.enum(HTTP_ERROR_CODES),
    message: z.string().min(1).max(256),
    retryAfterMs: z.number().int().positive().optional(),
    retryable: z.boolean(),
  }),
});

export type CreateSessionResponse = Readonly<
  z.infer<typeof createSessionResponseSchema>
>;
export type RenewSessionResponse = Readonly<
  z.infer<typeof renewSessionResponseSchema>
>;
export type GetSessionResponse = Readonly<
  z.infer<typeof getSessionResponseSchema>
>;
export type ResetSessionResponse = Readonly<
  z.infer<typeof resetSessionResponseSchema>
>;
export type ActiveGameResponse = Readonly<
  z.infer<typeof activeGameResponseSchema>
>;
export type RecoveredSnapshotResponse = Readonly<
  z.infer<typeof recoveredSnapshotResponseSchema>
>;
export type HttpErrorResponse = Readonly<
  z.infer<typeof httpErrorResponseSchema>
>;
