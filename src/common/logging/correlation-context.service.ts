import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationStore {
  correlationId: string;
}

@Injectable()
export class CorrelationContextService {
  private readonly storage = new AsyncLocalStorage<CorrelationStore>();

  run<Result>(correlationId: string, callback: () => Result): Result {
    return this.storage.run({ correlationId }, callback);
  }

  get correlationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }
}
