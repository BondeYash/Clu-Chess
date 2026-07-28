import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

@Injectable()
export class SafeLogContextService {
  guestReference(guestSessionId: string): string {
    return createHash('sha256')
      .update(guestSessionId)
      .digest('hex')
      .slice(0, 16);
  }
}
