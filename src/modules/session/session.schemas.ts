import { z } from 'zod';

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
