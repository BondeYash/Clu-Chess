import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { MatchmakingModule } from '../matchmaking/matchmaking.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { SessionModule } from '../session/session.module.js';
import { ActiveGameLookupService } from './active-game-lookup.service.js';
import { GUEST_PRESENCE_OBSERVER } from './application/ports/guest-presence-observer.port.js';
import { REALTIME_COMMAND_HANDLER } from './application/ports/realtime-command-handler.port.js';
import { REALTIME_DELIVERY_PORT } from './application/ports/realtime-delivery.port.js';
import { BroadcastService } from './broadcast.service.js';
import { ConnectionRegistryService } from './connection-registry.service.js';
import { GameLifecycleDeliveryService } from './game-lifecycle-delivery.service.js';
import { RealtimeRedisService } from './infrastructure/realtime-redis.service.js';
import { RealtimeProtocolService } from './protocol/realtime-protocol.service.js';
import { RealtimeAuthenticationService } from './realtime-authentication.service.js';
import { RealtimeErrorMapperService } from './realtime-error-mapper.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeRateLimitService } from './realtime-rate-limit.service.js';
import { MatchmakingRealtimeService } from './matchmaking-realtime.service.js';

@Module({
  exports: [BroadcastService, REALTIME_DELIVERY_PORT, RealtimeRedisService],
  imports: [
    GameModule,
    MatchmakingModule,
    PersistenceModule,
    PresenceModule,
    SessionModule,
  ],
  providers: [
    ActiveGameLookupService,
    BroadcastService,
    ConnectionRegistryService,
    GameLifecycleDeliveryService,
    MatchmakingRealtimeService,
    RealtimeAuthenticationService,
    RealtimeErrorMapperService,
    RealtimeGateway,
    RealtimeProtocolService,
    RealtimeRateLimitService,
    RealtimeRedisService,
    {
      provide: GUEST_PRESENCE_OBSERVER,
      useExisting: MatchmakingRealtimeService,
    },
    {
      provide: REALTIME_COMMAND_HANDLER,
      useExisting: MatchmakingRealtimeService,
    },
    {
      provide: REALTIME_DELIVERY_PORT,
      useExisting: BroadcastService,
    },
  ],
})
export class RealtimeModule {}
