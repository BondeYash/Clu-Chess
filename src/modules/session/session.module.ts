import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { GUEST_SESSION_REPOSITORY } from './application/ports/guest-session.repository.js';
import { GUEST_SOCKET_DISCONNECT_PORT } from './application/ports/guest-socket-disconnect.port.js';
import { PrismaGuestSessionRepository } from './infrastructure/prisma-guest-session.repository.js';
import { NoopGuestSocketDisconnector } from './infrastructure/noop-guest-socket-disconnector.js';
import { JwtTokenService } from './jwt-token.service.js';
import {
  ResetSessionAuthGuard,
  SessionAuthGuard,
} from './session-auth.guard.js';
import { SessionAuthenticationService } from './session-authentication.service.js';
import { SessionController } from './session.controller.js';
import { SessionExceptionFilter } from './session-exception.filter.js';
import { SessionMaintenanceService } from './session-maintenance.service.js';
import { SessionRateLimitService } from './session-rate-limit.service.js';
import { SessionRevocationService } from './session-revocation.service.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [SessionController],
  exports: [
    JwtTokenService,
    SessionAuthGuard,
    SessionAuthenticationService,
    SessionRevocationService,
  ],
  imports: [IdentityModule, PersistenceModule],
  providers: [
    JwtTokenService,
    PrismaGuestSessionRepository,
    NoopGuestSocketDisconnector,
    ResetSessionAuthGuard,
    SessionAuthGuard,
    SessionAuthenticationService,
    SessionExceptionFilter,
    SessionMaintenanceService,
    SessionRateLimitService,
    SessionRevocationService,
    SessionService,
    {
      provide: GUEST_SESSION_REPOSITORY,
      useExisting: PrismaGuestSessionRepository,
    },
    {
      provide: GUEST_SOCKET_DISCONNECT_PORT,
      useExisting: NoopGuestSocketDisconnector,
    },
  ],
})
export class SessionModule {}
