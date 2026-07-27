import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service.js';

@Module({
  exports: [PresenceService],
  providers: [PresenceService],
})
export class PresenceModule {}
