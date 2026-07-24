import { Injectable } from '@nestjs/common';
import { Prisma, type GuestSession } from '../../../generated/prisma/client.js';
import {
  DatabaseError,
  toDatabaseError,
} from '../../persistence/database-errors.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type {
  CreateGuestSession,
  GuestSessionRecord,
  GuestSessionRepository,
  RenewGuestSession,
  ResetGuestSession,
  RevokedSessionCursor,
  SessionCommandReplay,
  SessionMutationResult,
} from '../application/ports/guest-session.repository.js';
import { SessionRepositoryError } from '../application/session-repository.errors.js';

type CommandWithGuest = Prisma.SessionCommandGetPayload<{
  include: { guestSession: true };
}>;

@Injectable()
export class PrismaGuestSessionRepository implements GuestSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateGuestSession): Promise<SessionMutationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.sessionCommand.findUnique({
          include: { guestSession: true },
          where: { idempotencyHash: input.idempotencyHash },
        });
        if (existing !== null) {
          return { replayed: true, value: this.toCommandReplay(existing) };
        }

        const guestSession = await transaction.guestSession.create({
          data: {
            avatarKey: input.avatarKey,
            currentJti: input.issuedClaims.jti,
            displayName: input.displayName,
            expiresAt: input.issuedClaims.expiresAt,
            id: input.guestSessionId,
            issuedAt: input.issuedClaims.issuedAt,
          },
        });
        await transaction.sessionCommand.create({
          data: {
            commandType: 'CREATE',
            expiresAt: input.issuedClaims.expiresAt,
            guestSessionId: guestSession.id,
            idempotencyHash: input.idempotencyHash,
            issuedAt: input.issuedClaims.issuedAt,
            issuedJti: input.issuedClaims.jti,
          },
        });

        return {
          replayed: false,
          value: {
            commandType: 'CREATE',
            guestSession: this.toGuestSession(guestSession),
            issuedClaims: input.issuedClaims,
          },
        };
      });
    } catch (error) {
      return this.recoverUniqueOrThrow(error, input.idempotencyHash, true);
    }
  }

  async renew(input: RenewGuestSession): Promise<SessionMutationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.sessionCommand.findUnique({
          include: { guestSession: true },
          where: { idempotencyHash: input.idempotencyHash },
        });
        if (existing !== null) {
          return { replayed: true, value: this.toCommandReplay(existing) };
        }

        await transaction.$queryRaw(
          Prisma.sql`
            SELECT "id"
            FROM "guest_sessions"
            WHERE "id" = ${input.guestSessionId}::UUID
            FOR UPDATE
          `,
        );
        const current = await transaction.guestSession.findUnique({
          where: { id: input.guestSessionId },
        });
        if (
          current?.revokedAt !== null ||
          current.expiresAt <= input.issuedClaims.issuedAt
        ) {
          throw new SessionRepositoryError('session-unavailable');
        }

        const guestSession = await transaction.guestSession.update({
          data: {
            currentJti: input.issuedClaims.jti,
            expiresAt: input.issuedClaims.expiresAt,
            issuedAt: input.issuedClaims.issuedAt,
          },
          where: { id: input.guestSessionId },
        });
        await transaction.sessionCommand.create({
          data: {
            commandType: 'RENEW',
            expiresAt: input.issuedClaims.expiresAt,
            guestSessionId: input.guestSessionId,
            idempotencyHash: input.idempotencyHash,
            issuedAt: input.issuedClaims.issuedAt,
            issuedJti: input.issuedClaims.jti,
          },
        });

        return {
          replayed: false,
          value: {
            commandType: 'RENEW',
            guestSession: this.toGuestSession(guestSession),
            issuedClaims: input.issuedClaims,
          },
        };
      });
    } catch (error) {
      return this.recoverUniqueOrThrow(error, input.idempotencyHash, false);
    }
  }

  async reset(input: ResetGuestSession): Promise<SessionMutationResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.sessionCommand.findUnique({
          include: { guestSession: true },
          where: { idempotencyHash: input.idempotencyHash },
        });
        if (existing !== null) {
          return { replayed: true, value: this.toCommandReplay(existing) };
        }

        await transaction.$queryRaw(
          Prisma.sql`
            SELECT "id"
            FROM "guest_sessions"
            WHERE "id" = ${input.guestSessionId}::UUID
            FOR UPDATE
          `,
        );
        const current = await transaction.guestSession.findUnique({
          where: { id: input.guestSessionId },
        });
        if (
          current?.revokedAt !== null ||
          current.expiresAt <= input.revokedAt
        ) {
          throw new SessionRepositoryError('session-unavailable');
        }

        const guestSession = await transaction.guestSession.update({
          data: { revokedAt: input.revokedAt },
          where: { id: input.guestSessionId },
        });
        await transaction.sessionCommand.create({
          data: {
            commandType: 'RESET',
            guestSessionId: input.guestSessionId,
            idempotencyHash: input.idempotencyHash,
          },
        });

        return {
          replayed: false,
          value: {
            commandType: 'RESET',
            guestSession: this.toGuestSession(guestSession),
            issuedClaims: null,
          },
        };
      });
    } catch (error) {
      return this.recoverUniqueOrThrow(error, input.idempotencyHash, false);
    }
  }

  async findByDisplayName(
    displayName: string,
  ): Promise<GuestSessionRecord | null> {
    try {
      const guestSession = await this.prisma.guestSession.findUnique({
        where: { displayNameCi: displayName.toLowerCase() },
      });
      return guestSession === null ? null : this.toGuestSession(guestSession);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findById(id: string): Promise<GuestSessionRecord | null> {
    try {
      const guestSession = await this.prisma.guestSession.findUnique({
        where: { id },
      });
      return guestSession === null ? null : this.toGuestSession(guestSession);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findCommand(
    idempotencyHash: string,
  ): Promise<SessionCommandReplay | null> {
    try {
      const command = await this.prisma.sessionCommand.findUnique({
        include: { guestSession: true },
        where: { idempotencyHash },
      });
      return command === null ? null : this.toCommandReplay(command);
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async findLiveRevoked(
    now: Date,
    limit: number,
    cursor?: RevokedSessionCursor,
  ): Promise<readonly GuestSessionRecord[]> {
    try {
      const sessions = await this.prisma.guestSession.findMany({
        orderBy: [{ revokedAt: 'asc' }, { id: 'asc' }],
        take: limit,
        where: {
          ...(cursor === undefined
            ? {}
            : {
                OR: [
                  { revokedAt: { gt: cursor.revokedAt } },
                  {
                    id: { gt: cursor.id },
                    revokedAt: cursor.revokedAt,
                  },
                ],
              }),
          expiresAt: { gt: now },
          revokedAt: { not: null },
        },
      });
      return sessions.map((session) => this.toGuestSession(session));
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  async cleanupExpired(cutoff: Date, limit: number): Promise<number> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<{ deletedCount: number }[]>(
          Prisma.sql`
            WITH candidates AS MATERIALIZED (
              SELECT guest."id"
              FROM "guest_sessions" AS guest
              WHERE guest."expires_at" < ${cutoff}
                AND NOT EXISTS (
                  SELECT 1 FROM "game_players"
                  WHERE "guest_session_id" = guest."id"
                )
                AND NOT EXISTS (
                  SELECT 1 FROM "active_game_assignments"
                  WHERE "guest_session_id" = guest."id"
                )
                AND NOT EXISTS (
                  SELECT 1 FROM "moves"
                  WHERE "guest_session_id" = guest."id"
                )
                AND NOT EXISTS (
                  SELECT 1 FROM "game_commands"
                  WHERE "guest_session_id" = guest."id"
                )
              ORDER BY guest."expires_at"
              LIMIT ${limit}
              FOR UPDATE SKIP LOCKED
            ),
            deleted_commands AS (
              DELETE FROM "session_commands"
              WHERE "guest_session_id" IN (SELECT "id" FROM candidates)
            ),
            deleted_guests AS (
              DELETE FROM "guest_sessions"
              WHERE "id" IN (SELECT "id" FROM candidates)
              RETURNING "id"
            )
            SELECT count(*)::INTEGER AS "deletedCount"
            FROM deleted_guests
          `,
        );
        return rows[0]?.deletedCount ?? 0;
      });
    } catch (error) {
      throw toDatabaseError(error);
    }
  }

  private async recoverUniqueOrThrow(
    error: unknown,
    idempotencyHash: string,
    displayNameCanConflict: boolean,
  ): Promise<SessionMutationResult> {
    if (error instanceof SessionRepositoryError) {
      throw error;
    }

    const databaseError = toDatabaseError(error);
    if (databaseError.kind === 'unique') {
      const replay = await this.findCommand(idempotencyHash);
      if (replay !== null) {
        return { replayed: true, value: replay };
      }
      if (displayNameCanConflict) {
        throw new SessionRepositoryError('display-name-conflict');
      }
    }
    throw databaseError;
  }

  private toCommandReplay(command: CommandWithGuest): SessionCommandReplay {
    const issuedClaims =
      command.issuedJti === null ||
      command.issuedAt === null ||
      command.expiresAt === null
        ? null
        : {
            expiresAt: command.expiresAt,
            issuedAt: command.issuedAt,
            jti: command.issuedJti,
          };
    if (
      command.commandType !== 'CREATE' &&
      command.commandType !== 'RENEW' &&
      command.commandType !== 'RESET'
    ) {
      throw new DatabaseError('constraint', false);
    }
    return {
      commandType: command.commandType,
      guestSession: this.toGuestSession(command.guestSession),
      issuedClaims,
    };
  }

  private toGuestSession(guestSession: GuestSession): GuestSessionRecord {
    return {
      avatarKey: guestSession.avatarKey,
      createdAt: guestSession.createdAt,
      currentJti: guestSession.currentJti,
      displayName: guestSession.displayName,
      expiresAt: guestSession.expiresAt,
      id: guestSession.id,
      issuedAt: guestSession.issuedAt,
      revokedAt: guestSession.revokedAt,
    };
  }
}
