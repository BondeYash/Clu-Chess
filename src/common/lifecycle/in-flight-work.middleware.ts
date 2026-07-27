import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApplicationLifecycleService } from './application-lifecycle.service.js';

@Injectable()
export class InFlightWorkMiddleware implements NestMiddleware {
  constructor(private readonly lifecycle: ApplicationLifecycleService) {}

  use(_request: Request, response: Response, next: NextFunction): void {
    const finish = this.lifecycle.trackWork('http');
    response.once('finish', finish);
    response.once('close', finish);
    next();
  }
}
