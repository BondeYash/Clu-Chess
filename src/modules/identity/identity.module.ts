import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service.js';
import {
  CryptoIdentityRandomSource,
  IdentityRandomSource,
} from './identity-random-source.js';
import { NameReservationService } from './name-reservation.service.js';

@Module({
  exports: [IdentityService],
  providers: [
    IdentityService,
    NameReservationService,
    {
      provide: IdentityRandomSource,
      useClass: CryptoIdentityRandomSource,
    },
  ],
})
export class IdentityModule {}
