import { describe, expect, it } from 'vitest';

import { EventIdLru } from './event-id-lru';

describe('EventIdLru', () => {
  it('rejects duplicates and refreshes their recency', () => {
    const lru = new EventIdLru(2);

    expect(lru.add('a')).toBe(true);
    expect(lru.add('b')).toBe(true);
    expect(lru.add('a')).toBe(false);
    expect(lru.add('c')).toBe(true);
    expect(lru.add('b')).toBe(true);
    expect(lru.size).toBe(2);
  });

  it('clears safely and rejects invalid capacities', () => {
    const lru = new EventIdLru(1);
    lru.add('a');
    lru.clear();
    expect(lru.size).toBe(0);
    expect(() => new EventIdLru(0)).toThrow('positive integer');
  });
});
