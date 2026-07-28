import { Global, Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service.js';

@Global()
@Module({
  exports: [TelemetryService],
  providers: [TelemetryService],
})
export class TelemetryModule {}
