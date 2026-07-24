import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { SessionAuthenticationService } from './session-authentication.service.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authentication: SessionAuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.authentication.authenticate(
      context.switchToHttp().getRequest(),
      false,
    );
    return true;
  }
}

@Injectable()
export class ResetSessionAuthGuard implements CanActivate {
  constructor(private readonly authentication: SessionAuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.authentication.authenticate(
      context.switchToHttp().getRequest(),
      true,
    );
    return true;
  }
}
