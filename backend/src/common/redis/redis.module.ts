import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  exports: [RedisService],
  providers: [RedisService],
})
export class RedisModule {}
