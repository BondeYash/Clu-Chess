export class EventIdLru {
  private readonly ids = new Map<string, true>();

  constructor(private readonly capacity = 512) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('EventIdLru capacity must be a positive integer.');
    }
  }

  add(id: string): boolean {
    if (this.ids.has(id)) {
      this.ids.delete(id);
      this.ids.set(id, true);
      return false;
    }

    this.ids.set(id, true);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.keys().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.ids.clear();
  }

  get size(): number {
    return this.ids.size;
  }
}
