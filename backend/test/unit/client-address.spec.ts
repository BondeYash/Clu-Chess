import { describe, expect, it } from 'vitest';
import { clientAddress } from '../../src/common/network/client-address.js';

describe('clientAddress', () => {
  it('uses the direct peer when no proxy hops are trusted', () => {
    expect(
      clientAddress({ 'x-forwarded-for': '198.51.100.7' }, '10.0.0.4', 0),
    ).toBe('10.0.0.4');
  });

  it('resolves the client through one trusted reverse proxy', () => {
    expect(
      clientAddress({ 'x-forwarded-for': '198.51.100.7' }, '10.0.0.4', 1),
    ).toBe('198.51.100.7');
  });

  it('selects the address outside a multi-hop trusted chain', () => {
    expect(
      clientAddress(
        { 'x-forwarded-for': '198.51.100.7, 10.0.0.8' },
        '10.0.0.9',
        2,
      ),
    ).toBe('198.51.100.7');
  });

  it('handles repeated forwarded headers and missing peers safely', () => {
    expect(
      clientAddress(
        { 'x-forwarded-for': ['198.51.100.7', '10.0.0.8'] },
        undefined,
        1,
      ),
    ).toBe('10.0.0.8');
    expect(clientAddress({}, undefined, 1)).toBe('unknown');
  });
});
