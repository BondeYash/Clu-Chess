import { Global, Module } from '@nestjs/common';
import { ApplicationLifecycleService } from './application-lifecycle.service.js';

@Global()
@Module({
  exports: [ApplicationLifecycleService],
  providers: [ApplicationLifecycleService],
})
export class LifecycleModule {}
