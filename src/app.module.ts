import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { AppConfigModule } from './common/config/app-config.module.js';
import { LifecycleModule } from './common/lifecycle/lifecycle.module.js';
import { CorrelationIdMiddleware } from './common/logging/correlation-id.middleware.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { ChessModule } from './modules/chess/chess.module.js';
import { GameModule } from './modules/game/game.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module.js';
import { PersistenceModule } from './modules/persistence/persistence.module.js';
import { PresenceModule } from './modules/presence/presence.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SessionModule } from './modules/session/session.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    LifecycleModule,
    RedisModule,
    PersistenceModule,
    SessionModule,
    IdentityModule,
    MatchmakingModule,
    RealtimeModule,
    GameModule,
    ChessModule,
    PresenceModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}
