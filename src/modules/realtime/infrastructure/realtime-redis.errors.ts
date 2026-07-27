export class RealtimeRedisUnavailableError extends Error {
  constructor() {
    super('Realtime Redis state is unavailable');
    this.name = 'RealtimeRedisUnavailableError';
  }
}
