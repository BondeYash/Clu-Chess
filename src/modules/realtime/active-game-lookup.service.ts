import { Injectable } from '@nestjs/common';
import { toDatabaseError } from '../persistence/database-errors.js';
import { PrismaService } from '../persistence/prisma.service.js';

@Injectable()
export class ActiveGameLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveGameId(guestSessionId: string): Promise<string | null> {
    try {
      const assignment = await this.prisma.activeGameAssignment.findUnique({
        select: { gameId: true },
        where: { guestSessionId },
      });
      return assignment?.gameId ?? null;
    } catch (error) {
      throw toDatabaseError(error);
    }
  }
}
