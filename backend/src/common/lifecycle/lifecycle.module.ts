import { Global, Module } from '@nestjs/common';
import { ApplicationLifecycleService } from './application-lifecycle.service.js';
import { InFlightWorkMiddleware } from './in-flight-work.middleware.js';

@Global()
@Module({
  exports: [ApplicationLifecycleService, InFlightWorkMiddleware],
  providers: [ApplicationLifecycleService, InFlightWorkMiddleware],
})
export class LifecycleModule {}
