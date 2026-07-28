/**
 * Resolve the originating client address when the application is behind a
 * configured number of trusted reverse-proxy hops.
 *
 * `X-Forwarded-For` is ordered from the original client to the nearest
 * proxy. The socket's remote address is appended as the final hop, so the
 * address immediately to the left of the trusted proxy chain is the client
 * address. With no trusted hops, the direct peer is always used.
 */
export function clientAddress(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  remoteAddress: string | undefined,
  trustedProxyHops: number,
): string {
  const directAddress = normalizeAddress(remoteAddress);
  const proxyHops = Number.isSafeInteger(trustedProxyHops)
    ? Math.max(0, trustedProxyHops)
    : 0;
  if (proxyHops === 0) {
    return directAddress;
  }

  const forwarded = forwardedAddresses(headers['x-forwarded-for']);
  if (forwarded.length === 0) {
    return directAddress;
  }

  const chain = [...forwarded, directAddress];
  const clientIndex = Math.max(0, chain.length - proxyHops - 1);
  return chain[clientIndex] ?? directAddress;
}

function forwardedAddresses(header: string | string[] | undefined): string[] {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

function normalizeAddress(address: string | undefined): string {
  const normalized = address?.trim();
  return normalized === undefined || normalized.length === 0
    ? 'unknown'
    : normalized;
}
