import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

@Global()
@Module({
  exports: [MetricsService],
  providers: [MetricsService],
})
export class MetricsModule {}
